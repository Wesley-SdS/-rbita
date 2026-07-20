"use client";

import { useEffect, useRef, useState } from "react";
import { Card, PanelTitle, Input, Textarea, Button } from "@/components/ui";

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

  return (
    <Card>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center">
        <PanelTitle>Memória &amp; Docs</PanelTitle>
        <span className="ml-auto text-xs" style={{ color: "var(--color-ink-dim)" }}>{open ? "▾" : "▸"}</span>
      </button>
      <div className="mt-1 font-mono text-[10px]" style={{ color: "var(--color-gold)" }}>
        {counts.documents} docs · {counts.chunks} trechos · {counts.memories} memórias
      </div>

      {open && (
        <div className="mt-3 flex flex-col gap-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título do documento" />
          <Textarea size="sm" value={docText} onChange={(e) => setDocText(e.target.value)} placeholder="Cole um texto para a Órbita indexar (RAG)…" rows={3} />
          <Button variant="primary" size="md" onClick={ingest} disabled={busy}>Ingerir documento</Button>

          <input ref={fileRef} type="file" accept=".pdf,.txt,.md,image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
          <Button variant="outline" size="md" onClick={() => fileRef.current?.click()} disabled={busy}>📎 Enviar arquivo (PDF / imagem / txt)</Button>

          <div className="mt-1 flex gap-2">
            <Input value={fact} onChange={(e) => setFact(e.target.value)} onKeyDown={(e) => e.key === "Enter" && remember()} placeholder="Lembrar um fato sobre você…" className="flex-1" />
            <Button variant="outline" size="md" onClick={remember} disabled={busy}>Lembrar</Button>
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
    </Card>
  );
}
