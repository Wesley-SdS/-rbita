import type { ToolSet } from "ai";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@orbita/db";
import { actionQueue } from "@orbita/db/action-schema";
import { toolConfig } from "@orbita/db/tool-schema";
import { connectedProviders } from "../connectors/store";
import { getHaConnection } from "../home/connection";
import { provedorAtivo } from "../whatsapp/enviar";
import { settings } from "../settings";
import { isOwner } from "../owner";
import { ehToolSensivel, sensiveisLiberados } from "../controle/dominios";
import { guardaDoControle } from "../controle/guarda";
import { semImagem } from "../controle/imagem";
import { novoTurno, type TurnoDeContaminacao } from "../controle/contaminacao";
import { contaminacaoDaCasa } from "../controle/contaminacao-da-casa";
import { navegadorDisponivel, navegadorDisponivelPara } from "../navegador/ordens";
import {
  availableFor, effectiveRisk, executarChamada, type ToolContext, getTool, isEnabled, isToolRisk, listRegisteredTools, selectRelevant, toToolSet,
  type Enqueue, type ToolOverride, type ToolOverrides, type ToolRisk,
} from "./registry";

// Cada domínio se registra ao ser importado. Adicionar um domínio = uma linha
// aqui (o import), nunca uma entrada num arquivo central de tools.
import "./domains/tempo";
import "./domains/memoria";
import "./domains/financas";
import "./domains/bancos";
import "./domains/noticias";
import "./domains/emails";
import "./domains/trabalho";
import "./domains/comigo";
import "./domains/quadro";
import "./domains/rotinas";
import "./domains/tarefas";
import "./domains/widgets";
import "./domains/clima";
import "./domains/mundo";
import "./domains/web-tools";
import "./domains/google";
import "./domains/contatos";
import "./domains/reunioes";
import "./domains/telegram";
import "./domains/notion";
import "./domains/slack";
import "./domains/whatsapp";
import "./domains/casa";
import "./domains/teams";
import "./domains/outlook";
import "./domains/anexos";
import "./domains/jira";
import "./domains/camera";
import "./domains/identidade";
import "./domains/acompanhamento";
import "./domains/controle";
import "./domains/navegador";
import "./domains/terminal";
import "./domains/arquivos";
import "./domains/computador";

export * from "./registry";

/**
 * O que o WhatsApp permite agora: mandar (qualquer provedor) e ler (só o
 * número pessoal). Fail-soft: sem banco ou sem ponte, as tools somem do turno
 * em vez de derrubá-lo.
 */
async function estadoDoWhatsapp(userId: string): Promise<{ whatsappConnected: boolean; whatsappPessoal: boolean }> {
  const p = await provedorAtivo(userId).catch(() => null);
  return { whatsappConnected: p !== null, whatsappPessoal: p === "pessoal" };
}

/** Prazo para aprovar FALANDO (frase ou voz). Proposta da tela não vence. */
async function expiraPara(canal: ActionCanal): Promise<Date | null> {
  if (canal === "tela") return null;
  const min = await settings.get("whatsapp.aprovacaoValidadeMin").catch(() => 30);
  return new Date(Date.now() + min * 60_000);
}
export type ActionCanal = "tela" | "whatsapp" | "voz" | "telegram";

/** Quem está no turno, além do canal: tira as tools sensíveis de quem não é o dono. */
export interface RestricoesDoTurno {
  soLeitura?: boolean;
  /** turno de pessoa da casa (Telegram da família) */
  pessoaDaCasa?: boolean;
}

/**
 * As tools do controle do PC (terminal, arquivos, computador, navegador,
 * controle) entram neste turno? Só com `controle.ativo`, no canal liberado,
 * para o DONO da instância e fora dos turnos de terceiro. Falha fechada: sem
 * config ou sem saber quem é o dono, não entram.
 */
export async function sensiveisNoTurno(userId: string, canal: ActionCanal, r: RestricoesDoTurno = {}): Promise<boolean> {
  const cfg = await settings.getMany(["controle.ativo", "controle.canais"]).catch(() => null);
  if (!cfg || !sensiveisLiberados({ ativo: cfg["controle.ativo"], canais: cfg["controle.canais"], canal, ...r })) return false;
  return isOwner(userId).catch(() => false);
}

function semSensiveis<T extends { domain: string; requires?: { dono?: boolean } }>(defs: T[], liberado: boolean): T[] {
  return liberado ? defs : defs.filter((d) => !ehToolSensivel(d));
}

