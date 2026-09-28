import type { WaMensagem } from "@orbita/db/whatsapp-schema";
import { settings } from "../settings";
import { log } from "../observability/logger";
import { quandoGuardar } from "./processar";
import { sessaoDe } from "./sessao";
import { normalizarJid } from "./traduzir";
import { turnoDoDono } from "./turno";
import { donoAssumiu, talvezResponderSozinha } from "./automatico";
import * as store from "./store";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@orbita/db";
import { message } from "@orbita/db/chat-schema";
import { actionQueue } from "@orbita/db/action-schema";
import { conversaDoCanal } from "./conversa";
import { enviarTexto } from "./enviar";
import { interpretarResposta } from "./regras";

/**
 * Para onde vai cada mensagem guardada. Três canais, três níveis de
 * confiança, e quem decide é o CHAT DE ORIGEM, determinado aqui, nunca pelo
 * modelo (PRD-WHATSAPP §4):
 *
 *   conversa "Eu" (o dono)        → turno completo, todas as tools
 *   contato em modo automático    → turno sem tools, responde só a ele
 *   qualquer outro                → só fica guardado
 */

export type Destino = "dono" | "automatico" | "dono_assumiu" | "nada";

/** A decisão, PURA. */
export function destinoDa(m: Pick<WaMensagem, "deMim" | "enviadaPelaOrbita">, ctx: { conversaEu: boolean; conversaComigo: boolean; modoDoContato: "aprovar" | "automatico"; grupo: boolean }): Destino {
  if (ctx.conversaEu) return m.deMim && ctx.conversaComigo ? "dono" : "nada";
  if (m.deMim) return !m.enviadaPelaOrbita && ctx.modoDoContato === "automatico" ? "dono_assumiu" : "nada";
  if (ctx.grupo) return "nada";
  return ctx.modoDoContato === "automatico" ? "automatico" : "nada";
}

// Um turno por chat de cada vez: duas mensagens seguidas do dono não podem
// virar duas respostas cruzadas. Chats diferentes seguem em paralelo.
const filaPorChat = new Map<string, Promise<unknown>>();
function emSerie(chave: string, fn: () => Promise<void>, aoTerminar: () => Promise<void>): void {
  const anterior = filaPorChat.get(chave) ?? Promise.resolve();
  const proxima = anterior
    .then(fn)
    .catch((e) => log.error("whatsapp.turno_falhou", { erro: e instanceof Error ? e.message : String(e) }))
    // Falha também conta como terminado: o turno que falhou já avisou o dono
    // (ou nem tinha o que responder), e retomar um erro a cada subida viraria
    // laço. Só a QUEDA do processo deixa a marca em aberto.
    .then(() => aoTerminar().catch((e) => log.warn("whatsapp.limpar_turno_falhou", { erro: e instanceof Error ? e.message : String(e) })))
    .finally(() => {
      if (filaPorChat.get(chave) === proxima) filaPorChat.delete(chave);
    });
  filaPorChat.set(chave, proxima);
}

export async function rotear(userId: string, m: WaMensagem, ctx: { conversaEu: boolean }): Promise<void> {
  const contato = await store.contatoPorId(userId, m.contatoId);
  if (!contato) return;
  const destino = destinoDa(m, { conversaEu: ctx.conversaEu, conversaComigo: await settings.get("whatsapp.conversaComigo"), modoDoContato: contato.modo, grupo: contato.grupo });
  // só o que tem TURNO ganha a marca de pendente: é o que pode ser interrompido
  const comTurno = async (fn: () => Promise<void>) => {
    await store.marcarTurnoPendente(userId, m.id);
    emSerie(`${userId}:${m.chatJid}`, fn, () => store.limparTurnoPendente(userId, m.id));
  };
  switch (destino) {
    case "dono": {
      const sessao = await sessaoDe(userId);
      if (!sessao?.jid) return;
      const meuJid = normalizarJid(sessao.jid);
      // o turno roda FORA da fila de processamento: um LLM de 30 s não pode
      // segurar as mensagens dos outros chats
      return comTurno(() => turnoDoDono(userId, meuJid, m));
    }
    case "automatico":
      return comTurno(() => talvezResponderSozinha(userId, contato, m));
    case "dono_assumiu":
      await donoAssumiu(userId, contato);
      return;
    default:
      return;
  }
}

