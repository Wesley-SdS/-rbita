import type { SttResult } from "./types";

const API = "https://api.assemblyai.com/v2";

/** Modelos padrão (ordem de prioridade). Configurável por env para que uma
 *  deprecação futura vire mudança de `.env`, não de código. */
function defaultSpeechModels(): string[] {
  const raw = process.env.ASSEMBLYAI_SPEECH_MODELS;
  const parsed = raw?.split(",").map((s) => s.trim()).filter(Boolean);
  return parsed?.length ? parsed : ["universal-3-5-pro", "universal-2"];
}

/** Extrai os modelos sugeridos de um erro de deprecação da AssemblyAI.
 *  Ex.: 'Use speech_models: ["universal-3-5-pro", "universal-2"] instead.' */
function suggestedModels(errorBody: string): string[] | null {
  const m = errorBody.match(/speech_models:\s*\[([^\]]+)\]/i);
  if (!m) return null;
  const models = m[1].split(",").map((s) => s.replace(/["'\s]/g, "")).filter(Boolean);
  return models.length ? models : null;
}

/** Cria a transcrição; se a API rejeitar o modelo por deprecação, lê o
 *  substituto sugerido no próprio erro e re-tenta uma vez (auto-recuperação). */
async function createTranscript(audioUrl: string, apiKey: string, models: string[]): Promise<string> {
  const send = (speechModels: string[]) =>
    fetch(`${API}/transcript`, {
      method: "POST",
      headers: { authorization: apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        audio_url: audioUrl,
        language_code: "pt",
        speech_models: speechModels,
        punctuate: true,
        format_text: true,
      }),
    });

  let res = await send(models);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const suggested = res.status === 400 ? suggestedModels(body) : null;
    if (suggested && suggested.join() !== models.join()) {
      res = await send(suggested); // re-tenta com o modelo que a própria API indicou
      if (!res.ok) throw new Error(`AssemblyAI transcript ${res.status}: ${await res.text().catch(() => "")}`);
    } else {
      throw new Error(`AssemblyAI transcript ${res.status}: ${body}`);
    }
  }
  return ((await res.json()) as { id: string }).id;
}

/**
 * Transcrição via AssemblyAI (base: config de produção da Adalink, atualizada).
 * `speech_models` (plural, em ordem de prioridade) — o singular `speech_model` E o
 * `universal-3-pro` foram DEPRECADOS; o atual é `universal-3-5-pro` (verificado ao
 * vivo). WER estado-da-arte em pt-BR (~3-4% vs ~7-10% do Whisper).
 * Doc: https://www.assemblyai.com/docs/pre-recorded-audio/select-the-speech-model
 */
export async function transcribeWithAssemblyAI(file: File, apiKey: string): Promise<SttResult> {
  // 1) upload do áudio bruto
  const up = await fetch(`${API}/upload`, {
    method: "POST",
    headers: { authorization: apiKey },
    body: Buffer.from(await file.arrayBuffer()),
  });
  if (!up.ok) throw new Error(`AssemblyAI upload ${up.status}`);
  const { upload_url } = (await up.json()) as { upload_url: string };

  // 2) inicia a transcrição (com auto-recuperação de modelo deprecado)
  const id = await createTranscript(upload_url, apiKey, defaultSpeechModels());

  // 3) polling até concluir (~135s máx; comandos de voz completam em poucos segundos)
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch(`${API}/transcript/${id}`, { headers: { authorization: apiKey } });
    const d = (await res.json()) as { status: string; text?: string; language_code?: string; error?: string };
    if (d.status === "completed") {
      return { text: (d.text ?? "").trim(), language: d.language_code ?? "pt", provider: "assemblyai" };
    }
    if (d.status === "error") throw new Error(d.error ?? "assemblyai error");
  }
  throw new Error("assemblyai timeout");
}