// ── configuração por tool (tela do catálogo) ────────────────────────────────
// Cache curto por processo, igual ao das settings: mudou na tela, vale em segundos.
const CACHE_MS = Number(process.env.SETTINGS_CACHE_MS ?? 5000);
let cache: { at: number; map: Map<string, ToolOverride> } | null = null;

export async function loadToolOverrides(): Promise<ToolOverrides> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.map;
  const map = new Map<string, ToolOverride>();
  try {
    for (const r of await db.select().from(toolConfig)) {
      map.set(r.name, { enabled: r.enabled, riskOverride: isToolRisk(r.riskOverride) ? r.riskOverride : null });
    }
  } catch {
    // fail-soft: sem a tabela, todas ligadas com o risco declarado
    if (cache) return cache.map;
  }
  cache = { at: Date.now(), map };
  return map;
}

export async function setToolOverride(name: string, patch: { enabled?: boolean; riskOverride?: ToolRisk | null }): Promise<void> {
  const current = (await loadToolOverrides()).get(name) ?? { enabled: true, riskOverride: null };
  const next: ToolOverride = { enabled: patch.enabled ?? current.enabled, riskOverride: patch.riskOverride === undefined ? current.riskOverride : patch.riskOverride };
  if (next.enabled && next.riskOverride === null) {
    await db.delete(toolConfig).where(eq(toolConfig.name, name)); // volta ao default: linha some
  } else {
    await db
      .insert(toolConfig)
      .values({ name, enabled: next.enabled, riskOverride: next.riskOverride, updatedAt: new Date() })
      .onConflictDoUpdate({ target: toolConfig.name, set: { enabled: next.enabled, riskOverride: next.riskOverride, updatedAt: new Date() } });
  }
  cache = null;
}

/** Catálogo para a tela: tudo que existe, com risco declarado, efetivo e estado. */
export async function toolCatalog(userId: string) {
  const [overrides, connected, haConn, wa, sensiveis] = await Promise.all([
    loadToolOverrides(), connectedProviders(userId), getHaConnection(userId), estadoDoWhatsapp(userId), sensiveisNoTurno(userId, "tela"),
  ]);
  const haConnected = haConn !== null;
  return listRegisteredTools().map((d) => ({
    name: d.name,
    domain: d.domain,
    description: d.description,
    risk: d.risk,
    riskOverride: overrides.get(d.name)?.riskOverride ?? null,
    effectiveRisk: effectiveRisk(d, overrides),
    enabled: isEnabled(d, overrides),
    // sensível vem antes do conector: sem o controle ligado ela não aparece, tenha a conta que tiver
    requires: ehToolSensivel(d) ? "controle" : ((typeof d.requires?.connector === "string" ? d.requires.connector : d.requires?.connector?.join(" ou ")) ?? (d.requires?.homeAssistant ? "home_assistant" : d.requires?.whatsapp || d.requires?.whatsappPessoal ? "whatsapp" : d.requires?.available ? "env" : null)),
    available: semSensiveis(availableFor([d], { connected, haConnected, ...wa, overrides }), sensiveis).length === 1,
  }));
}

// ── gate humano derivado do risco ───────────────────────────────────────────
/**
 * Enfileira a PROPOSTA em action_queue (o LLM nunca executa efeito externo).
 * `kind` é o nome da tool: POST /api/actions resolve pelo registro e chama o `run`.
 */
export function enqueueFor(userId: string, canal: ActionCanal = "tela"): Enqueue {
  return async (def, input, summary) => {
    const payload = (input ?? {}) as Record<string, unknown>;
    const expiraEm = await expiraPara(canal);
    // A MESMA proposta ainda pendente, no MESMO canal, não vira outra linha: o
    // modelo relê o histórico e propõe de novo o que já estava na fila
    // (27/09/2026: três "Cadastrar Ana" esperando aprovação). A existente
    // renasce AGORA, para o "manda" desta conversa valer para ela. Canal
    // diferente não junta: uma regra (tela) roubaria a proposta do WhatsApp e o
    // "manda" do dono não a acharia mais. O resumo fica o original, com a nota
    // de quem pediu.
    const [igual] = await db
      .update(actionQueue)
      .set({ expiraEm, createdAt: new Date() })
      .where(and(eq(actionQueue.userId, userId), eq(actionQueue.kind, def.name), eq(actionQueue.status, "pending"), eq(actionQueue.canal, canal), sql`${actionQueue.payload} = ${JSON.stringify(payload)}::jsonb`))
      .returning({ id: actionQueue.id, summary: actionQueue.summary });
    if (igual) return { proposta_enfileirada: true, aguardando_aprovacao: true, ja_estava_na_fila: true, id: igual.id, resumo: igual.summary };
    const [row] = await db.insert(actionQueue).values({ userId, kind: def.name, summary, payload, canal, expiraEm }).returning({ id: actionQueue.id });
    return { proposta_enfileirada: true, aguardando_aprovacao: true, id: row?.id, resumo: summary };
  };
}

