import { and, asc, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { actionQueue, type ActionQueue } from "@orbita/db/action-schema";
import { executeAction, validarPropostaEditada } from "../connectors/execute";
import { events } from "../events/index";
import { log } from "../observability/logger";

/**
 * O gate humano (§5.1) num lugar só. Saiu da rota `POST /api/actions` para que
 * o botão da tela, a frase "manda" na conversa "Eu" e o "manda" falado na voz
 * executem EXATAMENTE o mesmo caminho: mesma validação, mesmo evento, mesma
 * trilha.
 *
 * Quem chama aqui é sempre código que já sabe que o DONO aprovou (sessão dele,
 * ou a fala dele reconhecida por código). Nenhuma tool chama isto: se uma tool
 * pudesse aprovar, uma mensagem de terceiro convenceria o modelo a chamá-la e
 * o gate viraria enfeite.
 */

export type ResultadoDaAprovacao = { ok: true; resultado: string } | { ok: false; status: 400 | 404 | 502; erro: string };

/**
 * `editado` é a proposta CORRIGIDA por quem aprova (o dono ajustou a ação na
 * tela antes de confirmar). É validada ANTES de executar, para o erro chegar
 * como recado e não como falha depois do clique, e é GRAVADA na linha: a trilha
 * mostra o que de fato saiu, não o que o modelo havia proposto.
 */
export async function aprovarAcao(userId: string, id: string, editado?: Record<string, unknown>): Promise<ResultadoDaAprovacao> {
  let corrigido: Record<string, unknown> | null = null;
  if (editado) {
    const [atual] = await db.select({ kind: actionQueue.kind }).from(actionQueue).where(and(eq(actionQueue.id, id), eq(actionQueue.userId, userId), eq(actionQueue.status, "pending"))).limit(1);
    if (!atual) return { ok: false, status: 404, erro: "Ação não encontrada ou já processada" };
    const v = validarPropostaEditada(atual.kind, editado);
    if (!v.ok) return { ok: false, status: 400, erro: v.erro };
    corrigido = v.dados;
  }

  // a troca pending → done é atômica: dois "manda" seguidos (ou o botão e a
  // frase ao mesmo tempo) não mandam a mesma mensagem duas vezes
  const [acao] = await db
    .update(actionQueue)
    .set({ status: "done", result: "executando", ...(corrigido ? { payload: corrigido } : {}) })
    .where(and(eq(actionQueue.id, id), eq(actionQueue.userId, userId), eq(actionQueue.status, "pending")))
    .returning();
  if (!acao) return { ok: false, status: 404, erro: "Ação não encontrada ou já processada" };

  try {
    const resultado = await executeAction(userId, acao.kind, acao.payload as Record<string, unknown>);
    await db.update(actionQueue).set({ result: resultado }).where(eq(actionQueue.id, id));
    log.info("action.executed", { userId, kind: acao.kind, canal: acao.canal });
    // vai para o outbox: o processo persistente lê e dispara as regras
    await events.emit("action.executed", { kind: acao.kind, summary: acao.summary, result: resultado }, { userId });
    return { ok: true, resultado };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "falha";
    // envio que PODE ter saído não é "falhou": o dono tentaria de novo e a
    // pessoa receberia duas vezes (whatsapp/enviar.ts, EnvioIncerto)
    if (e instanceof Error && e.name === "EnvioIncerto") {
      await db.update(actionQueue).set({ result: msg }).where(eq(actionQueue.id, id));
      log.warn("action.incerta", { userId, kind: acao.kind });
      return { ok: true, resultado: msg };
    }
    await db.update(actionQueue).set({ status: "failed", result: msg }).where(eq(actionQueue.id, id));
    log.error("action.failed", { userId, kind: acao.kind, error: msg });
    return { ok: false, status: 502, erro: msg };
  }
}

export async function cancelarAcao(userId: string, id: string): Promise<void> {
  await db.update(actionQueue).set({ status: "cancelled" }).where(and(eq(actionQueue.id, id), eq(actionQueue.userId, userId), eq(actionQueue.status, "pending")));
}

/** Propostas pendentes de um canal, da mais antiga para a mais nova. */
export async function pendentesDoCanal(userId: string, canal: ActionQueue["canal"]): Promise<ActionQueue[]> {
  return db
    .select()
    .from(actionQueue)
    .where(and(eq(actionQueue.userId, userId), eq(actionQueue.status, "pending"), eq(actionQueue.canal, canal)))
    .orderBy(asc(actionQueue.createdAt));
}
