import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { pushSubscription } from "@/lib/db/push-schema";
import { getSession } from "@/lib/session";
import { pushEnabled } from "@/lib/push/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Chave pública VAPID + se o push está habilitado (para o cliente decidir). */
export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  return Response.json({ enabled: pushEnabled(), publicKey: process.env.VAPID_PUBLIC_KEY ?? null });
}

const SubSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(500) }),
});

/** Registra (ou atualiza) a inscrição do navegador atual. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const parsed = SubSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Inscrição inválida" }, { status: 400 });

  const { endpoint, keys } = parsed.data;
  await db
    .insert(pushSubscription)
    .values({ endpoint, userId: session.user.id, p256dh: keys.p256dh, auth: keys.auth })
    .onConflictDoUpdate({
      target: pushSubscription.endpoint,
      set: { userId: session.user.id, p256dh: keys.p256dh, auth: keys.auth },
    });
  return Response.json({ ok: true });
}

/** Remove a inscrição (usuário desativou as notificações neste navegador). */
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const endpoint = new URL(req.url).searchParams.get("endpoint");
  if (!endpoint) return Response.json({ error: "endpoint obrigatório" }, { status: 400 });
  await db
    .delete(pushSubscription)
    .where(and(eq(pushSubscription.endpoint, endpoint), eq(pushSubscription.userId, session.user.id)));
  return Response.json({ ok: true });
}
