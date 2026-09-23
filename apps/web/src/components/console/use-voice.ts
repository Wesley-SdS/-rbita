"use client";

import { type Dispatch, type MutableRefObject, type SetStateAction, useEffect, useRef, useState } from "react";
import type { OrbMode } from "@/components/console/types";
import type { Msg } from "@/components/console/types";
import { LocalTTS, WakeListener, recordUntilSilence, type FluxoDeFala } from "@/lib/voice/engine";
import { criarSessaoRealtime, type SessaoRealtime } from "@/lib/voice/realtime";
import { getRecognitionCtor, LocalWake, type RecognitionCtor, type RecognitionLike } from "@/lib/voice/speech";
import { identityLimits } from "@/lib/identity-limits";

/** Controle mínimo de um wake listener (Render ou local): o que o toggle usa. */
type WakeCtl = { stop: () => void; active: boolean; pause?: () => void; resume?: () => void };

interface Params {
  modeRef: MutableRefObject<OrbMode>;
  setMode: Dispatch<SetStateAction<OrbMode>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setMessages: Dispatch<SetStateAction<Msg[]>>;
  input: string; // p/ seeScreen (usa o texto do compositor como pergunta)
  setInput: Dispatch<SetStateAction<string>>; // p/ sendAudioFile (coloca a transcrição no compositor)
  /** Ponte p/ o chat. Ref atualizada a cada render — sem stale closure. `voiceClip`: Onda 9 (quem pediu), só no ditado. */
  sendMessageRef: MutableRefObject<((content: string, voiceClip?: string) => void) | null>;
}

const MAX_TTS_FALHAS = 2;

/**
 * Onda 9 ("quem pediu"): grava um trecho de voz EM PARALELO ao ditado (Web
 * Speech não gera áudio nenhum) para o backend reconhecer quem falou. A janela
 * e o teto vêm da config do dono (`identity.commandClip*`), nunca de constante
 * daqui: os dois lados precisam concordar, senão o servidor descarta o trecho
 * em silêncio. Best-effort de ponta a ponta: sem microfone, sem MediaRecorder
 * ou erro na conversão, o ditado segue exatamente como antes, só sem o trecho.
 */
