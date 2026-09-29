import { and, asc, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "@orbita/db";
import { waEventoBruto, waMensagem, type WaMensagem } from "@orbita/db/whatsapp-schema";
import { settings } from "../settings";
import { events } from "../events/index";
import { log } from "../observability/logger";
import { transcribeRecording } from "../meetings/transcribe";
import * as ponte from "./gowa/client";
import { gowaEventExternalId, gowaEventSchema, gowaEditedEventSchema, gowaMessageEventSchema, gowaReactionEventSchema, gowaRevokedEventSchema, type GowaEvent } from "./gowa/eventos";
import { normalizarJid, traduzirMensagem, type MensagemTraduzida } from "./traduzir";
import { conferirSaude, sessaoDe } from "./sessao";
import { salvarMidia } from "./midia";
import * as store from "./store";

/**
 * Da entrada bruta à mensagem guardada (PRD-WHATSAPP W2).
 *
 * O webhook só grava em `wa_evento_bruto` e responde 200: o GOWA reenvia se o
 * 200 demora, então nada de baixar mídia ou transcrever dentro da requisição.
 * Quem processa é este módulo, no MESMO processo.
 *
 * Por que não a fila de trabalhos (`jobs/`): cada mensagem recebida viraria um
 * trabalho na tela "Trabalhos", e um grupo animado enterraria o resumo de
 * reunião do dono debaixo de centenas de linhas. A tabela bruta já é a fila
 * durável (gravar antes de processar); o laço do SchedulerService é a rede de
 * segurança para o que falhou ou ficou para trás num reinício.
 *
 * Em série POR CHAT, não global: a ordem importa dentro de uma conversa (a
 * conversa "Eu" relê o histórico, a edição vem depois da original), mas um
 * áudio de três minutos transcrito no whisper local não pode segurar a
 * conversa "Eu" enquanto isso.
 */

/** Chamado depois que uma mensagem nova foi guardada: o roteamento (turno, automático). */
type AoGuardar = (userId: string, m: WaMensagem, ctx: { conversaEu: boolean }) => Promise<void>;
let aoGuardar: AoGuardar | null = null;
/** O roteador se registra aqui (evita import circular com o turno do chat). */
export function quandoGuardar(fn: AoGuardar): void {
  aoGuardar = fn;
}

/** O laço de pendentes tenta de novo em 5, 10, 20, 40, 80 e 160 s depois de RECEBIDO (não da falha anterior). */
export const ESPERA_BASE_S = 5;
export const MAX_FALHAS = 6;

/**
 * Edição, apagada ou reação de uma original que não chegou nisso vira abandono,
 * não erro. Tem de ficar ENTRE a penúltima e a última tentativa: com 10 min e
 * depois com 4 min, as seis tentativas acabavam (a última em ~160 s) antes de
 * a espera vencer, e o evento ficava com erro para sempre. Derivada das mesmas
 * constantes do laço, para as duas não se desencontrarem de novo.
 */
export const ESPERA_PELA_ORIGINAL_MS = (ESPERA_BASE_S * 2 ** (MAX_FALHAS - 1) - 20) * 1000;

// ── entrada (chamada pela rota do webhook, já autenticada pelo HMAC) ──

export type ResultadoDaEntrada = { ok: true; eventoId: string | null } | { ok: false; status: 400; erro: string };

const chatDo = (corpo: unknown): string => {
  const p = (corpo as { payload?: Record<string, unknown> } | null)?.payload;
  const c = p?.chat_id ?? p?.revoked_chat;
  return typeof c === "string" && c ? normalizarJid(c) : "_";
};

/** Grava o evento bruto (idempotente) e agenda o processamento. Nunca processa aqui. */
export async function receberEvento(userId: string, deviceId: string, corpo: unknown): Promise<ResultadoDaEntrada> {
  const ev = gowaEventSchema.safeParse(corpo);
  if (!ev.success) return { ok: false, status: 400, erro: "Evento inválido" };
  const externalId = gowaEventExternalId(ev.data);
  if (!externalId) {
    // efêmero (presença) é esperado; mensagem sem id é formato novo do GOWA, e precisa aparecer
    if (ev.data.event.startsWith("message")) log.warn("whatsapp.evento_sem_id", { tipo: ev.data.event });
    return { ok: true, eventoId: null };
  }
  const [r] = await db
    .insert(waEventoBruto)
    .values({ userId, deviceId, tipo: ev.data.event, externalId, corpo: ev.data as unknown as Record<string, unknown> })
    .onConflictDoNothing({ target: [waEventoBruto.deviceId, waEventoBruto.tipo, waEventoBruto.externalId] })
    .returning({ id: waEventoBruto.id });
  if (r) agendar(r.id, chatDo(ev.data));
  return { ok: true, eventoId: r?.id ?? null };
}

// ── processamento em série por chat ──

const filas = new Map<string, Promise<unknown>>();
const emAndamento = new Set<string>();

function agendar(id: string, chat: string): void {
  if (emAndamento.has(id)) return;
  emAndamento.add(id);
  const proxima = (filas.get(chat) ?? Promise.resolve())
    .then(() => processarEvento(id))
    // a falha já está gravada na linha; o laço de pendentes refaz com espera
    .catch((e) => log.warn("whatsapp.processar_falhou", { erro: e instanceof Error ? e.message : String(e) }))
    .finally(() => {
      emAndamento.delete(id);
      if (filas.get(chat) === proxima) filas.delete(chat);
    });
  filas.set(chat, proxima);
}

/**
 * Laço de segurança: retoma o que não foi processado. A espera DOBRA a cada
 * falha (5 s, 10 s, 20 s…): uma original que ainda está na fila tem tempo de
 * chegar antes de a edição dela desistir.
 */
export async function processarPendentes(maxFalhas = MAX_FALHAS): Promise<number> {
  const rows = await db
    .select({ id: waEventoBruto.id, corpo: waEventoBruto.corpo })
    .from(waEventoBruto)
    .where(
      and(
        isNull(waEventoBruto.processadoEm),
        lt(waEventoBruto.falhas, maxFalhas),
        // sem Date crua no sql`` (CLAUDE.md §9): a conta é toda do Postgres
        sql`${waEventoBruto.recebidoEm} <= now() - make_interval(secs => ${ESPERA_BASE_S}::float8 * power(2, ${waEventoBruto.falhas}))`,
      ),
    )
    .orderBy(asc(waEventoBruto.recebidoEm))
    .limit(100);
  for (const r of rows) agendar(r.id, chatDo(r.corpo));
  return rows.length;
}

export async function processarEvento(id: string): Promise<void> {
  const [bruto] = await db.select().from(waEventoBruto).where(eq(waEventoBruto.id, id)).limit(1);
  if (!bruto || bruto.processadoEm) return;
  try {
    const ev = gowaEventSchema.parse(bruto.corpo);
    await aplicarEvento(bruto.userId, bruto.deviceId, ev, bruto.recebidoEm);
    await db.update(waEventoBruto).set({ processadoEm: new Date(), ultimoErro: null }).where(eq(waEventoBruto.id, id));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(waEventoBruto).set({ falhas: bruto.falhas + 1, ultimoErro: msg.slice(0, 500) }).where(eq(waEventoBruto.id, id));
    throw e;
  }
}

/** Chat que a config manda ignorar (grupo, status). PURA. */
export function chatIgnorado(chatJid: string, cfg: { grupos: string; status: string; canais?: string }): boolean {
  if (chatJid === "status@broadcast") return cfg.status === "ignorar";
  // Canal do WhatsApp (@newsletter) é publicação de quem o dono SEGUE, não
  // conversa: guardado, cada post baixava mídia e enchia o banco. Visto no
  // primeiro minuto depois de parear o número de verdade (27/09/2026).
  if (chatJid.endsWith("@newsletter")) return (cfg.canais ?? "ignorar") === "ignorar";
  return chatJid.endsWith("@g.us") && cfg.grupos === "ignorar";
}

/** Aplica um evento já validado (exportado para os testes; quem chama é `processarEvento`). */
export async function aplicarEvento(userId: string, deviceId: string, ev: GowaEvent, recebidoEm: Date): Promise<void> {
  const cfg = await settings.getMany(["whatsapp.grupos", "whatsapp.status", "whatsapp.canais"]);
  const filtro = { grupos: cfg["whatsapp.grupos"], status: cfg["whatsapp.status"], canais: cfg["whatsapp.canais"] };

  const msg = gowaMessageEventSchema.safeParse(ev);
  if (msg.success) return guardarMensagem(userId, deviceId, traduzirMensagem(msg.data.payload), filtro);

  // Edição, apagada e reação mexem numa mensagem que PRECISA já estar guardada.
  // Se ela ainda não está (a original falhou e voltou para a fila, medido no
  // smoke de 27/09), o evento falha de propósito e o laço o refaz depois. Se
  // ela NUNCA vai estar (grupo ignorado, anterior ao pareamento, fora da
  // retenção), a espera acaba e o evento é encerrado sem barulho.
  const aplicarNaOriginal = async (chat: string | undefined, externalId: string, patch: Parameters<typeof store.atualizarMensagem>[2]) => {
    if (chat && chatIgnorado(normalizarJid(chat), filtro)) return;
    if ((await store.atualizarMensagem(userId, externalId, patch)) > 0) return;
    if (Date.now() - recebidoEm.getTime() < ESPERA_PELA_ORIGINAL_MS) throw new Error("a mensagem original ainda não foi guardada");
    log.info("whatsapp.original_ausente", { tipo: ev.event });
  };

  const apagada = gowaRevokedEventSchema.safeParse(ev);
  // apagada GUARDA o texto original: é o que a pessoa escreveu, e o dono já podia ter lido
  if (apagada.success) return aplicarNaOriginal(apagada.data.payload.chat_id, apagada.data.payload.revoked_message_id, { apagada: true });

  const editada = gowaEditedEventSchema.safeParse(ev);
  if (editada.success) {
    const { body, chat_id, original_message_id } = editada.data.payload;
    // edição sem corpo (legenda de mídia, formato novo) não pode APAGAR o texto que havia
    return aplicarNaOriginal(chat_id, original_message_id, body === undefined ? { editada: true } : { texto: body, editada: true });
  }

  const reacao = gowaReactionEventSchema.safeParse(ev);
  if (reacao.success) return aplicarNaOriginal(reacao.data.payload.chat_id, reacao.data.payload.reacted_message_id, { reacao: reacao.data.payload.emoji || null });
}

async function guardarMensagem(userId: string, deviceId: string, t: MensagemTraduzida, filtro: { grupos: string; status: string; canais?: string }): Promise<void> {
  if (chatIgnorado(t.chatJid, filtro)) return;

  // A VOLTA do que a Órbita mandou. Sem isto, a resposta dela na conversa "Eu"
  // chegaria como mensagem nova do dono e ela responderia a si mesma, em laço.
  if (t.deMim && (await store.casarEco(userId, t.chatJid, t.tipo, t.texto, t.externalId, t.em))) return;

  // Sem o JID do dono ainda (logo depois de parear, antes da primeira volta
  // da saúde), a conversa "Eu" passaria por chat comum e o pedido ficaria mudo.
  let sessao = await sessaoDe(userId);
  if (sessao && !sessao.jid) {
    await conferirSaude(userId).catch(() => null);
    sessao = await sessaoDe(userId);
  }
  const meuJid = sessao?.jid ? normalizarJid(sessao.jid) : null;
  const conversaEu = Boolean(meuJid && t.chatJid === meuJid);

  const contato = await store.garantirContato(userId, t.chatJid, {
    // num chat de pessoa, o nome de quem escreveu é o nome do chat; no grupo, não
    nome: !t.grupo && !t.deMim ? t.autorNome : null,
    grupo: t.grupo,
    escreveu: !t.deMim,
    em: t.em,
  });

  // Reentrega NÃO é o fim: se a tentativa anterior caiu depois de gravar e
  // antes de rotear, é a linha existente que segue (mídia, aviso, roteamento).
  const m =
    (await store.inserirMensagem({
      userId,
      contatoId: contato.id,
      chatJid: t.chatJid,
      autorJid: t.autorJid,
      autorNome: t.deMim ? null : t.autorNome,
      externalId: t.externalId,
      deMim: t.deMim,
      tipo: t.tipo,
      texto: t.texto,
      respondeA: t.respondeA,
      em: t.em,
      // o que o dono mesmo escreveu (em qualquer chat) ele já leu
      lidaEm: t.deMim ? new Date() : null,
    })) ?? (await store.mensagemPorExternalId(userId, t.externalId));
  // já roteada, ou é a saída da PRÓPRIA Órbita voltando (pelo histórico da
  // ponte, na recuperação): responder a ela seria a Órbita conversando consigo
  if (!m || m.roteadaEm || m.enviadaPelaOrbita) return;

  let final: WaMensagem = m;
  if (t.midia && !m.midiaCaminho) final = await baixarETranscrever(userId, deviceId, t, m);

  // o TEXTO não vai no evento: uma regra que o usasse num prompt o receberia
  // fora do embrulho de dado externo. Quem precisa do texto lê pela tool.
  await events.emit("whatsapp.mensagem_recebida", { mensagemId: m.id, contatoId: contato.id, chatJid: t.chatJid, tipo: t.tipo, deMim: t.deMim, grupo: t.grupo, conversaEu, contato: contato.apelido ?? contato.nome ?? null }, { userId });
  if (aoGuardar) await aoGuardar(userId, final, { conversaEu }).catch((e) => log.error("whatsapp.rotear_falhou", { erro: e instanceof Error ? e.message : String(e) }));
  await db.update(waMensagem).set({ roteadaEm: new Date() }).where(eq(waMensagem.id, m.id));
}

async function baixarETranscrever(userId: string, deviceId: string, t: MensagemTraduzida, m: WaMensagem): Promise<WaMensagem> {
  const cfg = await settings.getMany(["whatsapp.midiaMaxMb", "whatsapp.transcricao", "meetings.sttCloud"]);
  try {
    const baixada = await ponte.baixarMidia(deviceId, { path: t.midia!.path, externalId: t.externalId, mime: t.midia!.mimeType, chat: t.chatJid }, cfg["whatsapp.midiaMaxMb"] * 1024 * 1024);
    const { caminho, sha256 } = await salvarMidia(baixada.bytes, baixada.mime);
    const patch: Partial<WaMensagem> = { midiaCaminho: caminho, midiaSha256: sha256, midiaMime: baixada.mime };
    if (t.tipo === "audio") {
      const transcricao = await transcrever(userId, baixada.bytes, baixada.mime, cfg["whatsapp.transcricao"], cfg["meetings.sttCloud"]);
      if (transcricao) patch.transcricao = transcricao;
    }
    await store.atualizarMensagemPorId(userId, m.id, patch);
    return { ...m, ...patch };
  } catch (e) {
    // sem mídia a mensagem continua valendo (o texto, a legenda, o fato de ter chegado)
    log.warn("whatsapp.midia_falhou", { tipo: t.tipo, erro: e instanceof Error ? e.message : String(e) });
    return m;
  }
}

/** Escolha de onde transcrever, PURA: `nunca` desliga, `igual_reunioes` segue a config das reuniões. */
export function nuvemParaTranscrever(escolha: string, dasReunioes: string): boolean | null {
  if (escolha === "nunca") return null;
  if (escolha === "local") return false;
  if (escolha === "nuvem") return true;
  return dasReunioes !== "nunca";
}

async function transcrever(userId: string, bytes: Uint8Array, mime: string, escolha: string, dasReunioes: string): Promise<string | null> {
  const nuvem = nuvemParaTranscrever(escolha, dasReunioes);
  if (nuvem === null) return null;
  try {
    const r = await transcribeRecording(userId, bytes, mime, { referencia: "áudio do WhatsApp", permitirNuvem: nuvem });
    return r.text?.trim() || null;
  } catch (e) {
    log.warn("whatsapp.transcricao_falhou", { erro: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/**
 * Evento bruto não serve para nada depois de uns dias. Some junto também o que
 * desistiu (`falhas` no teto): o diagnóstico em `ultimoErro` vive o mesmo que a
 * retenção de eventos, que é quanto a casa decidiu guardar trilha.
 */
export async function purgarEventosBrutos(dias: number): Promise<void> {
  await db.delete(waEventoBruto).where(sql`${waEventoBruto.recebidoEm} < now() - make_interval(days => ${dias})`);
}
