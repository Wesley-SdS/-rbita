import webpush from "web-push";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pushSubscription } from "@/lib/db/push-schema";
import { log } from "@/lib/observability/logger";

let configured: boolean | null = null;

/** Configura o VAPID uma vez; retorna false se as chaves não estiverem no env. */
function ensureConfigured(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:orbita@localhost";
  if (!pub || !priv) {
    configured = false;
    return false;
  }
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

/** Web Push está habilitado (chaves presentes)? */
export function pushEnabled(): boolean {
  return ensureConfigured();
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/**
 * Envia uma notificação push para todas as inscrições do usuário.
 * Inscrições mortas (404/410) são removidas automaticamente.
 * Best-effort: nunca lança — retorna quantas foram entregues.
 */
export async function sendPush(userId: string, payload: PushPayload): Promise<{ sent: number; pruned: number }> {
  if (!ensureConfigured()) return { sent: 0, pruned: 0 };

  const subs = await db.select().from(pushSubscription).where(eq(pushSubscription.userId, userId));
  if (!subs.length) return { sent: 0, pruned: 0 };

  const data = JSON.stringify({ title: payload.title, body: payload.body, url: payload.url ?? "/app" });
  let sent = 0;
  let pruned = 0;

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, data);
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db.delete(pushSubscription).where(eq(pushSubscription.endpoint, s.endpoint));
          pruned++;
        } else {
          log.error("push.send", { userId, status: status ?? 0 });
        }
      }
    }),
  );

  return { sent, pruned };
}