function startVoiceClip(): { finish: () => Promise<string | undefined> } {
  const limites = identityLimits();
  // teto de memória enquanto grava; a janela real é aplicada no fim, já com a
  // config em mãos (a gravação começa antes da resposta da rota)
  const MAX_PEDACOS = 60;
  const state: { stream: MediaStream | null; recorder: MediaRecorder | null; chunks: Blob[]; stopRequested: boolean } = {
    stream: null,
    recorder: null,
    chunks: [],
    stopRequested: false,
  };

  if (typeof MediaRecorder !== "undefined" && navigator.mediaDevices?.getUserMedia) {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        if (state.stopRequested) { stream.getTracks().forEach((t) => t.stop()); return; } // ditado já encerrou antes do mic liberar
        state.stream = stream;
        const mr = new MediaRecorder(stream);
        mr.ondataavailable = (e) => {
          if (!e.data.size) return;
          state.chunks.push(e.data);
          if (state.chunks.length > MAX_PEDACOS) state.chunks.shift(); // janela deslizante
        };
        state.recorder = mr;
        mr.start(1000); // um pedaço por segundo
      })
      .catch(() => { /* sem acesso ao microfone: segue sem o trecho */ });
  }

  async function finish(): Promise<string | undefined> {
    state.stopRequested = true;
    const mr = state.recorder;
    if (!mr || mr.state === "inactive") {
      state.stream?.getTracks().forEach((t) => t.stop());
      return undefined;
    }
    const { clipSegundos, clipMaxKB } = await limites;
    const parar = await new Promise<Blob[] | null>((resolve) => {
      mr.onstop = () => resolve(state.chunks.length ? state.chunks : null);
      try { mr.stop(); } catch { resolve(null); }
    });
    state.stream?.getTracks().forEach((t) => t.stop()); // libera o mic sempre, com ou sem áudio
    if (!parar) return undefined;
    const tipo = mr.mimeType || "audio/webm";
    const teto = clipMaxKB * 1024;
    // pedaço de 1 s cada: a janela é o fim da gravação, que é onde está o
    // comando. Se ainda passar do teto, encurta em vez de desistir do trecho.
    for (let segundos = Math.min(clipSegundos, parar.length); segundos >= 1; segundos--) {
      const blob = new Blob(parar.slice(-segundos), { type: tipo });
      if (!blob.size || blob.size > teto) continue;
      try {
        return await new Promise<string>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result));
          fr.onerror = () => reject(fr.error);
          fr.readAsDataURL(blob);
        });
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  return { finish };
}

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
  // o que o reconhecedor entendeu por último, para o wake deixar de ser caixa-preta
  const [ultimoOuvido, setUltimoOuvido] = useState("");
  const [realtimeEnabled, setRealtimeEnabled] = useState(false); // S2S premium disponível?
  const [realtimeOn, setRealtimeOn] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const dictRef = useRef<RecognitionLike | null>(null); // ditado ao vivo em curso
  const chunksRef = useRef<Blob[]>([]);
  const ttsRef = useRef<LocalTTS | null>(null);
  const wakeRef = useRef<WakeCtl | null>(null);
  const rtRef = useRef<SessaoRealtime | null>(null);
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

  /** Modo tempo real. Quem atende (Gemini Live ou OpenAI Realtime) é config do dono, decidida no servidor. */
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
    const rt = criarSessaoRealtime({
      onState: (s) => p.setMode(s === "speaking" ? "speaking" : s === "connecting" ? "connecting" : s === "listening" ? "listening" : "standby"),
      onError: () => { p.setError("Falha no modo tempo real."); rt.stop(); rtRef.current = null; setRealtimeOn(false); },
      onTranscript: (role, text) => p.setMessages((m) => [...m, { role, content: text }]),
      // B7.2: mostra no log que a voz acionou uma ferramenta (mesmo gate do chat de texto).
      onToolCall: (name) => p.setMessages((m) => [...m, { role: "assistant", content: `⚙ ${name}`, steps: [{ name, done: true }] }]),
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
    // não mistura com o tempo real: os dois disputariam o microfone (achado de auditoria pós-Onda 6)
    if (rtRef.current?.active) { rtRef.current.stop(); rtRef.current = null; setRealtimeOn(false); }

    // QUEM ESCUTA é escolha do dono (`voice.wakeEngine`). Os dois falham de
    // jeitos diferentes: a Web Speech transcreve a frase inteira e às vezes
    // come o nome (medido: "Oi Órbita, você tá aí?" virou "Oi você tá ai"), e
    // ainda manda o áudio para o Google; o Vosk usa gramática restrita à
    // frase, roda offline, mas precisa do apps/voice de pé.
    const cfgVoz = await fetch("/api/voice-config").then((r) => r.json()).catch(() => ({}) as Record<string, unknown>);
    const motor = (cfgVoz.motor as string) ?? "auto";
    const frases = Array.isArray(cfgVoz.frases) ? (cfgVoz.frases as string[]) : undefined;
    const voskDisponivel = Boolean(cfgVoz.up && cfgVoz.wsWakeUrl);
    const usarVosk = motor === "vosk" || (motor === "auto" && voskDisponivel);

    if (usarVosk) {
      if (!voskDisponivel) {
        p.setError("O serviço local de voz não está no ar. Suba o apps/voice ou mude quem escuta, em Preferências.");
        return;
      }
      try {
        const listener = new WakeListener(cfgVoz.wsWakeUrl as string, {
          onWake: () => {
            stopSpeaking();
            const C = getRecognitionCtor();
            if (p.modeRef.current === "standby") { if (C) startDictation(C); else void voiceCommand(); }
            else wakeRef.current?.resume?.();
          },
          onEnergy: (rms: number) => {
            if (ttsRef.current?.speaking && rms > 0.06) stopSpeaking();
          },
          onError: () => p.setError("Falha no wake word (serviço de voz)."),
        });
        await listener.start();
        wakeRef.current = listener;
        setWakeOn(true);
        setUltimoOuvido("");
        return;
      } catch {
        p.setError("Sem acesso ao microfone para o wake word.");
        return;
      }
    }

    // Web Speech: no aparelho, sem servidor e sem cold-start.
    const Ctor = getRecognitionCtor();
    if (Ctor) {
      try {
        // dispara o pedido de permissão do microfone uma vez, com antecedência
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
      } catch {
        p.setError("Sem acesso ao microfone para o wake word.");
        return;
      }
      const w = new LocalWake(Ctor, {
        onOuvido: setUltimoOuvido,
        frases,
        onWake: () => {
          stopSpeaking(); // barge-in ao ouvir "Ei Órbita"
          if (p.modeRef.current === "standby") startDictation(Ctor); // capta o comando (retoma o wake no fim)
          else w.resume(); // ocupada: só religa a escuta
        },
        onError: () => {
          /* erro transitório; o próprio LocalWake religa */
        },
      });
      w.start();
      wakeRef.current = w;
      setWakeOn(true);
      return;
    }

    // Fallback: serviço de voz remoto (Render) para navegadores sem Web Speech.
    try {
      const cfg = await fetch("/api/voice-config").then((r) => r.json());
      if (!cfg.up || !cfg.wsWakeUrl) {
        p.setError("Wake word “Ei Órbita” indisponível neste navegador. Use o botão do microfone.");
        return;
      }
      const listener = new WakeListener(cfg.wsWakeUrl, {
        onWake: () => {
          stopSpeaking();
          if (p.modeRef.current === "standby") void voiceCommand();
        },
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
    wakeRef.current?.pause?.(); // cede o mic: o wake não pode ouvir junto com o ditado
    const rec = new Ctor();
    rec.lang = "pt-BR";
    rec.interimResults = true;   // mostra o parcial na hora (feedback no textarea)
    rec.continuous = false;      // encerra sozinho após uma pausa na fala
    const base = p.input.trim(); // preserva o que já estava digitado
    let final = "";
    const compose = (interim: string) => ((base ? base + " " : "") + (final + interim)).trimStart();
    const clip = startVoiceClip(); // Onda 9: trecho de voz em paralelo, best-effort (ditado não depende dele)

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
      void clip.finish(); // libera o microfone do trecho mesmo sem enviar mensagem
      if (ev.error === "no-speech") p.setError("Não ouvi nada — toque e fale de novo.");
      else if (ev.error !== "aborted") p.setError("Reconhecimento de voz indisponível neste navegador.");
      wakeRef.current?.resume?.(); // volta a escutar "Ei Órbita"
    };
    rec.onend = () => {
      dictRef.current = null;
      setRecording(false);
      p.setMode("standby");
      const text = compose("").trim();
      p.setInput("");
      if (text) void clip.finish().then((voiceClip) => p.sendMessageRef.current?.(text, voiceClip)); // fala → texto → envia (com o trecho, se deu certo)
      else void clip.finish(); // nada a enviar, mas libera o microfone do trecho
      wakeRef.current?.resume?.(); // volta a escutar "Ei Órbita"
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
  /**
   * A fala que ACOMPANHA o texto chegando.
   *
   * Antes a voz só era chamada no fim do turno, com a resposta inteira: o
   * silêncio era o tempo de o modelo escrever tudo SOMADO ao de sintetizar o
   * começo. Agora o chat alimenta este fluxo a cada token e a Órbita começa a
   * falar assim que a primeira frase fecha.
   *
   * Só vale para o TTS do servidor. A voz do navegador (o degrau de reserva)
   * não aceita texto em pedaços sem picotar a prosódia, então ela continua
   * falando de uma vez, no fim.
   */
  function iniciarFalaEmFluxo(): FluxoDeFala | null {
    if (!voiceOn || ttsFalhasRef.current >= MAX_TTS_FALHAS) return null;
    if (!ttsRef.current) ttsRef.current = new LocalTTS();
    return ttsRef.current.iniciarFluxo({
      onStart: () => p.setMode("speaking"),
      onEnd: () => {
        p.setMode("standby");
        if (wakeRef.current?.active) void voiceCommand();
      },
    });
  }

  function handleAssistantResponse(text: string): boolean {
    if (!voiceOn) return false;
    void speak(text).then(() => {
      if (wakeRef.current?.active && p.modeRef.current === "standby") void voiceCommand();
    });
    return true;
  }

  useEffect(() => {
    /**
     * A disponibilidade do tempo real, com RETENTATIVA.
     *
     * Era uma busca só, e uma falha passageira escondia o botão para sempre:
     * a página carregada no instante em que o `apps/api` reiniciava perdia o
     * modo de voz sem nenhum aviso, e só recarregar trazia de volta. Um
     * recurso sumir em silêncio é pior do que ele falhar dizendo por quê.
     */
    let vivo = true;
    const tentar = async (restam: number, esperaMs: number): Promise<void> => {
      try {
        const d = await fetch("/api/realtime/config").then((r) => (r.ok ? r.json() : Promise.reject()));
        if (vivo) setRealtimeEnabled(!!d.enabled);
        return;
      } catch {
        if (!vivo || restam <= 0) return;
        await new Promise((r) => setTimeout(r, esperaMs));
        return tentar(restam - 1, esperaMs * 2);
      }
    };
    void tentar(3, 1500);

    // a aba volta do segundo plano: o servidor pode ter subido nesse meio-tempo
    const aoVoltar = () => { if (document.visibilityState === "visible") void tentar(1, 1000); };
    document.addEventListener("visibilitychange", aoVoltar);

    return () => {
      vivo = false;
      document.removeEventListener("visibilitychange", aoVoltar);
      wakeRef.current?.stop(); ttsRef.current?.stop(); rtRef.current?.stop(); dictRef.current?.abort();
    };
  }, []);

  return {
    voiceOn, setVoiceOn, recording, wakeOn, ultimoOuvido, realtimeEnabled, realtimeOn,
    audioFileRef, speak, stopSpeaking, seeScreen, sendAudioFile,
    voiceCommand, toggleRealtime, toggleWake, toggleMic, handleAssistantResponse, iniciarFalaEmFluxo,
  };
}
