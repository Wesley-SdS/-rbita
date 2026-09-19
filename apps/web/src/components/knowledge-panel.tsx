"use client";

import { useEffect, useRef, useState } from "react";
import { Card, PanelTitle, Input, Textarea, Button } from "@/components/ui";
import { enfileirar, isJobTerminal, type JobView } from "@/lib/jobs";
import { JobProgress } from "@/components/job-progress";
import { KnowledgeSearch } from "@/components/knowledge-search";

interface Counts { documents: number; chunks: number; memories: number }
interface Acervo { documentos: number; trechos: number; memorias: number; semPagina: number }
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
  const [ingestJob, setIngestJob] = useState<JobView | null>(null);
  const [uploadJob, setUploadJob] = useState<JobView | null>(null);
  const [reindexJob, setReindexJob] = useState<JobView | null>(null);
  const [acervo, setAcervo] = useState<Acervo | null>(null);

  const refresh = () => {
    fetch("/api/knowledge").then((r) => r.json()).then(setCounts).catch(() => {});
    fetch("/api/memory").then((r) => r.json()).then((d) => setMems(d.memories ?? [])).catch(() => {});
    fetch("/api/account/reindex").then((r) => r.json()).then(setAcervo).catch(() => {});
  };
  useEffect(refresh, []);

  // indexar (embeddings de N trechos) virou trabalho de fila: enfileira e o
  // JobProgress cuida do acompanhamento até "feito"
  async function ingest() {
    if (!title.trim() || !docText.trim() || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/ingest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, content: docText }) });
      setIngestJob(await enfileirar(r));
      setTitle(""); setDocText("");
    } catch (e) {
      setMsg("✗ " + (e instanceof Error ? e.message : "erro"));
      setBusy(false);
    }
  }

  function onIngestChange(j: JobView) {
    setIngestJob(j);
    if (!isJobTerminal(j.status)) return;
    setBusy(false);
    if (j.status === "feito") {
      const d = j.resultado as { chunks: number } | null;
      setMsg(`✓ ${d?.chunks ?? 0} trecho(s) indexado(s)`);
      refresh();
    } else if (j.status === "falhou") {
      setMsg("✗ " + (j.erro?.mensagem ?? "erro"));
    } else {
      setMsg("Indexação cancelada.");
    }
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

  // reindexar: refaz os cortes e os vetores do acervo inteiro. É o caminho
  // depois de trocar o modelo de embedding, e é o que dá PÁGINA aos documentos
  // antigos, indexados quando o corte ainda não guardava de onde o trecho veio.
  async function reindexar() {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/account/reindex", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modo: "recortar" }) });
      setReindexJob(await enfileirar(r));
    } catch (e) {
      setMsg("✗ " + (e instanceof Error ? e.message : "erro"));
      setBusy(false);
    }
  }

  function onReindexChange(j: JobView) {
    setReindexJob(j);
    if (!isJobTerminal(j.status)) return;
    setBusy(false);
    if (j.status === "feito") {
      const d = j.resultado as { trechos: number; memorias: number; recortados: number } | null;
      setMsg(`✓ ${d?.trechos ?? 0} trecho(s) e ${d?.memorias ?? 0} memória(s) reindexados`);
      refresh();
    } else if (j.status === "falhou") {
      setMsg("✗ " + (j.erro?.mensagem ?? "erro"));
    } else {
      setMsg("Reindexação cancelada.");
    }
  }

  const fileRef = useRef<HTMLInputElement>(null);
  // PDF grande e OCR levam dezenas de segundos: também virou trabalho de fila
  async function upload(f: File) {
    setBusy(true); setMsg(`⏳ enviando ${f.name}…`);
    const fd = new FormData();
    fd.append("file", f);
    try {
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      setUploadJob(await enfileirar(r));
    } catch (e) {
      setMsg("✗ " + (e instanceof Error ? e.message : "erro"));
      setBusy(false);
    }
  }

  function onUploadChange(j: JobView) {
    setUploadJob(j);
    if (!isJobTerminal(j.status)) return;
    setBusy(false);
    if (j.status === "feito") {
      const d = j.resultado as { title: string; chunks: number; duplicado?: boolean; leitura?: { ocr: number; visao: number; nativas: number } } | null;
      if (d?.duplicado) {
        // mesmo arquivo (mesmo SHA-256) já indexado: não vira documento repetido
        setMsg(`✓ ${d.title} já estava indexado, não dupliquei`);
      } else if (d) {
        const lido = d.leitura && d.leitura.ocr + d.leitura.visao > 0 ? ` (${d.leitura.ocr} página(s) por OCR, ${d.leitura.visao} pelo modelo de visão)` : "";
        setMsg(`✓ ${d.title}: ${d.chunks} trecho(s)${lido}`);
      } else {
        setMsg("✓ arquivo processado");
      }
      refresh();
    } else if (j.status === "falhou") {
      setMsg("✗ " + (j.erro?.mensagem ?? "erro"));
    } else {
      setMsg("Processamento cancelado.");
    }
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
          <KnowledgeSearch />

          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título do documento" />
          <Textarea size="sm" value={docText} onChange={(e) => setDocText(e.target.value)} placeholder="Cole um texto para a Órbita indexar (RAG)…" rows={3} />
          <Button variant="primary" size="md" onClick={ingest} disabled={busy}>Ingerir documento</Button>
          {ingestJob && <JobProgress job={ingestJob} onChange={onIngestChange} compact />}

          <input ref={fileRef} type="file" accept=".pdf,.txt,.md,image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
          <Button variant="outline" size="md" onClick={() => fileRef.current?.click()} disabled={busy}>📎 Enviar arquivo (PDF / imagem / txt)</Button>
          {uploadJob && <JobProgress job={uploadJob} onChange={onUploadChange} compact />}

          <div className="mt-1 flex gap-2">
            <Input value={fact} onChange={(e) => setFact(e.target.value)} onKeyDown={(e) => e.key === "Enter" && remember()} placeholder="Lembrar um fato sobre você…" className="flex-1" />
            <Button variant="outline" size="md" onClick={remember} disabled={busy}>Lembrar</Button>
          </div>

          <div className="mt-1 flex items-center gap-2">
            <Button variant="outline" size="md" onClick={reindexar} disabled={busy}>Reindexar acervo</Button>
            {acervo && acervo.semPagina > 0 && (
              <span className="text-[10px]" style={{ color: "var(--color-ink-dim)" }}>
                {acervo.semPagina} trecho(s) ainda sem página
              </span>
            )}
          </div>
          {reindexJob && <JobProgress job={reindexJob} onChange={onReindexChange} compact />}

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
