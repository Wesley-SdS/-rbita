import { z } from "zod";
import { registerTools, type ToolDef } from "../registry";
import { normalizarNome } from "../../contatos/casar";
import { getPerson } from "../../identity/people";
import * as store from "../../telegram/store";
import { mandarTextoPara, mandarVozPara } from "../../telegram/enviar";

/**
 * Domínio: Telegram, o canal DA Órbita. Mandar é `efeito_externo` (o registro
 * enfileira; o `run` só roda depois que o dono aprova). Só para quem já está
 * vinculado: um bot não consegue escrever para quem nunca falou com ele, e a
 * Órbita não sai procurando gente.
 */

/** "a Anna" → a pessoa vinculada no Telegram (pelo nome da pessoa da casa ou do Telegram). */
async function resolverPessoa(userId: string, para: string): Promise<{ ok: true; id: string; nome: string } | { ok: false; erro: string }> {
  const t = normalizarNome(para).replace(/^(a|o|pra|para)\s+/, "");
  const vinculados = (await store.listarContatos(userId)).filter((c) => c.papel === "pessoa" || c.papel === "dono");
  const comNome = await Promise.all(
    vinculados.map(async (c) => ({ c, nome: (c.personId ? (await getPerson(userId, c.personId).catch(() => null))?.name : null) ?? c.nome ?? "?" })),
  );
  const achados = comNome.filter(({ c, nome }) => c.id === para.trim() || [nome, c.nome ?? ""].map(normalizarNome).some((n) => n === t || n.split(" ").includes(t)));
  if (achados.length === 1) return { ok: true, id: achados[0].c.id, nome: achados[0].nome };
  if (!achados.length) return { ok: false, erro: `"${para}" não está vinculado ao Telegram da Órbita. O dono convida em Conexões, Telegram.` };
  return { ok: false, erro: `Há mais de uma pessoa para "${para}" no Telegram: ${achados.map((a) => `${a.nome} (${a.c.id})`).join("; ")}. Pergunte qual.` };
}

const Mandar = z.object({
  para: z.string().min(1).max(120).describe("Quem recebe: o nome da pessoa da casa vinculada ao Telegram (\"Anna\")."),
  para_id: z.string().max(60).nullish().describe("Preenchido pela Órbita; não informe."),
  para_nome: z.string().max(120).nullish().describe("Preenchido pela Órbita; não informe."),
  texto: z.string().min(1).max(4000).describe("O texto exato."),
  em_audio: z.boolean().optional().describe("Mandar como nota de voz, com a voz da Órbita."),
});

export const enviar_telegram: ToolDef<typeof Mandar> = {
  name: "enviar_telegram",
  domain: "telegram",
  description:
    "Propõe mandar uma mensagem (texto ou nota de voz) pelo Telegram da Órbita para uma pessoa da casa já vinculada (ex.: 'avisa a Anna no Telegram que eu chego às 8'). Não envia direto: o dono aprova.",
  risk: "efeito_externo",
  keywords: ["telegram", "mandar", "avisar", "mensagem", "audio", "voz"],
  inputSchema: Mandar,
  summarize: (i) => `${i.em_audio ? "Mandar áudio" : "Mandar mensagem"} no Telegram para ${i.para_nome ?? i.para}: "${i.texto.slice(0, 1000)}"`,
  authorize: async (i, ctx) => {
    const r = await resolverPessoa(ctx.userId, i.para);
    return r.ok ? null : r.erro;
  },
  // o destino é FIXADO ao propor, e o nome do resumo vem do código, nunca do modelo
  preparar: async (i, ctx) => {
    const r = await resolverPessoa(ctx.userId, i.para);
    return r.ok ? { ...i, para_id: r.id, para_nome: r.nome } : { ...i, para_id: null, para_nome: null };
  },
  run: async ({ para_id, texto, em_audio }, { userId }) => {
    const contato = para_id ? await store.contatoPorId(userId, para_id) : null;
    if (!contato || (contato.papel !== "pessoa" && contato.papel !== "dono")) throw new Error("Essa pessoa não está mais vinculada ao Telegram.");
    if (em_audio) await mandarVozPara(userId, contato, texto);
    else await mandarTextoPara(userId, contato, texto);
    return "Enviado pelo Telegram.";
  },
};

const Ler = z.object({
  quem: z.string().min(1).max(120).describe("A pessoa da casa vinculada (\"Anna\")."),
  quantidade: z.number().int().min(1).max(50).optional(),
});

export const ler_telegram: ToolDef<typeof Ler> = {
  name: "ler_telegram",
  domain: "telegram",
  description: "Lê a conversa de uma pessoa da casa com a Órbita no Telegram (o que ela pediu e o que a Órbita respondeu). Use para 'o que a Anna pediu pra você?'.",
  risk: "leitura",
  keywords: ["telegram", "conversa", "pediu", "falou", "mensagem"],
  inputSchema: Ler,
  run: async ({ quem, quantidade }, { userId }) => {
    const r = await resolverPessoa(userId, quem);
    if (!r.ok) return r.erro;
    const msgs = await store.mensagensDoContato(userId, r.id, quantidade ?? 20);
    if (!msgs.length) return `Nenhuma conversa com ${r.nome} no Telegram.`;
    // o que a pessoa escreveu é DADO (§5.2); o que a Órbita respondeu, também, por coerência
    const linhas = msgs.map((m) => `${m.em.toISOString().slice(0, 16).replace("T", " ")} ${m.doBot ? "Órbita" : r.nome}: ${(m.transcricao ?? m.texto ?? `[${m.tipo}]`).replace(/<\/?dado_externo[^>]*>/gi, "")}`);
    return `Conversa com ${r.nome} no Telegram:\n<dado_externo origem="telegram">\n${linhas.join("\n")}\n</dado_externo>`;
  },
};

registerTools([enviar_telegram, ler_telegram]);
