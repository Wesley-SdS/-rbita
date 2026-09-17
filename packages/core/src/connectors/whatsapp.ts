import { eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { whatsappConnection } from "@orbita/db/channels-schema";
import { encryptSecret, decryptSecret } from "../crypto";

/**
 * WhatsApp via Cloud API (Meta). Sem OAuth por usuário de verdade (exigiria
 * revisão de app da Meta / Embedded Signup) — o que dá para fazer é tirar o
 * token/phone_id do `.env` fixo e trazer para uma tela (CH.2). `WHATSAPP_TOKEN`
 * / `WHATSAPP_PHONE_ID` do ambiente continuam valendo como BOOTSTRAP (self-host
 * sem tocar na tela), mas o que está no banco vence.
 */
export interface WhatsappCreds {
  phoneId: string;
  token: string;
}

export async function getWhatsappCreds(userId: string): Promise<WhatsappCreds | null> {
  const [row] = await db.select().from(whatsappConnection).where(eq(whatsappConnection.userId, userId)).limit(1);
  if (row) return { phoneId: row.phoneId, token: decryptSecret(row.tokenEnc) };
  const envToken = process.env.WHATSAPP_TOKEN;
  const envPhone = process.env.WHATSAPP_PHONE_ID;
  return envToken && envPhone ? { phoneId: envPhone, token: envToken } : null;
}

export async function whatsappConfigured(userId: string): Promise<boolean> {
  return (await getWhatsappCreds(userId)) !== null;
}

export async function saveWhatsappConnection(userId: string, phoneId: string, token: string): Promise<void> {
  await db
    .insert(whatsappConnection)
    .values({ userId, phoneId, tokenEnc: encryptSecret(token), updatedAt: new Date() })
    .onConflictDoUpdate({ target: whatsappConnection.userId, set: { phoneId, tokenEnc: encryptSecret(token), updatedAt: new Date() } });
}

export async function deleteWhatsappConnection(userId: string): Promise<void> {
  await db.delete(whatsappConnection).where(eq(whatsappConnection.userId, userId));
}

/** Envia uma mensagem de texto. Chamar só após confirmação explícita. */
export async function sendWhatsApp(userId: string, to: string, text: string): Promise<{ id: string }> {
  const creds = await getWhatsappCreds(userId);
  if (!creds) throw new Error("WhatsApp não configurado");
  const res = await fetch(`https://graph.facebook.com/v21.0/${creds.phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
  });
  if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { messages?: { id: string }[] };
  return { id: data.messages?.[0]?.id ?? "" };
}
