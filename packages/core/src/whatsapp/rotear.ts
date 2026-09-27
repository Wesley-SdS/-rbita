import type { WaMensagem } from "@orbita/db/whatsapp-schema";
import { settings } from "../settings";
import { log } from "../observability/logger";
import { quandoGuardar } from "./processar";
import { sessaoDe } from "./sessao";
import { normalizarJid } from "./traduzir";
import { turnoDoDono } from "./turno";
import { donoAssumiu, talvezResponderSozinha } from "./automatico";
import * as store from "./store";

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
function emSerie(chave: string, fn: () => Promise<void>): void {
  const anterior = filaPorChat.get(chave) ?? Promise.resolve();
  const proxima = anterior
    .then(fn)
    .catch((e) => log.error("whatsapp.turno_falhou", { erro: e instanceof Error ? e.message : String(e) }))
    .finally(() => {
      if (filaPorChat.get(chave) === proxima) filaPorChat.delete(chave);
    });
  filaPorChat.set(chave, proxima);
}

export async function rotear(userId: string, m: WaMensagem, ctx: { conversaEu: boolean }): Promise<void> {
  const contato = await store.contatoPorId(userId, m.contatoId);
  if (!contato) return;
  const destino = destinoDa(m, { conversaEu: ctx.conversaEu, conversaComigo: await settings.get("whatsapp.conversaComigo"), modoDoContato: contato.modo, grupo: contato.grupo });
  switch (destino) {
    case "dono": {
      const sessao = await sessaoDe(userId);
      if (!sessao?.jid) return;
      const meuJid = normalizarJid(sessao.jid);
      // o turno roda FORA da fila de processamento: um LLM de 30 s não pode
      // segurar as mensagens dos outros chats
      emSerie(`${userId}:${m.chatJid}`, () => turnoDoDono(userId, meuJid, m));
      return;
    }
    case "automatico":
      emSerie(`${userId}:${m.chatJid}`, () => talvezResponderSozinha(userId, contato, m));
      return;
    case "dono_assumiu":
      await donoAssumiu(userId, contato);
      return;
    default:
      return;
  }
}

/** Liga o roteador ao processamento. Chamado uma vez pelo processo persistente. */
export function instalarRoteadorDoWhatsapp(): void {
  quandoGuardar(rotear);
}