/**
 * ToolSet do turno: tools ligadas, com exigências atendidas para este usuário,
 * selecionadas por relevância ao pedido, com o gate derivado do risco efetivo.
 */
export async function buildToolSet(userId: string, query = "", requester?: ToolContext["requester"], origin?: ToolContext["origin"], voiceRef?: ToolContext["voiceRef"], dominios?: readonly string[], canal: ActionCanal = "tela", soLeitura = false, todas = false, turno: RestricoesDoTurno & { pedido?: string; origem?: ToolContext["origem"]; contaminacao?: TurnoDeContaminacao } = {}): Promise<ToolSet> {
  const [overrides, connected, max, haConn, wa, sensiveis] = await Promise.all([
    loadToolOverrides(), connectedProviders(userId), settings.get("tools.maxPerTurn"), getHaConnection(userId), estadoDoWhatsapp(userId),
    sensiveisNoTurno(userId, canal, { soLeitura, pessoaDaCasa: turno.pessoaDaCasa }),
  ]);
  // os domínios do controle do PC saem ANTES da escolha por domínio: nem uma
  // lista de domínios da família configurada com "terminal" os traz de volta
  const usable = semSensiveis(availableFor(listRegisteredTools(), { connected, haConnected: haConn !== null, ...wa, overrides }), sensiveis)
    // o Chrome de quem é o turno: rotina só no perfil dedicado (ligado), o dono só com a extensão conectada
    // (vale para as tools que dependem das mãos do Chrome, as que declaram `navegadorDisponivel`)
    .filter((d) => d.requires?.available !== navegadorDisponivel || navegadorDisponivelPara(turno.origem));
  const doDominio = (dominios?.length ? usable.filter((d) => dominios.includes(d.domain)) : usable).filter((d) => !soLeitura || effectiveRisk(d, overrides) === "leitura");
  // `todas`: sem teto nem seleção (conversa "Eu" do WhatsApp, como a voz): o
  // dono pede "tudo" por ali, e a seleção por palavras deixava de fora a tool
  // certa quando o pedido não repetia o vocabulário dela
  const chosen = todas ? doDominio : selectRelevant(doDominio, query, max);
  // o objeto do turno nasce aqui quando quem monta não trouxe um (o chat traz, para o MCP ver a mesma marca)
  const doTurno = turno.contaminacao ?? novoTurno(userId, canal, { origem: turno.origem });
  return toToolSet(chosen, { userId, requester, origin, voiceRef, canal, pedido: turno.pedido?.slice(0, 2000), origem: turno.origem, turno: doTurno }, { overrides, enqueue: enqueueFor(userId, canal), guarda: guardaDoControle, contaminacao: contaminacaoDaCasa });
}

/**
 * Definições cruas (não convertidas em ToolSet do AI SDK) das tools deste
 * usuário agora — usado pela sessão realtime (Onda 6, B7.2): a OpenAI
 * Realtime API quer `{ name, description, parameters }` em JSON Schema, não
 * o wrapper `tool()` do AI SDK.
 *
 * TODAS as tools que valem para o usuário (ligadas e com exigências
 * atendidas), sem teto nem seleção por relevância. O chat escolhe as mais
 * relevantes porque conhece o pedido do turno; a voz abre a sessão ANTES de
 * o dono falar, e cortar por ordem de registro deixava de fora tudo que foi
 * registrado depois das 30 primeiras (casa, câmera, identidade, metade das
 * finanças). Decisão do dono em 27/09/2026: voz e texto fazem exatamente as
 * mesmas coisas, sem diferença.
 *
 * A exceção são as tools do controle do PC (terminal, arquivos, computador,
 * navegador, controle): elas NUNCA são declaradas aqui, nem com o controle
 * ligado. A OpenAI Realtime aceita no máximo 128 funções e o catálogo passou
 * disso; na voz elas chegam por duas funções de despacho
 * (`controle/voz.ts`), que executam pelo mesmo `executarPeloRegistro`. O chat
 * de texto continua recebendo todas.
 */
