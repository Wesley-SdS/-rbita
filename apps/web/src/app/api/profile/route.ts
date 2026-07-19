import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { profile } from "@/lib/db/profile-schema";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULTS = { assistantName: "Órbita", userName: null as string | null, persona: null as string | null };

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const [row] = await db.select().from(profile).where(eq(profile.userId, session.user.id)).limit(1);
  return Response.json({ profile: row ?? { userId: session.user.id, ...DEFAULTS } });
}

const PutSchema = z.object({
  assistantName: z.string().trim().min(1).max(40).optional(),
  userName: z.string().trim().max(40).nullish(),
  persona: z.string().trim().max(2000).nullish(),
});

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const parsed = PutSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });

  const v = parsed.data;
  const values = {
    userId: session.user.id,
    assistantName: v.assistantName ?? DEFAULTS.assistantName,
    userName: v.userName ?? null,
    persona: v.persona ?? null,
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(profile)
    .values(values)
    .onConflictDoUpdate({
      target: profile.userId,
      set: { assistantName: values.assistantName, userName: values.userName, persona: values.persona, updatedAt: values.updatedAt },
    })
    .returning();
  return Response.json({ profile: row });
}
