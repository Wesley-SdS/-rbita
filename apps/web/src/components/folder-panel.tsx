"use client";

import { useState } from "react";

/* Tipos mínimos da File System Access API (não incluída no lib.dom padrão). */
interface FSFileHandle { kind: "file"; name: string; getFile(): Promise<File> }
interface FSDirHandle { kind: "directory"; name: string; values(): AsyncIterable<FSFileHandle | FSDirHandle> }
type PickDir = () => Promise<FSDirHandle>;

const TEXT_EXT = /\.(txt|md|markdown|csv|json|js|jsx|ts|tsx|py|java|go|rs|c|cpp|h|css|html|yml|yaml|sql|sh|env|log)$/i;
const MAX_FILES = 40;
const MAX_BYTES = 200_000;

/**
 * Dá à Órbita acesso a uma pasta do usuário (o usuário escolhe explicitamente).
 * Lê os arquivos de texto/código e os indexa no RAG — depois a Órbita responde
 * sobre eles no chat. Nenhum arquivo sai da máquina além do backend do próprio app.
 */
export function FolderPanel() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = typeof window !== "undefined" && "showDirectoryPicker" in window;

  async function collect(dir: FSDirHandle, prefix: string, out: { name: string; file: File }[], depth: number) {
    if (out.length >= MAX_FILES || depth > 3) return;
    for await (const entry of dir.values()) {
      if (out.length >= MAX_FILES) break;
      if (entry.kind === "file" && TEXT_EXT.test(entry.name)) {
        const file = await entry.getFile();
        if (file.size <= MAX_BYTES) out.push({ name: prefix + entry.name, file });
      } else if (entry.kind === "directory" && !["node_modules", ".git", ".next", "dist"].includes(entry.name)) {
        await collect(entry, prefix + entry.name + "/", out, depth + 1);
      }
    }
  }

  async function connect() {
    if (busy) return;
    setBusy(true);
    setStatus("escolhendo pasta…");
    try {
      const pick = (window as unknown as { showDirectoryPicker: PickDir }).showDirectoryPicker;
      const dir = await pick();
      const files: { name: string; file: File }[] = [];
      setStatus("lendo arquivos…");
      await collect(dir, "", files, 0);
      let indexed = 0;
      for (const { name, file } of files) {
        const content = await file.text();
        if (!content.trim()) continue;
        const r = await fetch("/api/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: `${dir.name}/${name}`, content: content.slice(0, 100_000) }),
        });
        if (r.ok) indexed++;
        setStatus(`indexando… ${indexed}/${files.length}`);
      }
      setStatus(`✓ ${indexed} arquivo(s) de "${dir.name}" indexados. Pergunte sobre eles no chat.`);
    } catch (e) {
      setStatus(e instanceof Error && e.name === "AbortError" ? null : "não foi possível ler a pasta");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center">
        <h3 className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-dim)" }}>Arquivos</h3>
        <span className="ml-auto text-xs" style={{ color: "var(--color-ink-dim)" }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {supported ? (
            <button onClick={connect} disabled={busy} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50"
              style={{ borderColor: "color-mix(in oklab, var(--color-gold) 40%, var(--color-line))", color: "var(--color-gold)" }}>
              📁 dar acesso a uma pasta
            </button>
          ) : (
            <span className="text-[10px]" style={{ color: "var(--color-ink-dim)" }}>navegador não suporta acesso a pastas (use Chrome/Edge)</span>
          )}
          {status && <div className="text-[10px]" style={{ color: "var(--color-ink-dim)" }}>{status}</div>}
        </div>
      )}
    </div>
  );
}
