import { and, asc, eq, isNull, lt, lte } from "drizzle-orm";
import { db } from "@orbita/db";
import { waEventoBruto, type WaMensagem } from "@orbita/db/whatsapp-schema";
import { settings } from "../settings";
import { events } from "../events/index";
import { log } from "../observability/logger";
import { transcribeRecording } from "../meetings/transcribe";
import * as ponte from "./gowa/client";
import { gowaEventExternalId, gowaEventSchema, gowaEditedEventSchema, gowaMessageEventSchema, gowaReactionEventSchema, gowaRevokedEventSchema, type GowaEvent } from "./gowa/eventos";
import { normalizarJid, traduzirMensagem } from "./traduzir";
import { sessaoDoDispositivo } from "./sessao";
import { salvarMidia } from "./midia";
import * as store from "./store";

/**
 * Da entrada bruta à mensagem guardada (PRD-WHATSAPP W2).
 *
 * O webhook só grava em `wa_evento_bruto` e responde 200: o GOWA reenvia se o
 * 200 demora, então nada de baixar mídia ou transcrever dentro da requisição.
 * Quem processa é este módulo, no MESMO processo, em série.
 *
 * Por que não a fila de trabalhos (`jobs/`): cada mensagem recebida viraria um
 * trabalho na tela "Trabalhos", e um grupo animado enterraria o resumo de
 * reunião do dono debaixo de centenas de linhas. A tabela bruta já é a fila
 * durável (gravar antes de processar); o laço do SchedulerService é a rede de
 * segurança para o que ficou para trás num reinício.
 */

/** Chamado depois que uma mensagem nova foi guardada: o roteamento (turno, automático). */
type AoGuardar = (userId: string, m: WaMensagem, ctx: { conversaEu: boolean }) => Promise<void>;
let aoGuardar: AoGuardar | null = null;
/** O roteador se registra aqui (evita import circular com o turno do chat). */
export function quandoGuardar(fn: AoGuardar): void {
  aoGuardar = fn;
}

// ── entrada (chamada pela rota do webhook) ──

export type ResultadoDaEntrada = { ok: true; eventoId: string | null } | { ok: false; status: 400 | 401 | 404; erro: string };

/** Grava o evento bruto (idempotente) e agenda o processamento. Nunca processa aqui. */
export async function receberEvento(deviceId: string, corpo: unknown): Promise<ResultadoDaEntrada> {
  const sessao = await sessaoDoDispositivo(deviceId);
  if (!sessao) return { ok: false, status: 404, erro: "Dispositivo desconhecido" };
  const ev = gowaEventSchema.safeParse(corpo);
  if (!ev.success) return { ok: false, status: 400, erro: "Evento inválido" };
  const externalId = gowaEventExternalId(ev.data);
  if (!externalId) return { ok: true, eventoId: null }; // efêmero: nada a guardar
  const [r] = await db
    .insert(waEventoBruto)
    .values({ userId: sessao.sessao.userId, deviceId, tipo: ev.data.event, externalId, corpo: ev.data as unknown as Record<string, unknown> })
    .onConflictDoNothing({ target: [waEventoBruto.deviceId, waEventoBruto.tipo, waEventoBruto.externalId] })
    .returning({ id: waEventoBruto.id });
  if (r) agendar(r.id);
  return { ok: true, eventoId: r?.id ?? null };
}

// ── processamento em série ──

let cadeia: Promise<unknown> = Promise.resolve();
const emAndamento = new Set<string>();

function agendar(id: string): void {
  if (emAndamento.has(id)) return;
  emAndamento.add(id);
  // em série: a ordem das mensagens importa (a conversa "Eu" relê o histórico)
  cadeia = cadeia
    .then(() => processarEvento(id))
    .catch((e) => log.error("whatsapp.processar_falhou", { id, erro: e instanceof Error ? e.message : String(e) }))
    .finally(() => emAndamento.delete(id));
}

/** Laço de segurança: retoma o que não foi processado (reinício, falha passageira). */
export async function processarPendentes(maxFalhas = 5): Promise<number> {
  const rows = await db
    .select({ id: waEventoBruto.id })
    .from(waEventoBruto)
    .where(and(isNull(waEventoBruto.processadoEm), lt(waEventoBruto.falhas, maxFalhas), lte(waEventoBruto.recebidoEm, new Date(Date.now() - 5_000))))
    .orderBy(asc(waEventoBruto.recebidoEm))
    .limit(100);
  for (const r of rows) agendar(r.id);
  return rows.length;
}

export async function processarEvento(id: string): Promise<void> {
  const [bruto] = await db.select().from(waEventoBruto).where(eq(waEventoBruto.id, id)).limit(1);
  if (!bruto || bruto.processadoEm) return;
  try {
    const ev = gowaEventSchema.parse(bruto.corpo);
    await aplicar(bruto.userId, bruto.deviceId, ev);
    await db.update(waEventoBruto).set({ processadoEm: new Date(), ultimoErro: null }).where(eq(waEventoBruto.id, id));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(waEventoBruto).set({ falhas: bruto.falhas + 1, ultimoErro: msg.slice(0, 500) }).where(eq(waEventoBruto.id, id));
    throw e;
  }
}

