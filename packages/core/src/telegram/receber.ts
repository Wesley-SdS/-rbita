import type { TgBot, TgContato, TgMensagem } from "@orbita/db/telegram-schema";
import { settings } from "../settings";
import { log } from "../observability/logger";
import { aprovarAcao, cancelarAcao, pendentesDoCanal } from "../actions/aprovar";
import { effectiveRisk, getTool, loadToolOverrides } from "../tools/index";
import { transcribeRecording } from "../meetings/transcribe";
import { nuvemParaTranscrever } from "../whatsapp/processar";
import { salvarMidia } from "../whatsapp/midia";
import { atualizacoes, baixarArquivo, digitando, responderBotao, tirarBotoes, TelegramErro, type TgCallback, type TgUpdate } from "./api";
import { codigoDoStart, lerBotao, traduzirMensagem, type MensagemTraduzida } from "./traduzir";
import { mandarTextoPara } from "./enviar";
import { recadoParaDesconhecido, turnoDoTelegram } from "./turno";
import * as store from "./store";

/**
 * A ENTRADA do Telegram: o laço pergunta "tem novidade?" (espera longa, sem
 * endereço público), grava o que chegou e só então avança o cursor. Quem é
 * desconhecido nunca chega ao modelo; quem é da casa ganha um turno, um de
 * cada vez por conversa.
 */

// Um turno por conversa de cada vez: duas mensagens seguidas não viram duas
// respostas cruzadas. Conversas diferentes seguem em paralelo.
const filaPorChat = new Map<string, Promise<unknown>>();
function emSerie(chave: string, fn: () => Promise<void>, aoTerminar: () => Promise<void>): void {
  const anterior = filaPorChat.get(chave) ?? Promise.resolve();
  const proxima = anterior
    .then(fn)
    .catch((e) => log.error("telegram.turno_falhou", { erro: e instanceof Error ? e.message : String(e) }))
    // falha também termina; só a QUEDA do processo deixa a marca em aberto
    .then(() => aoTerminar().catch(() => undefined))
    .finally(() => {
      if (filaPorChat.get(chave) === proxima) filaPorChat.delete(chave);
    });
  filaPorChat.set(chave, proxima);
}

/** Entrega a mensagem gravada ao turno, com a marca de turno pendente (ver o schema). */
async function rotear(userId: string, contato: TgContato, m: TgMensagem): Promise<void> {
  await store.marcarTurnoPendente(m.id, new Date());
  await store.atualizarMensagem(m.id, { roteadaEm: new Date() });
  emSerie(`${userId}:${m.chatId}`, () => turnoDoTelegram(userId, contato, m), () => store.marcarTurnoPendente(m.id, null));
}

async function baixarMidia(userId: string, token: string, t: MensagemTraduzida, m: TgMensagem): Promise<TgMensagem> {
  if (!t.fileId || !["audio", "imagem"].includes(t.tipo)) return m;
  const cfg = await settings.getMany(["telegram.midiaMaxMb", "whatsapp.transcricao", "meetings.sttCloud"]);
  try {
    const bytes = await baixarArquivo(token, t.fileId, cfg["telegram.midiaMaxMb"] * 1024 * 1024);
    const mime = t.mime ?? "application/octet-stream";
    const { caminho } = await salvarMidia(bytes, mime);
    const patch: Partial<TgMensagem> = { midiaCaminho: caminho, midiaMime: mime };
    if (t.tipo === "audio") {
      const nuvem = nuvemParaTranscrever(cfg["whatsapp.transcricao"], cfg["meetings.sttCloud"]);
      if (nuvem !== null) {
        const r = await transcribeRecording(userId, bytes, mime, { referencia: "áudio do Telegram", permitirNuvem: nuvem }).catch(() => null);
        if (r?.text?.trim()) patch.transcricao = r.text.trim();
      }
    }
    await store.atualizarMensagem(m.id, patch);
    return { ...m, ...patch };
  } catch (e) {
    // sem mídia a mensagem continua valendo (a legenda, o fato de ter chegado)
    log.warn("telegram.midia_falhou", { tipo: t.tipo, erro: e instanceof Error ? e.message : String(e) });
    return m;
  }
}

