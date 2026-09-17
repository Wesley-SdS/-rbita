import { settings } from "@orbita/core/settings/index";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";

/**
 * Limites que o NAVEGADOR precisa respeitar para gravar voz e rosto. Existem
 * como chave em `setting` (com tela): sem esta rota, o cliente teria os mesmos
 * números chumbados, e mudar a config na tela quebraria o cadastro em silêncio.
 */
export async function GET(_req: Request, ctx: RouteCtx) {
  const s = sessionOf(ctx);
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const cfg = await settings.getMany([
    "identity.commandClipMaxKB",
    "identity.commandClipSeconds",
    "identity.voiceEnrollMinSeconds",
    "identity.voiceEnrollRecordSeconds",
    "identity.voiceTestRecordSeconds",
    "identity.enrollMaxMb",
    "identity.faceEnrollMaxMb",
  ]);
  return Response.json({
    clipMaxKB: cfg["identity.commandClipMaxKB"],
    clipSegundos: cfg["identity.commandClipSeconds"],
    // a tela grava por este tempo; o servidor recusa abaixo de `falaMinima`
    cadastroVozSegundos: Math.max(cfg["identity.voiceEnrollRecordSeconds"], cfg["identity.voiceEnrollMinSeconds"]),
    falaMinimaSegundos: cfg["identity.voiceEnrollMinSeconds"],
    testeVozSegundos: cfg["identity.voiceTestRecordSeconds"],
    audioMaxMb: cfg["identity.enrollMaxMb"],
    fotoMaxMb: cfg["identity.faceEnrollMaxMb"],
  });
}