async function aplicar(userId: string, deviceId: string, ev: GowaEvent): Promise<void> {
  const msg = gowaMessageEventSchema.safeParse(ev);
  if (msg.success) return guardarMensagem(userId, deviceId, msg.data.payload);

  // Edição, apagada e reação mexem numa mensagem que PRECISA já estar
  // guardada. Se ela ainda não está (a original falhou e está na fila de novo,
  // medido no smoke de 27/09), o evento falha de propósito e o laço de
  // pendentes o refaz depois, em vez de a edição se perder em silêncio.
  const exigir = async (n: Promise<number>) => {
    if ((await n) === 0) throw new Error("a mensagem original ainda não foi guardada");
  };

  const apagada = gowaRevokedEventSchema.safeParse(ev);
  // apagada GUARDA o texto original: é o que a pessoa escreveu, e o dono já podia ter lido
  if (apagada.success) return exigir(store.atualizarMensagem(userId, apagada.data.payload.revoked_message_id, { apagada: true }));

  const editada = gowaEditedEventSchema.safeParse(ev);
  if (editada.success) return exigir(store.atualizarMensagem(userId, editada.data.payload.original_message_id, { texto: editada.data.payload.body ?? null, editada: true }));

  const reacao = gowaReactionEventSchema.safeParse(ev);
  if (reacao.success) return exigir(store.atualizarMensagem(userId, reacao.data.payload.reacted_message_id, { reacao: reacao.data.payload.emoji || null }));
}

async function guardarMensagem(userId: string, deviceId: string, payload: Parameters<typeof traduzirMensagem>[0]): Promise<void> {
  const t = traduzirMensagem(payload);
  const cfg = await settings.getMany(["whatsapp.grupos", "whatsapp.status", "whatsapp.midiaMaxMb", "whatsapp.transcricao", "meetings.sttCloud"]);
  if (t.status && cfg["whatsapp.status"] === "ignorar") return;
  if (t.grupo && cfg["whatsapp.grupos"] === "ignorar") return;

  // A VOLTA do que a Órbita mandou. Sem isto, a resposta dela na conversa "Eu"
  // chegaria como mensagem nova do dono e ela responderia a si mesma, em laço.
  if (t.deMim && (await store.casarEco(userId, t.chatJid, t.tipo, t.texto, t.externalId))) return;

  const sessao = await sessaoDoDispositivo(deviceId);
  const meuJid = sessao?.sessao.jid ? normalizarJid(sessao.sessao.jid) : null;
  const conversaEu = Boolean(meuJid && t.chatJid === meuJid);

  const contato = await store.garantirContato(userId, t.chatJid, {
    // num chat de pessoa, o nome de quem escreveu é o nome do chat; no grupo, não
    nome: !t.grupo && !t.deMim ? t.autorNome : null,
    grupo: t.grupo,
    escreveu: !t.deMim,
    em: t.em,
  });

  const m = await store.inserirMensagem({
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
  });
  if (!m) return; // reentrega

  let final: WaMensagem = m;
  if (t.midia) {
    try {
      const baixada = await ponte.baixarMidia(deviceId, { path: t.midia.path, externalId: t.externalId, mime: t.midia.mimeType });
      if (baixada.bytes.length > cfg["whatsapp.midiaMaxMb"] * 1024 * 1024) {
        log.info("whatsapp.midia_grande_demais", { bytes: baixada.bytes.length });
      } else {
        const { caminho, sha256 } = await salvarMidia(baixada.bytes, baixada.mime);
        const patch: Partial<WaMensagem> = { midiaCaminho: caminho, midiaSha256: sha256, midiaMime: baixada.mime };
        if (t.tipo === "audio") {
          const transcricao = await transcrever(userId, baixada.bytes, baixada.mime, cfg["whatsapp.transcricao"], cfg["meetings.sttCloud"]);
          if (transcricao) patch.transcricao = transcricao;
        }
        await store.atualizarMensagemPorId(userId, m.id, patch);
        final = { ...m, ...patch };
      }
    } catch (e) {
      // sem mídia a mensagem continua valendo (o texto, a legenda, o fato de ter chegado)
      log.warn("whatsapp.midia_falhou", { tipo: t.tipo, erro: e instanceof Error ? e.message : String(e) });
    }
  }

  // o TEXTO não vai no evento: uma regra que o usasse num prompt o receberia
  // fora do embrulho de dado externo. Quem precisa do texto lê pela tool.
  await events.emit("whatsapp.mensagem_recebida", { mensagemId: m.id, contatoId: contato.id, chatJid: t.chatJid, tipo: t.tipo, deMim: t.deMim, grupo: t.grupo, conversaEu, contato: contato.apelido ?? contato.nome ?? null }, { userId });

  if (aoGuardar) await aoGuardar(userId, final, { conversaEu }).catch((e) => log.error("whatsapp.rotear_falhou", { erro: e instanceof Error ? e.message : String(e) }));
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

/** Evento bruto já processado não serve para nada depois de uns dias: some com a retenção de eventos. */
export async function purgarEventosBrutos(dias: number): Promise<void> {
  await db.delete(waEventoBruto).where(and(lt(waEventoBruto.recebidoEm, new Date(Date.now() - dias * 86_400_000))));
}
