"use client";

import { useEffect, useRef, useState } from "react";
import { Card, PanelTitle, Button } from "@/components/ui";
import { ContinuousRecorder, startMeetingCapture, type MeetingCapture } from "@/lib/voice/capture";
import { ContinuousDictation, getRecognitionCtor } from "@/lib/voice/speech";
import type { SttUtterance } from "@orbita/core/stt/types";

/**
 * Transcrição de reunião (caso-âncora do PRD: "Resume essa reunião").
 *
 * Desenho em duas trilhas, e a distinção importa:
 *
 *  • VERDADE   gravação CONTÍNUA do início ao fim → ao encerrar, sobe inteira
 *              para o /api/stt com `diarize` → transcrição com quem falou o quê.
 *  • PRÉVIA    Web Speech no aparelho, só para você ver que está funcionando.
 *              Instantânea, de graça, e sem separar vozes.
 *
 * O fluxo antigo gravava janelas de 8s e transcrevia uma a uma: perdia o áudio
 * entre as janelas e nunca conseguiria separar vozes (os rótulos A/B/C são
 * atribuídos por requisição, então o "A" de uma janela não é o "A" da seguinte).
 */
export function MeetingPanel() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(false);
  const [systemAudio, setSystemAudio] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [preview, setPreview] = useState("");
  const [utterances, setUtterances] = useState<SttUtterance[]>([]);
  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "transcrevendo" | "resumindo">("idle");

  const captureRef = useRef<MeetingCapture | null>(null);
  const recorderRef = useRef<ContinuousRecorder | null>(null);
  const dictationRef = useRef<ContinuousDictation | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // libera microfone/captura se o componente sair com a reunião rodando
  useEffect(() => {
    return () => {
      dictationRef.current?.stop();
      captureRef.current?.stop();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function start() {
    setSummary(""); setTranscript(""); setPreview(""); setUtterances([]); setNote(null);

    let capture: MeetingCapture;
    try {
      capture = await startMeetingCapture({ systemAudio });
    } catch {
      setNote("Sem acesso ao microfone.");
      return;
    }
    captureRef.current = capture;

    if (systemAudio && !capture.hasSystemAudio) {
      // falha silenciosa aqui significaria gravar meia reunião sem ninguém notar
      setNote("Só o microfone foi capturado. Para pegar Teams/Meet, marque “compartilhar áudio” no diálogo do Chrome.");
    }

    const recorder = new ContinuousRecorder();
    recorder.start(capture.stream);
    recorderRef.current = recorder;

    // prévia ao vivo (best-effort — navegador sem Web Speech simplesmente não mostra)
    const Ctor = getRecognitionCtor();
    if (Ctor) {
      const d = new ContinuousDictation(Ctor, { onText: setPreview });
      d.start();
      dictationRef.current = d;
    }

    setActive(true);
    setElapsed(0);
    clearTimer();
    timerRef.current = setInterval(() => setElapsed(Math.floor((recorder.elapsedMs ?? 0) / 1000)), 1000);
  }

  async function stop() {
    setActive(false);
    clearTimer();
    dictationRef.current?.stop();
    dictationRef.current = null;

    const blob = await recorderRef.current?.stop();
    recorderRef.current = null;
    captureRef.current?.stop();
    captureRef.current = null;

    if (!blob || blob.size === 0) {
      setNote("Nada foi gravado.");
      return;
    }

    // 1) transcrição da reunião INTEIRA, com separação de vozes
    setPhase("transcrevendo");
    let texto = "";
    try {
      const fd = new FormData();
      fd.append("file", blob, "reuniao.webm");
      fd.append("diarize", "true");
      const r = await fetch("/api/stt", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "falha na transcrição");

      if (d.utterances?.length) {
        setUtterances(d.utterances);
        texto = (d.utterances as SttUtterance[]).map((u) => `Locutor ${u.speaker}: ${u.text}`).join("\n");
      } else {
        texto = (d.text ?? "").trim();
        if (d.diarizationUnavailable) {
          setNote(
            d.provider === "whisper-local"
              ? "Transcrito no Whisper local, que não separa vozes. Configure ASSEMBLYAI_API_KEY para ter os locutores."
              : "Só uma voz foi identificada no áudio.",
          );
        }
      }
      setTranscript(texto);
    } catch (e) {
      setPhase("idle");
      setNote(e instanceof Error ? e.message : "Falha ao transcrever.");
      return;
    }

    if (!texto.trim()) {
      setPhase("idle");
      setNote("A transcrição voltou vazia.");
      return;
    }

    // 2) resumo + arquivamento no RAG
    setPhase("resumindo");
    try {
      const r = await fetch("/api/meeting/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: texto }),
      });
      const d = await r.json();
      setSummary(r.ok ? d.summary + (d.archived ? "\n\n📎 salvo na sua memória." : "") : "⚠ " + (d.error ?? "falha ao resumir"));
    } catch {
      setSummary("⚠ falha ao resumir");
    } finally {
      setPhase("idle");
    }
  }

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const busy = phase !== "idle";
  const dim = { color: "var(--color-ink-dim)" };
  const boxed = { borderColor: "var(--color-line)", color: "var(--color-ink-dim)" };

  return (
    <Card>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center">
        <PanelTitle>Reunião</PanelTitle>
        {active && <span className="ml-2 h-2 w-2 animate-pulse rounded-full" style={{ background: "var(--color-danger)" }} />}
        <span className="ml-auto text-xs" style={dim}>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {!active && !busy && (
            <label className="flex items-center gap-2 text-[11px]" style={dim}>
              <input type="checkbox" checked={systemAudio} onChange={(e) => setSystemAudio(e.target.checked)} />
              capturar áudio da tela (Teams, Meet, Slack)
            </label>
          )}

          {!active ? (
            <Button variant="primary" size="md" onClick={start} disabled={busy}>
              {phase === "transcrevendo" ? "transcrevendo e separando vozes…" : phase === "resumindo" ? "resumindo…" : "● iniciar transcrição"}
            </Button>
          ) : (
            <button onClick={stop} className="rounded-lg border px-3 py-1.5 text-xs" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
              ⏹ encerrar e resumir · {mmss}
            </button>
          )}

          {note && (
            <div className="rounded-lg border p-2 text-[11px]" style={{ borderColor: "color-mix(in oklab, var(--color-danger) 40%, var(--color-line))", color: "var(--color-ink-dim)" }}>
              {note}
            </div>
          )}

          {active && (
            <div className="max-h-24 overflow-y-auto rounded-lg border p-2 text-[11px]" style={boxed}>
              <div className="mb-1 text-[10px] uppercase tracking-wide" style={dim}>prévia (só o seu microfone)</div>
              {preview || "ouvindo…"}
            </div>
          )}

          {utterances.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-lg border p-2 text-[11px]" style={boxed}>
              <div className="mb-1 text-[10px] uppercase tracking-wide" style={dim}>
                {new Set(utterances.map((u) => u.speaker)).size} locutores
              </div>
              {utterances.map((u, i) => (
                <p key={i} className="mb-1">
                  <span className="font-semibold" style={{ color: "var(--color-gold)" }}>Locutor {u.speaker}:</span> {u.text}
                </p>
              ))}
            </div>
          )}

          {!utterances.length && transcript && (
            <div className="max-h-24 overflow-y-auto rounded-lg border p-2 text-[11px]" style={boxed}>{transcript}</div>
          )}

          {summary && (
            <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border p-2 text-[11px]"
              style={{ borderColor: "color-mix(in oklab, var(--color-gold) 40%, var(--color-line))", color: "var(--color-ink)" }}>
              {summary}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