/** O botão de aprovar/recusar. Só vale do DONO; risco perigoso só pela tela. */
async function tratarBotao(bot: TgBot, token: string, cb: TgCallback): Promise<void> {
  const userId = bot.userId;
  const dono = await store.donoNoTelegram(userId);
  const acao = lerBotao(cb.data);
  if (!dono || String(cb.from.id) !== dono.telegramId || !acao) {
    // a Anna apertando o botão (ou um botão forjado) não aprova nada
    await responderBotao(token, cb.id, "Só o dono aprova.");
    return;
  }
  const pendente = (await pendentesDoCanal(userId, "telegram")).find((p) => p.id === acao.propostaId) ?? (await pendentesDoCanal(userId, "tela")).find((p) => p.id === acao.propostaId);
  if (!pendente) {
    await responderBotao(token, cb.id, "Essa proposta já foi decidida ou venceu.");
    if (cb.message) await tirarBotoes(token, String(cb.message.chat.id), cb.message.message_id);
    return;
  }
  // vencida só sai pela tela, como no "manda" do WhatsApp: botão velho no
  // histórico não pode aprovar horas depois
  if (acao.acao === "aprovar" && pendente.expiraEm && pendente.expiraEm < new Date()) {
    await responderBotao(token, cb.id, "Venceu. Aprove pela tela, em Ações a confirmar.");
    if (cb.message) await tirarBotoes(token, String(cb.message.chat.id), cb.message.message_id);
    return;
  }
  if (acao.acao === "recusar") {
    await cancelarAcao(userId, pendente.id);
    await responderBotao(token, cb.id, "Cancelado.");
  } else {
    const def = getTool(pendente.kind);
    if (!def || effectiveRisk(def, await loadToolOverrides()) === "perigoso") {
      await responderBotao(token, cb.id, "Isto só se aprova pela tela.");
      return;
    }
    const r = await aprovarAcao(userId, pendente.id);
    await responderBotao(token, cb.id, r.ok ? "Feito." : "Não consegui.");
    await mandarTextoPara(userId, dono, r.ok ? `Feito: ${r.resultado}` : `Não consegui: ${r.erro}`).catch(() => undefined);
  }
  if (cb.message) await tirarBotoes(token, String(cb.message.chat.id), cb.message.message_id);
}

/** "/start CODIGO": o convite do dono vira vínculo. Devolve se tratou. */
async function tratarConvite(userId: string, contato: TgContato, texto: string | null): Promise<boolean> {
  const codigo = codigoDoStart(texto);
  if (!codigo) return false;
  const convite = await store.usarConvite(userId, codigo);
  if (!convite) {
    await mandarTextoPara(userId, contato, "Esse convite não vale mais (venceu ou já foi usado). Peça um novo.").catch(() => undefined);
    return true;
  }
  await store.vincular(userId, contato.id, convite.papel, convite.personId);
  await mandarTextoPara(
    userId,
    contato,
    convite.papel === "dono"
      ? "Pronto, agora é por aqui também. Pode me pedir o que pediria no app: avisos, briefing e aprovações chegam aqui."
      : "Oi! Eu sou a Órbita, a assistente da casa. Pode me pedir coisas da casa (luz, clima, rota…); o que precisar de aprovação eu peço para o dono.",
  ).catch(() => undefined);
  return true;
}

async function tratarMensagem(bot: TgBot, token: string, t: MensagemTraduzida): Promise<void> {
  const userId = bot.userId;
  // o bot só conversa em particular: em grupo, qualquer um do grupo falaria em nome da casa
  if (t.grupo) return;
  const contato = await store.garantirContato(userId, t);
  if (contato.papel === "bloqueado") return;
  if (await tratarConvite(userId, contato, t.tipo === "texto" ? t.texto : null)) return;
  if (contato.papel === "desconhecido") return recadoParaDesconhecido(userId, contato);

  // teto por pessoa: um celular perdido ou uma criança insistindo não queimam a cota do dono
  if (contato.papel === "pessoa") {
    const teto = await settings.get("telegram.porHoraPessoa");
    if ((await store.recebidasDesde(contato.id, new Date(Date.now() - 3_600_000))) >= teto) {
      log.warn("telegram.teto_pessoa", { contatoId: contato.id });
      return;
    }
  }
  if (contato.papel === "dono" && t.tipo === "texto" && /^\/pendentes\b/.test(t.texto ?? "")) return listarPendentes(userId, contato);

  const m = await store.inserirMensagem({
    userId,
    contatoId: contato.id,
    chatId: t.chatId,
    messageId: t.messageId,
    tipo: t.tipo,
    texto: t.texto,
    fileId: t.fileId,
    em: t.em,
  });
  if (!m) return; // o mesmo update de novo
  void digitando(token, t.chatId, t.tipo === "audio" ? "record_voice" : "typing");
  const comMidia = await baixarMidia(userId, token, t, m);
  await rotear(userId, contato, comMidia);
}