/** Quando ESTE processo subiu: turno pendente de antes disso foi interrompido. */
const SUBIDA = new Date();

/**
 * O turno interrompido já tinha feito efeito? Resposta gravada ou proposta
 * criada depois que ele começou: rodar de novo repetiria (duas respostas, a
 * mesma proposta renascendo). Nesse caso a retomada só limpa a marca.
 */
async function jaTeveEfeito(userId: string, desde: Date): Promise<boolean> {
  const convId = await conversaDoCanal(userId);
  const [resposta] = await db.select({ id: message.id }).from(message).where(and(eq(message.conversationId, convId), eq(message.role, "assistant"), gt(message.createdAt, desde))).limit(1);
  if (resposta) return true;
  const [proposta] = await db.select({ id: actionQueue.id }).from(actionQueue).where(and(eq(actionQueue.userId, userId), eq(actionQueue.canal, "whatsapp"), gt(actionQueue.createdAt, desde))).limit(1);
  return Boolean(proposta);
}

/**
 * Ao subir: retoma o turno que o processo ANTERIOR deixou no meio. Só os
 * pedidos dos últimos `whatsapp.retomarMinutos`: depois disso a resposta
 * chegaria fora de hora.
 *
 * Três travas contra responder em dobro, todas medidas na auditoria de
 * 27/09/2026: só turno começado antes desta subida (o que começou depois é
 * deste processo e pode estar rodando); reivindicação atômica (dois processos
 * vivos no reinício); e nada que já tenha feito efeito. Um "manda" interrompido
 * não volta ao modelo: a aprovação pode ter saído, e o modelo repropor a
 * mensagem faria ela sair duas vezes. O dono é avisado para conferir.
 */
export async function retomarTurnosInterrompidos(agora = new Date(), subida = SUBIDA): Promise<number> {
  const minutos = await settings.get("whatsapp.retomarMinutos");
  if (!minutos) return 0;
  const pendentes = await store.turnosInterrompidos(new Date(agora.getTime() - minutos * 60_000), subida);
  let retomados = 0;
  for (const m of pendentes) {
    try {
      const comecouEm = m.turnoPendenteEm!;
      if (!(await store.reivindicarTurno(m.id, subida))) continue;
      const sessao = await sessaoDe(m.userId);
      const meuJid = sessao?.jid ? normalizarJid(sessao.jid) : null;
      const conversaEu = meuJid === m.chatJid;
      if (conversaEu) {
        const frases = await settings.getMany(["whatsapp.frasesConfirmar", "whatsapp.frasesCancelar"]);
        if (interpretarResposta(m.texto ?? m.transcricao ?? "", frases["whatsapp.frasesConfirmar"], frases["whatsapp.frasesCancelar"]).acao) {
          await store.limparTurnoPendente(m.userId, m.id);
          await enviarTexto(m.userId, meuJid!, "Eu reiniciei enquanto cuidava da sua confirmação. Confira em Ações a confirmar se saiu; se ainda estiver pendente, responda de novo.", { aprovacaoHumana: true }).catch(() => undefined);
          continue;
        }
        if (await jaTeveEfeito(m.userId, comecouEm)) {
          await store.limparTurnoPendente(m.userId, m.id);
          continue;
        }
      }
      await rotear(m.userId, m, { conversaEu });
      retomados++;
    } catch (e) {
      log.error("whatsapp.retomar_falhou", { erro: e instanceof Error ? e.message : String(e) });
    }
  }
  if (retomados) log.warn("whatsapp.turnos_retomados", { quantos: retomados });
  return retomados;
}

/** Liga o roteador ao processamento. Chamado uma vez pelo processo persistente. */
export function instalarRoteadorDoWhatsapp(): void {
  quandoGuardar(rotear);
}
