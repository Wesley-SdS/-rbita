import { Audio } from "expo-av";
import * as SecureStore from "expo-secure-store";
import { getBaseUrl } from "./api";
import { splitFala } from "./split-fala";

/**
 * Voz no mobile — paridade com o web. Grava o microfone e transcreve via o mesmo
 * `/api/stt` (faster-whisper local, ou AssemblyAI de fallback), e fala a resposta
 * tocando o áudio do `/api/tts`. O provedor da fala é decidido no servidor
 * (Edge/Vivienne → Gemini → Piper), então o app não precisa saber qual voz é —
 * só toca o que chega. O formato pode ser MP3 (Edge) ou WAV (Gemini/Piper); o
 * `readAsDataURL` embute o mime e o expo-av toca os dois.
 */
async function cookie(): Promise<Record<string, string>> {
  const c = await SecureStore.getItemAsync("orbita.cookie");
  return c ? { Cookie: c } : {};
}

let recording: Audio.Recording | null = null;

/** Começa a gravar (pede permissão do microfone). */
export async function startRecording(): Promise<void> {
  const perm = await Audio.requestPermissionsAsync();
  if (!perm.granted) throw new Error("permissão de microfone negada");
  await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
  const rec = new Audio.Recording();
  await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
  await rec.startAsync();
  recording = rec;
}

/** Para a gravação e transcreve via /api/stt. Retorna o texto. */
export async function stopRecordingAndTranscribe(): Promise<string> {
  if (!recording) return "";
  await recording.stopAndUnloadAsync();
  const uri = recording.getURI();
  recording = null;
  if (!uri) return "";
  const base = await getBaseUrl();
  const fd = new FormData();
  // React Native FormData aceita { uri, name, type }
  fd.append("file", { uri, name: "audio.m4a", type: "audio/m4a" } as unknown as Blob);
  const res = await fetch(base + "/api/stt", { method: "POST", headers: await cookie(), body: fd });
  const d = (await res.json()) as { text?: string };
  return d.text?.trim() ?? "";
}

// ── Fala ──────────────────────────────────────────────────────────────
// Toca a resposta por trechos: enquanto um toca, o próximo já é sintetizado.
// Um contador global funciona como "barge-in" — uma fala nova (ou stopSpeaking)
// invalida a anterior sem precisar de AbortController espalhado.

let somAtual: Audio.Sound | null = null;
let falaToken = 0;

/** Interrompe a fala em curso (barge-in / nova mensagem). */
export async function stopSpeaking(): Promise<void> {
  falaToken++; // invalida qualquer loop de fala rodando
  const s = somAtual;
  somAtual = null;
  if (s) {
    try {
      await s.stopAsync();
    } catch {
      /* já parado */
    }
    try {
      await s.unloadAsync();
    } catch {
      /* já descarregado */
    }
  }
}

/** Sintetiza um trecho e devolve um data URL (mime embutido: MP3 ou WAV). */
async function trechoDataUrl(texto: string, headers: Record<string, string>): Promise<string> {
  const base = await getBaseUrl();
  const res = await fetch(base + "/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ text: texto }),
  });
  if (!res.ok) throw new Error("tts_" + res.status);
  const blob = await res.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("tts_read"));
    reader.readAsDataURL(blob);
  });
}

/** Toca um data URL até o fim (ou até stopSpeaking). Resolve nos dois casos. */
function tocar(dataUrl: string): Promise<void> {
  return new Promise<void>((resolve) => {
    Audio.Sound.createAsync({ uri: dataUrl }, { shouldPlay: true })
      .then(({ sound }) => {
        somAtual = sound;
        sound.setOnPlaybackStatusUpdate((s) => {
          const acabou = s.isLoaded && s.didJustFinish;
          const falhou = !s.isLoaded && !!s.error;
          if (acabou || falhou) {
            if (somAtual === sound) somAtual = null;
            void sound.unloadAsync().catch(() => {});
            resolve();
          }
        });
      })
      .catch(() => resolve()); // data URI inválido: não trava o loop
  });
}

interface SpeakOpts {
  onStart?: () => void;
  onEnd?: () => void;
}

/**
 * Fala um texto pelo `/api/tts`, quebrado em trechos para começar antes.
 * `onStart` dispara quando o 1º trecho começa a tocar; `onEnd` quando termina
 * (ou é interrompido). Uma falha de rede não emudece se algo já tocou.
 */
export async function speak(text: string, opts?: SpeakOpts): Promise<void> {
  const clean = text.replace(/[#*_`>[\]]/g, "").slice(0, 2000);
  if (!clean.trim()) return;

  await stopSpeaking(); // corta a fala anterior antes de começar
  const token = ++falaToken;
  const vivo = () => token === falaToken;

  await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
  const trechos = splitFala(clean);
  const hdr = await cookie();

  const pedir = (i: number): Promise<string | Error> | null =>
    i < trechos.length ? trechoDataUrl(trechos[i], hdr).catch((e: unknown) => (e instanceof Error ? e : new Error("tts"))) : null;

  let comecou = false;
  try {
    let prox = pedir(0);
    for (let i = 0; i < trechos.length; i++) {
      if (!prox) break;
      const r = await prox;
      if (!vivo()) return;
      if (r instanceof Error) {
        if (comecou) return; // já falou algo; não estoura por causa da cauda
        throw r;
      }
      prox = pedir(i + 1);
      if (!comecou) {
        comecou = true;
        opts?.onStart?.();
      }
      await tocar(r);
      if (!vivo()) return;
    }
  } finally {
    if (vivo()) opts?.onEnd?.();
  }
}
