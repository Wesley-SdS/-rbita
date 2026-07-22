"use client";

import { type Dispatch, type MutableRefObject, type SetStateAction, useEffect, useRef, useState } from "react";
import type { OrbMode } from "@/components/orb";
import type { Msg } from "@/components/console/types";
import { LocalTTS, WakeListener, recordUntilSilence } from "@/lib/voice/engine";
import { RealtimeSession } from "@/lib/voice/realtime";

// ── Web Speech API (ditado ao vivo no navegador) ─────────────────────────────
// Não está no lib.dom padrão do TS; tipamos só o que usamos. Roda no aparelho
// (Chrome/Edge/Safari, incl. mobile), mostra resultado parcial na hora e não
// faz upload — muito mais fluido que gravar → subir → transcrever.
interface SpeechResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [i: number]: { readonly transcript: string };
}
interface SpeechEventLike {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [i: number]: SpeechResultLike };
}
interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onresult: ((e: SpeechEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => RecognitionLike;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface Params {
  modeRef: MutableRefObject<OrbMode>;
  setMode: Dispatch<SetStateAction<OrbMode>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setMessages: Dispatch<SetStateAction<Msg[]>>;
  input: string; // p/ seeScreen (usa o texto do compositor como pergunta)
  setInput: Dispatch<SetStateAction<string>>; // p/ sendAudioFile (coloca a transcrição no compositor)
  /** Ponte p/ o chat. Ref atualizada a cada render — sem stale closure. */
  sendMessageRef: MutableRefObject<((content: string) => void) | null>;
}

const MAX_TTS_FALHAS = 2;

/**
 * Encapsula todo o caminho de voz: TTS (Gemini/Piper + fallback navegador),
 * wake word "Ei Órbita", gravação/transcrição do microfone, "ver a tela" e o
 * modo tempo real (S2S). Não conhece o chat diretamente: envia mensagens pela
 * `sendMessageRef`, o que quebra o ciclo chat↔voz.
 */
export function useVoice(p: Params) {
  const [voiceOn, setVoiceOn] = useState(true);
  const [recording, setRecording] = useState(false);
  const [wakeOn, setWakeOn] = useState(false);
  const [realtimeEnabled, setRealtimeEnabled] = useState(false); // S2S premium disponível?
  const [realtimeOn, setRealtimeOn] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const dictRef = useRef<RecognitionLike | null>(null); // ditado ao vivo em curso
  const chunksRef = useRef<Blob[]>([]);
  const ttsRef = useRef<LocalTTS | null>(null);
  const wakeRef = useRef<WakeListener | null>(null);
  const rtRef = useRef<RealtimeSession | null>(null);
  const audioFileRef = useRef<HTMLInputElement | null>(null);
  // falhas seguidas do /api/tts; após MAX_TTS_FALHAS usa a voz do navegador.
  // tolera >1 porque um 429 momentâneo do Gemini não deve custar a sessão inteira.
  const ttsFalhasRef = useRef<number>(0);

  function speakBrowser(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) { p.setMode("standby"); return; }
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/[#*_`>]/g, ""));
      const v = speechSynthesis.getVoices().find((x) => /pt.?BR/i.test(x.lang)) ?? null;
      if (v) u.voice = v;
      u.lang = v?.lang ?? "pt-BR";
      u.rate = 1.03;
      u.onstart = () => p.setMode("speaking");
      u.onend = () => p.setMode("standby");
      speechSynthesis.speak(u);
    } catch {
      p.setMode("standby");
    }
  }

  /** Fala pelo /api/tts (Gemini → Piper); cai para o navegador se insistir em falhar. */
  async function speak(text: string) {
    if (!voiceOn) { p.setMode("standby"); return; }
    if (ttsFalhasRef.current < MAX_TTS_FALHAS) {
      try {
        if (!ttsRef.current) ttsRef.current = new LocalTTS();
        await ttsRef.current.speak(text, { onStart: () => p.setMode("speaking"), onEnd: () => p.setMode("standby") });
        ttsFalhasRef.current = 0; // voltou a funcionar
        return;
      } catch {
        ttsFalhasRef.current++;
      }
    }
    speakBrowser(text);
  }

  /** Para a fala imediatamente (barge-in) e libera o estado (evita travar em "speaking"). */
  function stopSpeaking() {
    ttsRef.current?.stop();
    if (typeof window !== "undefined" && "speechSynthesis" in window) speechSynthesis.cancel();
    if (p.modeRef.current === "speaking") { p.modeRef.current = "standby"; p.setMode("standby"); }
  }

  /** "Ver a tela": captura um frame da tela compartilhada e pede análise à Órbita. */
  async function seeScreen() {
    if (p.modeRef.current !== "standby") return;
    let stream: MediaStream | null = null;
    try {
      stream = await (navigator.mediaDevices as MediaDevices & { getDisplayMedia: (c: unknown) => Promise<MediaStream> }).getDisplayMedia({ video: true });
      const video = document.createElement("video");
      video.srcObject = stream;
      await video.play();
      await new Promise((r) => setTimeout(r, 400)); // deixa o primeiro frame chegar
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = canvas.toDataURL("image/jpeg", 0.6);
      stream.getTracks().forEach((t) => t.stop());

      const question = p.input.trim() || "O que você vê na minha tela? Me ajude com o que estou fazendo.";
      p.setInput("");
      p.setMessages((m) => [...m, { role: "user", content: "🖥️ " + question }, { role: "assistant", content: "" }]);
      p.setMode("studying");
      const r = await fetch("/api/vision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image, question }) });
      const d = await r.json();
      p.setMessages((m) => { const c = [...m]; c[c.length - 1] = { role: "assistant", content: d.answer ?? ("⚠ " + (d.error ?? "falha")) }; return c; });
      p.setMode("standby");
      if (d.answer && voiceOn) void speak(d.answer);
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      p.setMode("standby");
      if (!(e instanceof Error && e.name === "NotAllowedError")) p.setError("Não foi possível capturar a tela.");
    }
  }

  /** Transcreve um arquivo de áudio enviado e coloca o texto no composer. */
  async function sendAudioFile(file: File) {
    p.setMode("studying");
    try {
      const fd = new FormData();
      fd.append("file", file, file.name || "audio.webm");
      const r = await fetch("/api/stt", { method: "POST", body: fd });
      const d = await r.json();
      p.setMode("standby");
      if (d.text?.trim()) p.setInput((prev) => (prev ? prev + " " : "") + d.text.trim());
      else p.setError("Não consegui transcrever o áudio.");
    } catch {
      p.setMode("standby");
      p.setError("Falha ao transcrever o áudio.");
    }
  }

  /** Fluxo mãos-livres: grava o comando até o silêncio, transcreve e envia. */
  async function voiceCommand() {
    if (p.modeRef.current !== "standby") return;
    p.setMode("listening");
    try {
      const blob = await recordUntilSilence({ onSpeech: () => p.setMode("listening") });
      if (!blob) { p.setMode("standby"); return; }
      p.setMode("studying");
      const fd = new FormData();
      fd.append("file", blob, "audio.webm");
      const r = await fetch("/api/stt", { method: "POST", body: fd });
      const d = await r.json();
      if (d.text?.trim()) { p.setMode("standby"); p.sendMessageRef.current?.(d.text.trim()); }
      else { p.setMode("standby"); }
    } catch {
      p.setMode("standby");
      p.setError("Falha ao capturar o comando de voz.");
    }
  }

  /** Modo tempo real (S2S premium via OpenAI Realtime). */
  async function toggleRealtime() {
    if (rtRef.current?.active) {
      rtRef.current.stop();
      rtRef.current = null;
      setRealtimeOn(false);
      p.setMode("standby");
      return;
    }
    // não mistura com o wake word local
    if (wakeRef.current?.active) { wakeRef.current.stop(); wakeRef.current = null; setWakeOn(false); }
    stopSpeaking();
    const rt = new RealtimeSession({
      onState: (s) => p.setMode(s === "speaking" ? "speaking" : s === "connecting" ? "connecting" : s === "listening" ? "listening" : "standby"),
      onError: () => { p.setError("Falha no modo tempo real."); rt.stop(); rtRef.current = null; setRealtimeOn(false); },
      onTranscript: (role, text) => p.setMessages((m) => [...m, { role, content: text }]),
    });
    try {
      setRealtimeOn(true);
      await rt.start();
      rtRef.current = rt;
    } catch (e) {
      setRealtimeOn(false);
      p.setError(e instanceof Error ? e.message : "Não foi possível iniciar o tempo real.");
    }
  }

  async function toggleWake() {
    if (wakeRef.current?.active) {
      wakeRef.current.stop();
      wakeRef.current = null;
      setWakeOn(false);
      return;
    }
    try {
      const cfg = await fetch("/api/voice-config").then((r) => r.json());
      if (!cfg.up) {
        // A FALA já funciona sem o serviço (TTS roda no servidor). Só o wake word
        // "Ei Órbita" mãos-livres depende do serviço de voz. Mensagem sem jargão.
        p.setError("Wake word “Ei Órbita” indisponível: o serviço de voz não está conectado. Você ainda pode falar pelo botão do microfone.");
        return;
      }
      const listener = new WakeListener(cfg.wsWakeUrl, {
        onWake: () => {
          stopSpeaking(); // barge-in ao ouvir "Ei Órbita" (libera o estado)
          if (p.modeRef.current === "standby") void voiceCommand();
        },
        // barge-in por voz: se a Órbita está falando e o usuário fala alto, interrompe
        onEnergy: (rms) => {
          if (ttsRef.current?.speaking && rms > 0.06) stopSpeaking();
        },
        onError: () => p.setError("Falha no wake word (serviço de voz)."),
      });
      await listener.start();
      wakeRef.current = listener;
      setWakeOn(true);
    } catch {
      p.setError("Sem acesso ao microfone para wake word.");
    }
  }

  /**
   * Microfone: prefere o DITADO AO VIVO (Web Speech API) — o texto aparece no
   * compositor conforme o usuário fala e é enviado ao terminar, sem upload nem
   * transcrição no servidor. Cai para o fluxo antigo (gravar webm → /api/stt)
   * só em navegadores sem a API.
   */
  async function toggleMic() {
    if (dictRef.current) { dictRef.current.stop(); return; } // já ditando → encerra
    if (recording) { recRef.current?.stop(); return; }       // fluxo antigo → para
    if (p.modeRef.current !== "standby") return;

    const Ctor = getRecognitionCtor();
    if (Ctor) { startDictation(Ctor); return; }
    await startAudioFallback();
  }

  /** Ditado ao vivo: escreve no compositor enquanto fala; ao parar, envia. */
  function startDictation(Ctor: RecognitionCtor) {
    const rec = new Ctor();
    rec.lang = "pt-BR";
    rec.interimResults = true;   // mostra o parcial na hora (feedback no textarea)
    rec.continuous = false;      // encerra sozinho após uma pausa na fala
    const base = p.input.trim(); // preserva o que já estava digitado
    let final = "";
    const compose = (interim: string) => ((base ? base + " " : "") + (final + interim)).trimStart();

    rec.onstart = () => { setRecording(true); p.setMode("listening"); };
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      p.setInput(compose(interim)); // texto aparecendo ao vivo
    };
    rec.onerror = (ev) => {
      dictRef.current = null;
      setRecording(false);
      p.setMode("standby");
      if (ev.error === "no-speech") p.setError("Não ouvi nada — toque e fale de novo.");
      else if (ev.error !== "aborted") p.setError("Reconhecimento de voz indisponível neste navegador.");
    };
    rec.onend = () => {
      dictRef.current = null;
      setRecording(false);
      p.setMode("standby");
      const text = compose("").trim();
      p.setInput("");
      if (text) p.sendMessageRef.current?.(text); // fala → texto → envia
    };
    dictRef.current = rec;
    rec.start();
  }

  /** Fallback p/ navegadores sem Web Speech: grava webm e transcreve no servidor. */
  async function startAudioFallback() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        p.setMode("studying");
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const fd = new FormData();
        fd.append("file", blob, "audio.webm");
        try {
          const r = await fetch("/api/stt", { method: "POST", body: fd });
          const d = await r.json();
          p.setMode("standby");
          if (d.text?.trim()) p.sendMessageRef.current?.(d.text.trim());
          else p.setError("Não entendi o áudio.");
        } catch {
          p.setMode("standby");
          p.setError("Falha na transcrição.");
        }
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
      p.setMode("listening");
    } catch {
      p.setError("Sem acesso ao microfone.");
    }
  }

  /**
   * Pós-resposta do chat: fala (se a voz estiver ligada) e, com o wake ativo,
   * re-arma a escuta para um follow-up sem repetir "Ei Órbita". Retorna true
   * quando a voz assumiu a transição de estado (chat não deve forçar standby).
   */
  function handleAssistantResponse(text: string): boolean {
    if (!voiceOn) return false;
    void speak(text).then(() => {
      if (wakeRef.current?.active && p.modeRef.current === "standby") void voiceCommand();
    });
    return true;
  }

  useEffect(() => {
    // config de realtime (opcional) buscado no cliente; limpa listeners no unmount.
    fetch("/api/realtime/config").then((r) => r.json()).then((d) => setRealtimeEnabled(!!d.enabled)).catch(() => {});
    return () => { wakeRef.current?.stop(); ttsRef.current?.stop(); rtRef.current?.stop(); dictRef.current?.abort(); };
  }, []);

  return {
    voiceOn, setVoiceOn, recording, wakeOn, realtimeEnabled, realtimeOn,
    audioFileRef, speak, stopSpeaking, seeScreen, sendAudioFile,
    voiceCommand, toggleRealtime, toggleWake, toggleMic, handleAssistantResponse,
  };
}
