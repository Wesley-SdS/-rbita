/**
 * TTS via Gemini (voz da Órbita).
 *
 * Roda no servidor Next, não no serviço Python: a chave já vive na Vercel e
 * assim a fala não depende do Render (que hiberna no plano free e levaria ~40s
 * para acordar). O Piper continua como fallback em `/api/tts`.
 *
 * O Gemini devolve PCM cru (16 bits, mono, 24 kHz); o navegador precisa de WAV,
 * então montamos o cabeçalho de 44 bytes aqui.
 */

const DEFAULT_MODEL = "gemini-2.5-flash-preview-tts";
const DEFAULT_VOICE = "Sulafat"; // feminina, calorosa — escolhida em teste cego
const SAMPLE_RATE = 24000;

function apiKey(): string | undefined {
  return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
}

export function geminiTtsAvailable(): boolean {
  return !!apiKey();
}

/** Envolve o PCM cru num contêiner WAV para o <audio> do navegador tocar. */
function pcmToWav(pcm: Buffer, rate = SAMPLE_RATE): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); // tamanho do bloco fmt
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); // byte rate (16 bits mono)
  h.writeUInt16LE(2, 32); // block align
  h.writeUInt16LE(16, 34); // bits por amostra
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Sintetiza `text` e devolve um WAV. Lança se a API falhar. */
export async function synthesizeGemini(text: string, signal?: AbortSignal): Promise<Buffer> {
  const key = apiKey();
  if (!key) throw new Error("gemini_tts_sem_chave");

  // var própria: cada provedor tem seu catálogo, um nome não vale no outro
  const model = process.env.TTS_GEMINI_MODEL ?? DEFAULT_MODEL;
  const voice = process.env.TTS_GEMINI_VOICE ?? DEFAULT_VOICE;
  // instrução de estilo opcional: o Gemini aceita direção em linguagem natural
  const style = process.env.TTS_GEMINI_STYLE?.trim();
  const prompt = style ? `${style}: ${text}` : text;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      }),
      signal,
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`gemini_tts_${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
  };
  const b64 = json.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!b64) throw new Error("gemini_tts_sem_audio");

  return pcmToWav(Buffer.from(b64, "base64"));
}
