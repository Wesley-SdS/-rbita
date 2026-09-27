import { eq, isNotNull, and } from "drizzle-orm";
import { db } from "@orbita/db";
import { waMensagem } from "@orbita/db/whatsapp-schema";
import { log } from "../observability/logger";
import * as ponte from "./gowa/client";
import { sessaoDe } from "./sessao";
import { apagarMidias } from "./midia";
import { caminhosSemUso } from "./store";

/**
 * "Apagar a conta" para o WhatsApp. O cascade leva as linhas `wa_*`, mas não
 * leva o que mora FORA do banco: os áudios e fotos de terceiros no disco, e o
 * número ainda vinculado na ponte (que continuaria entregando webhook para um
 * dispositivo sem dono). Chamado por `account/data.ts` antes e depois da
 * transação.
 */
export async function antesDeApagarConta(userId: string): Promise<string[]> {
  const s = await sessaoDe(userId);
  if (s) {
    // desvincula E remove o slot: o celular deixa de estar conectado à Órbita
    await ponte.desconectar(s.deviceId).catch((e) => log.warn("whatsapp.apagar_logout_falhou", { erro: e instanceof Error ? e.message : String(e) }));
    await ponte.removerDispositivo(s.deviceId).catch((e) => log.warn("whatsapp.apagar_remover_falhou", { erro: e instanceof Error ? e.message : String(e) }));
  }
  const rows = await db.selectDistinct({ caminho: waMensagem.midiaCaminho }).from(waMensagem).where(and(eq(waMensagem.userId, userId), isNotNull(waMensagem.midiaCaminho)));
  return rows.map((r) => r.caminho).filter((c): c is string => Boolean(c));
}

/** Depois do commit: some com a mídia que nenhuma mensagem restante usa. */
export async function depoisDeApagarConta(caminhos: readonly string[]): Promise<void> {
  if (caminhos.length) await apagarMidias(await caminhosSemUso(caminhos));
}
