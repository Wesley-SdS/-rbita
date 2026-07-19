"use client";

import { useEffect, useRef, useState } from "react";

interface Counts { documents: number; chunks: number; memories: number }
interface Mem { id: string; content: string }

export function KnowledgePanel() {
  const [counts, setCounts] = useState<Counts>({ documents: 0, chunks: 0, memories: 0 });
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [docText, setDocText] = useState("");
  const [fact, setFact] = useState("");
  const [busy, setBusy] = useState(false);
  const [mems, setMems] = useState<Mem[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = () => {
    fetch("/api/knowledge").then((r) => r.json()).then(setCounts).catch(() => {});
    fetch("/api/memory").then((r) => r.json()).then((d) => setMems(d.memories ?? [])).catch(() => {});
  };
  useEffect(refresh, []);

  async function ingest() {
    if (!title.trim() || !docText.trim() || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/ingest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, content: docText }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "falha");
      setMsg(`✓ ${d.chunks} trecho(s) indexado(s)`); setTitle(""); setDocText(""); refresh();
    } catch (e) { setMsg("✗ " + (e instanceof Error ? e.message : "erro")); } finally { setBusy(false); }
  }

  async function remember() {
    if (!fact.trim() || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: fact }) });
      if (!r.ok) throw new Error("falha");
      setMsg("✓ memória salva"); setFact(""); refresh();
    } catch { setMsg("✗ erro"); } finally { setBusy(false); }
  }

  async function forget(id: string) {
    await fetch(`/api/memory?id=${id}`, { method: "DELETE" });
    refresh();
  }

  const fileRef = useRef<HTMLInputElement>(null);
  async function upload(f: File) {
    setBusy(true); setMsg(`⏳ processando ${f.name}…`);
    const fd = new FormData();
    fd.append("file", f);
    try {
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "falha");
      setMsg(`✓ ${d.title}: ${d.chunks} trecho(s)`); refresh();
    } catch (e) {
      setMsg("✗ " + (e instanceof Error ? e.message : "erro"));
    } finally { setBusy(false); }
  }

  const input = { borderColor: "var(--color-line)", background: "var(--color-ground)", color: "var(--color-ink)" };

  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center">
        <h3 className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-dim)" }}>Memória &amp; Docs</h3>
        <span className="ml-auto text-xs" style={{ color: "var(--color-ink-dim)" }}>{open ? "▾" : "▸"}</span>
      </button>
      <div className="mt-1 font-mono text-[10px]" style={{ color: "var(--color-gold)" }}>
        {counts.documents} docs · {counts.chunks} trechos · {counts.memories} memórias
      </div>

      {open && (
        <div className="mt-3 flex flex-col gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título do documento" className="rounded-lg border px-2 py-1.5 text-xs outline-none" style={input} />
          <textarea value={docText} onChange={(e) => setDocText(e.target.value)} placeholder="Cole um texto para a Órbita indexar (RAG)…" rows={3} className="rounded-lg border px-2 py-1.5 text-xs outline-none" style={input} />
          <button onClick={ingest} disabled={busy} className="rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50" style={{ background: "linear-gradient(120deg, var(--color-amber), var(--color-gold))", color: "#241403" }}>Ingerir documento</button>

          <input ref={fileRef} type="file" accept=".pdf,.txt,.md,image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
          <button onClick={() => fileRef.current?.click()} disabled={busy} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50"
            style={{ borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}>📎 Enviar arquivo (PDF / imagem / txt)</button>

          <div className="mt-1 flex gap-2">
            <input value={fact} onChange={(e) => setFact(e.target.value)} onKeyDown={(e) => e.key === "Enter" && remember()} placeholder="Lembrar um fato sobre você…" className="flex-1 rounded-lg border px-2 py-1.5 text-xs outline-none" style={input} />
            <button onClick={remember} disabled={busy} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50" style={{ borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}>Lembrar</button>
          </div>

          {msg && <div className="text-[10px]" style={{ color: msg.startsWith("✓") ? "#8ac98f" : "var(--color-danger)" }}>{msg}</div>}

          {mems.length > 0 && (
            <div className="mt-1 flex flex-col gap-1">
              {mems.map((m) => (
                <div key={m.id} className="flex items-start gap-1 text-[11px]" style={{ color: "var(--color-ink-dim)" }}>
                  <span className="flex-1">• {m.content}</span>
                  <button onClick={() => forget(m.id)} title="esquecer" style={{ color: "var(--color-danger)" }}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
