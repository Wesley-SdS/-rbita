import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { camera } from "@orbita/db/camera-schema";
import { ingestCameraEvent } from "@orbita/core/cameras/ingest";
import { settings } from "@orbita/core/settings/index";
import { rateLimit, tooMany } from "@orbita/core/ratelimit";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";

/**
 * POST /api/cameras/quadro — um quadro da câmera DESTE APARELHO.
 *
 * Irmã de `/api/cameras/ingest`, com uma diferença que é o motivo de existir:
 * lá quem publica é o Frigate, um programa de fora, que se autentica pelo
 * token da câmera. Aqui quem publica é o navegador do dono, que já tem sessão.
 *
 * Fazer o navegador usar o caminho do token exigiria guardar um segredo de
 * vida longa no `localStorage` para mandar de volta ao mesmo servidor que já
 * sabe quem ele é. O `GET /api/cameras` nunca devolve o `webhookToken` de
 * propósito, e não é este caso de uso que vai abrir essa porta.
 *
 * Tudo o que vem depois é idêntico: mesmo `ingestCameraEvent`, mesmo evento no
 * barramento, mesma identificação de quem aparece, mesma retenção.
 */
const Body = z.object({
  cameraId: z.string().uuid(),
  label: z.string().min(1).max(60).default("aparelho"),
  snapshot: z
    .string()
    .max(5_500_000)
    .refine((s) => s.startsWith("data:image/"), "snapshot precisa ser uma data URL de imagem"),
});

export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });

  // a câmera tem de ser DESTE usuário: sem o filtro, um id adivinhado
  // publicaria na câmera de outra pessoa da casa
  const [cam] = await db
    .select()
    .from(camera)
    .where(and(eq(camera.id, parsed.data.cameraId), eq(camera.userId, session.user.id)))
    .limit(1);
  if (!cam) return Response.json({ error: "Câmera não encontrada" }, { status: 404 });
  if (!cam.enabled) return Response.json({ error: "Câmera desligada" }, { status: 403 });

  // mesmo balde por câmera do webhook: um laço de captura mal ajustado na aba
  // custa igual a um Frigate mal ajustado
  const limitPerMin = await settings.get("cameras.ingestRateLimitPerMinute");
  const rl = rateLimit(`cameras.ingest:${cam.id}`, limitPerMin, 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);

  const { id } = await ingestCameraEvent(cam, {
    label: parsed.data.label,
    zone: null,
    score: null,
    snapshot: parsed.data.snapshot,
  });
  return Response.json({ ok: true, id });
}
