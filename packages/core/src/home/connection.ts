import { eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { haConnection } from "@orbita/db/home-schema";
import { encryptSecret, decryptSecret } from "../crypto";
import { assertLocalOrPublicUrl } from "../net/ssrf";
import { pingHomeAssistant, HomeAssistantError } from "./client";

export interface HaCreds {
  baseUrl: string;
  token: string;
}

/** Conexão HA do usuário, com token decifrado. `null` se não configurou. */
export async function getHaConnection(userId: string): Promise<HaCreds | null> {
  const [row] = await db.select().from(haConnection).where(eq(haConnection.userId, userId)).limit(1);
  if (!row) return null;
  return { baseUrl: row.baseUrl, token: decryptSecret(row.tokenEnc) };
}

export async function usersWithHomeAssistant(): Promise<string[]> {
  const rows = await db.select({ userId: haConnection.userId }).from(haConnection);
  return rows.map((r) => r.userId);
}

/**
 * Cadastra (ou substitui) a conexão com o Home Assistant do usuário. Testa a
 * conexão de verdade antes de salvar — nada de guardar credencial que não
 * funciona. `baseUrl` é digitada pelo dono nesta tela: é o único lugar onde a
 * exceção estreita de SSRF (B3.2) vale para ela.
 */
export async function saveHaConnection(userId: string, baseUrl: string, token: string): Promise<{ label: string }> {
  await assertLocalOrPublicUrl(baseUrl); // valida cedo, com erro claro, antes de gastar a chamada de ping
  const { label } = await pingHomeAssistant(baseUrl, token);
  await db
    .insert(haConnection)
    .values({ userId, baseUrl, tokenEnc: encryptSecret(token), label, lastSeenAt: new Date(), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: haConnection.userId,
      set: { baseUrl, tokenEnc: encryptSecret(token), label, lastSeenAt: new Date(), updatedAt: new Date() },
    });
  return { label };
}

export async function deleteHaConnection(userId: string): Promise<void> {
  await db.delete(haConnection).where(eq(haConnection.userId, userId));
}

export { HomeAssistantError };
