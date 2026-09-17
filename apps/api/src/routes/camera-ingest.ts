import { z } from "zod";
import { cameraByToken, ingestCameraEvent } from "@orbita/core/cameras/ingest";
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
    .max(3_000_000) // ~2MB em base64; o corte real por KB é feito no ingest, contra `cameras.snapshotMaxKB`
    .refine((s) => s.startsWith("data:image/"), "snapshot precisa ser uma data URL de imagem")
    .optional(),
});

export async function POST(req: Request, _ctx: RouteCtx) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });

  const cam = await cameraByToken(parsed.data.token);
  if (!cam) return Response.json({ error: "Token inválido" }, { status: 401 });
  if (!cam.enabled) return Response.json({ error: "Câmera desligada" }, { status: 403 });

  const { id } = await ingestCameraEvent(cam, {
    label: parsed.data.label,
    zone: parsed.data.zone ?? null,
    score: parsed.data.score ?? null,
    snapshot: parsed.data.snapshot ?? null,
  });
  return Response.json({ ok: true, id });
}
