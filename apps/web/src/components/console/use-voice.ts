"use client";

import { type Dispatch, type MutableRefObject, type SetStateAction, useEffect, useRef, useState } from "react";
import type { OrbMode } from "@/components/orb";
import type { Msg } from "@/components/console/types";
import { LocalTTS, WakeListener, recordUntilSilence } from "@/lib/voice/engine";
import { RealtimeSession } from "@/lib/voice/realtime";

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

/**
 * Encapsula todo o caminho de voz: TTS (Piper local + fallback navegador),
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
  const chunksRef = useRef<Blob[]>([]);
  const ttsRef = useRef<LocalTTS | null>(null);
  const wakeRef = useRef<WakeListener | null>(null);
  const rtRef = useRef<RealtimeSession | null>(null);
  const audioFileRef = useRef<HTMLInputElement | null>(null);
  const ttsLocalOkRef = useRef<boolean>(true); // cai p/ navegador se o TTS local falhar

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

  /** Fala preferindo o TTS local (Piper); cai para o navegador se indisponível. */
  async function speak(text: string) {
    if (!voiceOn) { p.setMode("standby"); return; }
    if (ttsLocalOkRef.current) {
      try {
        if (!ttsRef.current) ttsRef.current = new LocalTTS();
        await ttsRef.current.speak(text, { onStart: () => p.setMode("speaking"), onEnd: () => p.setMode("standby") });
        return;
      } catch {
        ttsLocalOkRef.current = false; // uma falha → usa navegador daqui pra frente
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
      if (!cfg.up) { p.setError("Serviço de voz offline — wake word precisa do apps/voice rodando."); return; }
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

  async function toggleMic() {
    if (recording) { recRef.current?.stop(); return; }
    if (p.modeRef.current !== "standby") return;
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
    return () => { wakeRef.current?.stop(); ttsRef.current?.stop(); rtRef.current?.stop(); };
  }, []);

  return {
    voiceOn, setVoiceOn, recording, wakeOn, realtimeEnabled, realtimeOn,
    audioFileRef, speak, stopSpeaking, seeScreen, sendAudioFile,
    voiceCommand, toggleRealtime, toggleWake, toggleMic, handleAssistantResponse,
  };
}
