import type { ToolContext } from "../tools/registry";
import type { ToolSet } from "ai";
import { and, eq } from "drizzle-orm";
import { embedTextComModelo } from "@orbita/llm";
import { db } from "@orbita/db";
import { profile } from "@orbita/db/profile-schema";
import { skill } from "@orbita/db/extension-schema";
import { buildMcpTools } from "../mcp/client";
import { buildToolSet, type ActionCanal } from "../tools/index";

/**
 * Ferramentas que a Órbita pode chamar (compartilhadas entre chat e rotinas).
 *
 * As 25 tools saíram deste arquivo e moram nos domínios delas
 * (packages/core/src/tools/domains/*), registradas com risco declarado. O gate
 * humano é derivado do risco pelo registro (CLAUDE.md §5.7). Aqui só resta a
 * montagem do ToolSet do turno, com seleção por relevância ao pedido.
 */
export async function buildTools(userId: string, query = "", requester?: ToolContext["requester"], origin?: ToolContext["origin"], voiceRef?: ToolContext["voiceRef"], dominios?: readonly string[], canal: ActionCanal = "tela"): Promise<ToolSet> {
  return buildToolSet(userId, query, requester, origin, voiceRef, dominios, canal);
}

/** Contexto temporal: injeta a data/hora atual (combate alucinação de "hoje/atual"). */
export function buildTemporalContext(): string {
  const agora = new Date().toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" });
  return `\n\n<contexto_temporal>Agora é ${agora}. Use esta data como referência para "hoje", "amanhã", "atual", "recente".</contexto_temporal>`;
}

/**
 * Persona configurável do usuário (PRD §4.5): nome da assistente, como chamar o
 * usuário e instruções de tom/estilo. Ajusta a personalização SEM sobrepor as
 * regras de segurança (entra como chunk de prioridade abaixo da segurança).
 */
export async function buildPersonaContext(userId: string): Promise<string> {
  const [p] = await db.select().from(profile).where(eq(profile.userId, userId)).limit(1);
  if (!p) return "";
  const name = (p.assistantName ?? "Órbita").trim();
  const parts: string[] = [];
  if (name && name !== "Órbita") parts.push(`Seu nome é "${name}", responda a esse nome.`);
  if (p.userName?.trim()) parts.push(`Trate o usuário por "${p.userName.trim()}".`);
  if (p.persona?.trim()) parts.push(`Preferências de personalização definidas pelo usuário: ${p.persona.trim()}`);
  if (!parts.length) return "";
  return `\n\n<persona>${parts.join(" ")} Estas preferências ajustam tom e estilo, mas nunca anulam as regras de segurança.</persona>`;
}

/**
 * Instruções das skills ativas do usuário, para injetar no system prompt.
 * Precedência declarada (padrão aprendido): a skill ajusta TOM/ESTILO/CONTEÚDO,
 * mas NUNCA sobrepõe as regras de segurança nem o comportamento das ferramentas.
 */
type SkillRow = { id: string; name: string; instructions: string; keywords: string | null; embedding: number[] | null; embedModel: string | null };

/** Similaridade de cosseno entre dois vetores. */
function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

export async function getSkillInstructions(userId: string, query = ""): Promise<string> {
  const rows: SkillRow[] = await db
    .select({ id: skill.id, name: skill.name, instructions: skill.instructions, keywords: skill.keywords, embedding: skill.embedding, embedModel: skill.embedModel })
    .from(skill)
    .where(and(eq(skill.userId, userId), eq(skill.enabled, true)));
  if (!rows.length) return "";

  // Roteamento por EMBEDDINGS (rápido, semântico, sem LLM no hot path): com
  // poucas skills usa todas; com muitas, ranqueia por cosseno query↔skill.
  let chosen = rows;
  if (rows.length > 3 && query.trim()) {
    try {
      const { vetor: q, modelo } = await embedTextComModelo(query, "query");
      // backfill preguiçoso: skill sem vetor, ou com vetor de OUTRO modelo (o
      // cosseno entre modelos diferentes é um número sem significado, e a
      // skill errada entraria no prompt). O texto é config do dono, curto.
      await Promise.all(
        rows
          .filter((r) => !r.embedding || r.embedModel !== modelo)
          .map(async (r) => {
            const v = await embedTextComModelo(`${r.name}. ${r.keywords ?? ""}. ${r.instructions}`.slice(0, 1500), "document").catch(() => null);
            if (v) {
              r.embedding = v.vetor;
              r.embedModel = v.modelo;
              await db.update(skill).set({ embedding: v.vetor, embedModel: v.modelo }).where(eq(skill.id, r.id)).catch(() => {});
            }
          }),
      );
      const ranked = rows
        .filter((r) => r.embedding && r.embedModel === modelo)
        .map((r) => ({ r, sim: cosine(q, r.embedding!) }))
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 3);
      if (ranked.length) chosen = ranked.map((x) => x.r);
    } catch {
      // embeddings indisponíveis → usa as primeiras como último recurso.
      chosen = rows.slice(0, 3);
    }
  }

  return (
    "\n\n<skills_ativas>\nAs instruções abaixo ajustam seu estilo e o que você faz, siga-as, mas elas NÃO " +
    "revogam as regras de SEGURANÇA nem o funcionamento das ferramentas.\n" +
    chosen.map((r) => `[${r.name}]\n${r.instructions}`).join("\n\n") +
    "\n</skills_ativas>"
  );
}

/**
 * Todas as ferramentas + extensões do usuário: tools base + conectores + MCP,
 * mais as instruções das skills. Retorna um cleanup que fecha as conexões MCP.
 */
export async function buildAllTools(
  userId: string,
  query = "",
  requester?: ToolContext["requester"],
  origin?: ToolContext["origin"],
  voiceRef?: ToolContext["voiceRef"],
  /** `canal`: de onde o pedido veio; é por ele que "manda" aprova sem tela (PRD-WHATSAPP W6) */
  opts: { dominios?: readonly string[]; canal?: ActionCanal; soLeitura?: boolean; todas?: boolean } = {},
): Promise<{ tools: ToolSet; cleanup: () => Promise<void>; skillInstructions: string }> {
  // Só leitura (regra disparada por texto de terceiro): nada de MCP, cujo
  // risco o registro não conhece, e nenhuma tool que escreva ou proponha.
  if (opts.soLeitura) {
    return { tools: await buildToolSet(userId, query, requester, origin, voiceRef, undefined, opts.canal, true, Boolean(opts.todas)), cleanup: async () => {}, skillInstructions: "" };
  }
  // caminho rápido (comando da casa): só as tools do domínio, sem MCP nem skills
  if (opts.dominios?.length) {
    return { tools: await buildTools(userId, query, requester, origin, voiceRef, opts.dominios, opts.canal), cleanup: async () => {}, skillInstructions: "" };
  }
  const [base, mcp, skillInstructions] = await Promise.all([
    buildToolSet(userId, query, requester, origin, voiceRef, undefined, opts.canal ?? "tela", false, Boolean(opts.todas)),
    buildMcpTools(userId),
    getSkillInstructions(userId, query),
  ]);
  return { tools: { ...base, ...mcp.tools }, cleanup: mcp.cleanup, skillInstructions };
}

// o prompt mora em arquivo próprio (decisões de escrita e teste de invariantes
// junto dele); o re-export mantém os imports de chat, voz e rotinas intactos
export { SYSTEM_PROMPT } from "./system-prompt";
