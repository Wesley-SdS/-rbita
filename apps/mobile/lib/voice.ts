import { Audio } from "expo-av";
import * as SecureStore from "expo-secure-store";
import { getBaseUrl } from "./api";

/**
 * Voz no mobile — paridade com o web: grava o microfone e transcreve via o
 * mesmo /api/stt (faster-whisper local, ou AssemblyAI de fallback), e fala a
 * resposta tocando o WAV do /api/tts (Piper local). Endpoints agnósticos de
 * plataforma já existentes no backend.
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

/** Fala um texto tocando o WAV do TTS local. */
export async function speak(text: string): Promise<void> {
  const clean = text.replace(/[#*_`>[\]]/g, "").slice(0, 2000);
  if (!clean.trim()) return;
  const base = await getBaseUrl();
  const res = await fetch(base + "/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await cookie()) },
    body: JSON.stringify({ text: clean }),
  });
  if (!res.ok) return;
  // salva o WAV num arquivo temporário e toca
  const blob = await res.blob();
  const reader = new FileReader();
  const dataUrl: string = await new Promise((resolve) => {
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
  const { sound } = await Audio.Sound.createAsync({ uri: dataUrl }, { shouldPlay: true });
  sound.setOnPlaybackStatusUpdate((s) => {
    if (s.isLoaded && s.didJustFinish) void sound.unloadAsync();
  });
}
