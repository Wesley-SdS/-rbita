"use client";

import { useEffect, useState } from "react";

const KEY = "orbita.hiddenBlocks";

/** Preferência de blocos ocultos, persistida no navegador. */
export function useHiddenBlocks(): { hidden: string[]; toggle: (id: string) => void; isHidden: (id: string) => boolean } {
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    try { setHidden(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch { /* noop */ }
  }, []);
  const toggle = (id: string) =>
    setHidden((h) => {
      const next = h.includes(id) ? h.filter((x) => x !== id) : [...h, id];
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  return { hidden, toggle, isHidden: (id) => hidden.includes(id) };
}

/** Envolve um painel: some quando oculto; mostra um botão "ocultar" no hover. */
export function Block({ id, hidden, toggle, children }: { id: string; hidden: string[]; toggle: (id: string) => void; children: React.ReactNode }) {
  if (hidden.includes(id)) return null;
  return (
    <div className="group relative">
      <button
        onClick={() => toggle(id)}
        title="ocultar este bloco"
        className="absolute right-1.5 top-1.5 z-10 rounded px-1 text-[11px] opacity-0 transition-opacity group-hover:opacity-100"
        style={{ background: "var(--color-ground)", color: "var(--color-ink-dim)", border: "1px solid var(--color-line)" }}
      >
        ⊖
      </button>
      {children}
    </div>
  );
}

/** Menu para reexibir/ocultar qualquer bloco. */
export function BlocksManager({ blocks, hidden, toggle }: { blocks: { id: string; label: string }[]; hidden: string[]; toggle: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} title="gerenciar blocos" className="rounded-lg border px-2.5 py-1 text-xs"
        style={{ borderColor: "var(--color-line)", background: "var(--color-surface)", color: "var(--color-ink-dim)" }}>
        ⚙ Blocos
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-20 w-52 rounded-xl border p-2 shadow-lg" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
          <div className="mb-1 font-mono text-[9px] uppercase" style={{ color: "var(--color-ink-dim)" }}>Mostrar/ocultar blocos</div>
          {blocks.map((b) => (
            <label key={b.id} className="flex cursor-pointer items-center gap-2 py-0.5 text-[11px]" style={{ color: "var(--color-ink)" }}>
              <input type="checkbox" checked={!hidden.includes(b.id)} onChange={() => toggle(b.id)} />
              {b.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
