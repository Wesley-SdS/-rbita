import { z } from "zod";
import { enrollFace, faceEnrollmentSummary, identifyFace, recomputeFaceSignatures } from "@orbita/core/identity/face";
import { PerceptionError, perceptionHealth } from "@orbita/core/perception/client";
import { settings } from "@orbita/core/settings/index";
import type { RouteCtx } from "../http/web";
import { domainError, ownerOf } from "../http/owner-route";

function erro(e: unknown): Response {
  if (e instanceof PerceptionError) return Response.json({ error: e.message }, { status: e.status });
  return domainError(e);
}

/** GET: fotos por pessoa (por backend), backend atual e saúde do serviço local. */
export async function GET(_req: Request, ctx: RouteCtx) {
  const o = await ownerOf(ctx);
  if (o instanceof Response) return o;
  const [resumo, saude, backend] = await Promise.all([faceEnrollmentSummary(o.userId), perceptionHealth(), settings.get("identity.faceBackend")]);
  return Response.json({ backend, percepcao: saude ? { ok: true, disponiveis: saude.disponiveis } : { ok: false }, porPessoa: resumo });
}

const Acao = z.enum(["cadastrar", "identificar", "recalcular"]);

/**
 * POST multipart:
 *   acao=cadastrar   personId + file (foto com um rosto só, com consentimento de rosto)
 *   acao=identificar file (de quem é este rosto? auditado, sem criar desconhecido)
 *   acao=recalcular  (sem arquivo: refaz assinaturas depois de trocar o backend)
 */
export async function POST(req: Request, ctx: RouteCtx) {
  const o = await ownerOf(ctx);
  if (o instanceof Response) return o;
  const acao = Acao.safeParse(new URL(req.url).searchParams.get("acao"));
  if (!acao.success) return Response.json({ error: "acao deve ser cadastrar, identificar ou recalcular" }, { status: 400 });
  try {
    if (acao.data === "recalcular") return Response.json(await recomputeFaceSignatures(o.userId));

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!form || !(file instanceof File)) return Response.json({ error: "Arquivo de imagem ausente" }, { status: 400 });
    const maxMb = await settings.get("identity.faceEnrollMaxMb");
    if (file.size > maxMb * 1024 * 1024) return Response.json({ error: `Imagem maior que ${maxMb} MB` }, { status: 413 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = file.type || "image/jpeg";

    if (acao.data === "identificar") {
      const r = await identifyFace(o.userId, bytes, mime, { source: "tela" });
      if (!r) return Response.json({ outcome: "sem_rosto" });
      return Response.json({ outcome: r.outcome, personId: r.personId, name: r.name, score: r.score, reason: r.reason ?? null, faceSize: r.faceSize });
    }
    const personId = z.string().uuid().safeParse(form.get("personId"));
    if (!personId.success) return Response.json({ error: "personId inválido" }, { status: 400 });
    return Response.json(await enrollFace(o.userId, personId.data, bytes, mime, "cadastro"));
  } catch (e) {
    return erro(e);
  }
}
