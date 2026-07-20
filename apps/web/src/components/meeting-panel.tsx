"use client";

import { useRef, useState } from "react";
import { Card, PanelTitle, Button } from "@/components/ui";

/**
 * Transcrição de reunião ao vivo (caso-âncora do PRD: "Resume essa reunião").
 * Grava o microfone em janelas de ~8s (cada uma um WebM válido), transcreve
 * cada janela via /api/stt e acumula. Ao encerrar, resume via /api/meeting.
 */
export function MeetingPanel() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const runningRef = useRef(false);
  const transcriptRef = useRef("");

  async function recordWindow(stream: MediaStream, ms: number): Promise<Blob> {
    return new Promise((resolve) => {
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => resolve(new Blob(chunks, { type: "audio/webm" }));
      rec.start();
      setTimeout(() => { if (rec.state !== "inactive") rec.stop(); }, ms);
    });
  }

  async function start() {
    setSummary(""); setTranscript(""); transcriptRef.current = "";
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      runningRef.current = true;
      setActive(true);
      void loop(stream);
    } catch {
      setActive(false);
    }
  }

  async function loop(stream: MediaStream) {
    while (runningRef.current) {
      const blob = await recordWindow(stream, 8000);
      if (!runningRef.current && blob.size === 0) break;
      const fd = new FormData();
      fd.append("file", blob, "chunk.webm");
      try {
        const r = await fetch("/api/stt", { method: "POST", body: fd });
        const d = await r.json();
        if (d.text?.trim()) {
          transcriptRef.current = (transcriptRef.current + " " + d.text.trim()).trim();
          setTranscript(transcriptRef.current);
        }
      } catch {
        /* janela perdida; segue */
      }
    }
  }

  async function stop() {
    runningRef.current = false;
    setActive(false);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const text = transcriptRef.current.trim();
    if (!text) return;
    setBusy(true);
    try {
      const r = await fetch("/api/meeting/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: text }),
      });
      const d = await r.json();
      if (r.ok) setSummary(d.summary + (d.archived ? "\n\n📎 salvo na sua memória." : ""));
      else setSummary("⚠ " + (d.error ?? "falha ao resumir"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center">
        <PanelTitle>Reunião</PanelTitle>
        {active && <span className="ml-2 h-2 w-2 animate-pulse rounded-full" style={{ background: "var(--color-danger)" }} />}
        <span className="ml-auto text-xs" style={{ color: "var(--color-ink-dim)" }}>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {!active ? (
            <Button variant="primary" size="md" onClick={start} disabled={busy}>
              {busy ? "resumindo…" : "● iniciar transcrição"}
            </Button>
          ) : (
            <button onClick={stop} className="rounded-lg border px-3 py-1.5 text-xs" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
              ⏹ encerrar e resumir
            </button>
          )}

          {transcript && (
            <div className="max-h-24 overflow-y-auto rounded-lg border p-2 text-[11px]" style={{ borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}>
              {transcript}
            </div>
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
