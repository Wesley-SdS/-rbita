// Migrada do Next em paridade (apps/web/src/app/api/push/subscribe/route.ts).
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@orbita/db";
import { pushSubscription } from "@orbita/db/push-schema";
import { device } from "@orbita/db/device-schema";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { pushEnabled } from "@orbita/core/push/send";

/** Chave pública VAPID + se o push está habilitado (para o cliente decidir). */
export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  return Response.json({ enabled: pushEnabled(), publicKey: process.env.VAPID_PUBLIC_KEY ?? null });
}

const SubSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(500) }),
  // dispositivo deste navegador (Onda 12): é o que permite avisar no cômodo
  // onde a pessoa está, em vez de tocar em todos os aparelhos da casa
  deviceId: z.string().uuid().nullable().optional(),
});

/** Registra (ou atualiza) a inscrição do navegador atual. */
export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const parsed = SubSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Inscrição inválida" }, { status: 400 });

  const { endpoint, keys, deviceId } = parsed.data;
  // o aparelho decide o cômodo em que o aviso toca: aceitar um id qualquer
  // deixaria a notificação sair no aparelho de outra pessoa da casa
  if (deviceId) {
    const [dono] = await db.select({ id: device.id }).from(device).where(and(eq(device.id, deviceId), eq(device.userId, session.user.id))).limit(1);
    if (!dono) return Response.json({ error: "Aparelho não encontrado" }, { status: 400 });
  }
  // Anti-sequestro: se o endpoint já existe e pertence a OUTRO usuário, recusa —
  // senão bastaria conhecer o endpoint de push da vítima para reassociá-lo.
  const [existing] = await db
    .select({ userId: pushSubscription.userId })
    .from(pushSubscription)
    .where(eq(pushSubscription.endpoint, endpoint))
    .limit(1);
  if (existing && existing.userId !== session.user.id) {
    return Response.json({ error: "Endpoint já registrado" }, { status: 409 });
  }
  await db
    .insert(pushSubscription)
    .values({ endpoint, userId: session.user.id, p256dh: keys.p256dh, auth: keys.auth, deviceId: deviceId ?? null})
    .onConflictDoUpdate({
      target: pushSubscription.endpoint,
      // só atualiza as chaves quando o dono é o próprio usuário (garantido acima)
      set: { p256dh: keys.p256dh, auth: keys.auth, deviceId: deviceId ?? null},
    });
  return Response.json({ ok: true });
}

/** Remove a inscrição (usuário desativou as notificações neste navegador). */
export async function DELETE(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const endpoint = new URL(req.url).searchParams.get("endpoint");
  if (!endpoint) return Response.json({ error: "endpoint obrigatório" }, { status: 400 });
  await db
    .delete(pushSubscription)
    .where(and(eq(pushSubscription.endpoint, endpoint), eq(pushSubscription.userId, session.user.id)));
  return Response.json({ ok: true });
}