async function listarPendentes(userId: string, dono: TgContato): Promise<void> {
  const pendentes = [...(await pendentesDoCanal(userId, "telegram")), ...(await pendentesDoCanal(userId, "tela"))];
  if (!pendentes.length) {
    await mandarTextoPara(userId, dono, "Nada esperando aprovação.").catch(() => undefined);
    return;
  }
  const { mandarProposta } = await import("./enviar");
  const overrides = await loadToolOverrides();
  for (const p of pendentes.slice(0, 10)) {
    const def = getTool(p.kind);
    await mandarProposta(userId, dono, { id: p.id, resumo: p.summary, perigosa: !def || effectiveRisk(def, overrides) === "perigoso" }).catch(() => undefined);
  }
}

/** Update que falhou N vezes seguidas é pulado: um update envenenado não pode travar o canal. */
const falhasDoUpdate = new Map<string, number>();

async function tratarUpdate(bot: TgBot, token: string, u: TgUpdate): Promise<void> {
  if (u.callback_query) return tratarBotao(bot, token, u.callback_query);
  if (!u.message) return;
  const t = traduzirMensagem(u.message);
  if (t) await tratarMensagem(bot, token, t);
}

/** Uma volta de UM bot: espera longa, grava, avança. */
async function ouvirBot(bot: TgBot): Promise<void> {
  let token: string;
  try {
    token = store.tokenDo(bot);
  } catch {
    log.error("telegram.token_ilegivel", { userId: bot.userId });
    return;
  }
  const espera = await settings.get("telegram.esperaSegundos");
  let lista: TgUpdate[];
  try {
    lista = await atualizacoes(token, bot.proximoUpdate, espera);
  } catch (e) {
    const codigo = e instanceof TelegramErro ? e.codigo : null;
    // 409: outro processo está ouvindo o mesmo bot (o `tsx watch` reiniciando): ele cuida
    if (codigo !== 409) {
      await store.anotarErro(bot.userId, e instanceof Error ? e.message : String(e)).catch(() => undefined);
      log.warn("telegram.ouvir_falhou", { codigo, erro: e instanceof Error ? e.message.slice(0, 200) : String(e) });
    }
    return;
  }
  for (const u of lista) {
    const chave = `${bot.userId}:${u.update_id}`;
    try {
      await tratarUpdate(bot, token, u);
    } catch (e) {
      const n = (falhasDoUpdate.get(chave) ?? 0) + 1;
      falhasDoUpdate.set(chave, n);
      log.error("telegram.update_falhou", { tentativa: n, erro: e instanceof Error ? e.message.slice(0, 200) : String(e) });
      // não avança: o mesmo update volta na próxima volta (a gravação é idempotente)
      if (n < 5) return;
    }
    falhasDoUpdate.delete(chave);
    await store.avancarCursor(bot.userId, u.update_id + 1);
  }
  if (!lista.length) await store.avancarCursor(bot.userId, bot.proximoUpdate).catch(() => undefined);
}

/** A volta do laço: todos os bots (na prática, o do dono). */
export async function ouvirTelegram(): Promise<void> {
  const bots = await store.todosOsBots();
  await Promise.all(bots.map((b) => ouvirBot(b).catch((e) => log.error("telegram.volta_falhou", { erro: e instanceof Error ? e.message : String(e) }))));
}

const SUBIDA = new Date();

/**
 * Ao subir: o que ficou no meio. Mensagem gravada e nunca entregue a um turno,
 * e turno começado ANTES desta subida que não terminou (reivindicado atômico,
 * como no WhatsApp). Só dos últimos `whatsapp.retomarMinutos`.
 */
export async function retomarNoTelegram(agora = new Date(), subida = SUBIDA): Promise<number> {
  const minutos = await settings.get("whatsapp.retomarMinutos");
  if (!minutos) return 0;
  const desde = new Date(agora.getTime() - minutos * 60_000);
  let retomados = 0;
  for (const bot of await store.todosOsBots()) {
    const pendentes = [...(await store.naoRoteadas(bot.userId, desde)), ...(await store.turnosInterrompidos(desde, subida)).filter((m) => m.userId === bot.userId)];
    for (const m of pendentes) {
      try {
        if (m.turnoPendenteEm && !(await store.reivindicarTurno(m.id, subida))) continue;
        const contato = await store.contatoPorId(bot.userId, m.contatoId);
        if (!contato || (contato.papel !== "dono" && contato.papel !== "pessoa")) continue;
        await rotear(bot.userId, contato, m);
        retomados++;
      } catch (e) {
        log.error("telegram.retomar_falhou", { erro: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  if (retomados) log.warn("telegram.turnos_retomados", { quantos: retomados });
  return retomados;
}