export async function toolDefsForRealtime(userId: string) {
  return (await disponiveisAgora(userId)).filter((d) => !ehToolSensivel(d));
}

/**
 * As tools do controle do PC que a voz alcança agora (pelo despacho de
 * `controle/voz.ts`): vazio com o controle desligado, com a voz fora de
 * `controle.canais` ou para quem não é o dono. Falha fechada, como no chat.
 */
export async function sensiveisDaVoz(userId: string) {
  const [disponiveis, liberado] = await Promise.all([disponiveisAgora(userId), sensiveisNoTurno(userId, "voz")]);
  return liberado ? disponiveis.filter(ehToolSensivel) : [];
}

/** Ligadas e com exigências atendidas para este usuário agora (sem o filtro do controle do PC). */
async function disponiveisAgora(userId: string) {
  const [overrides, connected, haConn, wa] = await Promise.all([loadToolOverrides(), connectedProviders(userId), getHaConnection(userId), estadoDoWhatsapp(userId)]);
  return availableFor(listRegisteredTools(), { connected, haConnected: haConn !== null, ...wa, overrides });
}

/**
 * Executa (ou enfileira) UMA chamada de função vinda da sessão realtime. O
 * browser nunca fala com o banco: ele repassa nome+argumentos para cá, e o
 * gate é DERIVADO DO RISCO exatamente como em `toToolSet` — uma tool
 * `efeito_externo`/`perigoso` chamada por voz enfileira a proposta em vez de
 * executar (a resposta falada da Órbita então narra "mandei para aprovação",
 * de graça, porque o modelo lê o resultado da função — é o B7.7 do briefing:
 * confirmação falada sem código especial).
 */
export async function runRealtimeTool(userId: string, name: string, rawInput: unknown, requester?: ToolContext["requester"], origin?: ToolContext["origin"]): Promise<unknown> {
  // tool do controle do PC pelo nome direto não entra: a sessão não as declara,
  // e uma porta só (o despacho de `controle/voz.ts`) é uma regra só para revisar
  const def = getTool(name);
  if (def && ehToolSensivel(def)) return { erro: `Ferramenta "${name}" não está disponível por aqui. Use buscar_ferramenta_do_pc e usar_ferramenta_do_pc.` };
  // a imagem (screenshot) não vai para a voz: a sessão realtime recebe texto,
  // e a alternativa (árvore ou narração) toma o lugar dela
  return semImagem(await executarPeloRegistro(userId, name, rawInput, { canal: "voz", requester, origin }));
}

/**
 * Executa (ou enfileira) uma tool do registro FORA do ToolSet do chat: a voz
 * em tempo real e os laços delegados (o motor do Claude no computador e no
 * Chrome) chamam isto, e passam pelo MESMO caminho (disponibilidade, controle
 * do PC, permissão, risco pelo alvo, fila, trilha, sessão e crítico).
 */
export async function executarPeloRegistro(
  userId: string,
  name: string,
  rawInput: unknown,
  c: { canal: ActionCanal; requester?: ToolContext["requester"]; origin?: ToolContext["origin"]; pedido?: string },
): Promise<unknown> {
  const def = getTool(name);
  if (!def) return { erro: `Ferramenta "${name}" não existe.` };

  const [overrides, connected, haConn, wa] = await Promise.all([
    loadToolOverrides(), connectedProviders(userId), getHaConnection(userId), estadoDoWhatsapp(userId),
  ]);
  const usable = availableFor([def], { connected, haConnected: haConn !== null, ...wa, overrides });
  if (usable.length === 0) return { erro: `Ferramenta "${name}" não está disponível agora.` };
  if (ehToolSensivel(def) && !(await sensiveisNoTurno(userId, c.canal))) return { erro: `Ferramenta "${name}" não está disponível agora.` };

  const parsed = def.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) return { erro: "Entrada inválida para a ferramenta." };

  const ctx: ToolContext = { userId, requester: c.requester, origin: c.origin, canal: c.canal, pedido: c.pedido };
  // canal "voz": a proposta pode ser aprovada dizendo "manda" na mesma sessão (W6)
  // sem objeto de turno de propósito: cada função da voz chega numa chamada própria, e a marca
  // da leitura sensível é achada pela chave (usuário e canal) dentro da janela curta
  return executarChamada(def, parsed.data, ctx, { overrides, enqueue: enqueueFor(userId, c.canal), guarda: guardaDoControle, contaminacao: contaminacaoDaCasa });
}
