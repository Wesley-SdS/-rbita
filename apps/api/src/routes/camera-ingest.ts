import { z } from "zod";
import { cameraByToken, ingestCameraEvent } from "@orbita/core/cameras/ingest";
import { settings } from "@orbita/core/settings/index";
import { rateLimit, tooMany } from "@orbita/core/ratelimit";
import type { RouteCtx } from "../http/web";

/**
 * POST /api/cameras/ingest — chamado pelo Frigate (ou script equivalente),
 * NÃO por um navegador logado: a autenticação é o `token` da própria câmera,
 * não a sessão do Better Auth (por isso não chama `sessionOf`). Cada câmera
 * tem o próprio token, gerado em POST /api/cameras; revogar é deletar a
 * câmera e cadastrar outra.
 */
const Body = z.object({
  token: z.string().min(10).max(200),
  label: z.string().min(1).max(60),
  zone: z.string().max(60).optional(),
  score: z.number().min(0).max(1).optional(),
  snapshot: z
    .string()
    // teto acima do máximo permitido em `cameras.snapshotMaxKB` (4000 KB ≈
    // 5.461.333 caracteres em base64), para a config nunca prometer um
    // tamanho que o schema já barraria antes de chegar lá.
    .max(5_500_000)
    .refine((s) => s.startsWith("data:image/"), "snapshot precisa ser uma data URL de imagem")
    .optional(),
});

export async function POST(req: Request, _ctx: RouteCtx) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });

  const cam = await cameraByToken(parsed.data.token);
  if (!cam) return Response.json({ error: "Token inválido" }, { status: 401 });
  if (!cam.enabled) return Response.json({ error: "Câmera desligada" }, { status: 403 });

  // limite por câmera (não global): cada uma tem o próprio balde, e um
  // evento vira `camera.detected` no event bus, que pode disparar regra com
  // ação `prompt` (chamada de modelo) — sem limite, um Frigate mal ajustado
  // vira custo e ruído sem fim (achado de auditoria pós-Onda 6).
  const limitPerMin = await settings.get("cameras.ingestRateLimitPerMinute");
  const rl = rateLimit(`cameras.ingest:${cam.id}`, limitPerMin, 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);

  const { id } = await ingestCameraEvent(cam, {
    label: parsed.data.label,
    zone: parsed.data.zone ?? null,
    score: parsed.data.score ?? null,
    snapshot: parsed.data.snapshot ?? null,
  });
  return Response.json({ ok: true, id });
}
