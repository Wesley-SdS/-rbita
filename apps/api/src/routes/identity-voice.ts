import { z } from "zod";
import { enrollVoice, identifyVoice, recomputeVoiceSignatures, voiceEnrollmentSummary } from "@orbita/core/identity/voice";
import { PerceptionError, perceptionHealth } from "@orbita/core/perception/client";
import { settings } from "@orbita/core/settings/index";
import type { RouteCtx } from "../http/web";
import { domainError, ownerOf } from "../http/owner-route";

/** Erro da percepção vira o status dela (503 fora do ar, 422 áudio ruim). */
function erro(e: unknown): Response {
  if (e instanceof PerceptionError) return Response.json({ error: e.message }, { status: e.status });
  return domainError(e);
}

async function lerAudio(req: Request, acao: string): Promise<{ form: FormData; bytes: Uint8Array; mime: string } | Response> {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) return Response.json({ error: "Arquivo de áudio ausente" }, { status: 400 });
  // cadastrar guarda o áudio cifrado no banco (teto em MB); identificar é um
  // trecho curto e usa o mesmo teto do trecho que o chat manda (em KB)
  const maxBytes =
    acao === "cadastrar"
      ? (await settings.get("identity.enrollMaxMb")) * 1024 * 1024
      : (await settings.get("identity.commandClipMaxKB")) * 1024;
  if (file.size > maxBytes) {
    return Response.json({ error: `Áudio maior que o limite de ${Math.round(maxBytes / 1024)} KB para esta ação.` }, { status: 413 });
  }
  return { form, bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type || "audio/webm" };
}

/** GET: assinaturas por pessoa (quantidade por modelo) e se o serviço local está de pé. */
export async function GET(_req: Request, ctx: RouteCtx) {
  const o = await ownerOf(ctx);
  if (o instanceof Response) return o;
  const [resumo, saude, modelo] = await Promise.all([voiceEnrollmentSummary(o.userId), perceptionHealth(), settings.get("identity.voiceModel")]);
  return Response.json({ modelo, percepcao: saude ? { ok: true, disponiveis: saude.disponiveis } : { ok: false }, porPessoa: resumo });
}

const Acao = z.enum(["cadastrar", "identificar", "recalcular"]);

/**
 * POST multipart:
 *   acao=cadastrar  personId + file (30 a 60 s de fala, com consentimento de voz)
 *   acao=identificar file (quem é esta voz? auditado)
 *   acao=recalcular  (sem arquivo: refaz assinaturas depois de trocar o modelo)
 */
export async function POST(req: Request, ctx: RouteCtx) {
  const o = await ownerOf(ctx);
  if (o instanceof Response) return o;
  const acao = Acao.safeParse(new URL(req.url).searchParams.get("acao"));
  if (!acao.success) return Response.json({ error: "acao deve ser cadastrar, identificar ou recalcular" }, { status: 400 });
  try {
    if (acao.data === "recalcular") return Response.json(await recomputeVoiceSignatures(o.userId));
    const a = await lerAudio(req, acao.data);
    if (a instanceof Response) return a;
    if (acao.data === "identificar") {
      const r = await identifyVoice(o.userId, a.bytes, a.mime, "tela");
      return Response.json({ outcome: r.outcome, personId: r.personId, name: r.name, score: r.score, runnerUp: r.runnerUp, reason: r.reason ?? null, speechS: r.speechS });
    }
    const personId = z.string().uuid().safeParse(a.form.get("personId"));
    if (!personId.success) return Response.json({ error: "personId inválido" }, { status: 400 });
    return Response.json(await enrollVoice(o.userId, personId.data, a.bytes, a.mime, "cadastro"));
  } catch (e) {
    return erro(e);
  }
}
