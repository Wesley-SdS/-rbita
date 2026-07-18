"use client";

import { useEffect, useState } from "react";

interface Connector {
  id: string;
  label: string;
  icon: string;
  blurb: string;
  configured: boolean;
  connected: boolean;
  accountLabel: string | null;
}

export function ConnectorsPanel() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  function load() {
    fetch("/api/connectors")
      .then((r) => r.json())
      .then((d) => setConnectors(d.connectors ?? []))
      .catch(() => {});
  }

  useEffect(() => {
    load();
    // feedback do callback OAuth (?connector=google&status=conectado)
    const p = new URLSearchParams(window.location.search);
    const c = p.get("connector");
    const s = p.get("status");
    if (c && s) {
      setFlash(s === "conectado" ? `${c} conectado ✓` : `${c}: ${s.replace(/_/g, " ")}`);
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => setFlash(null), 5000);
    }
  }, []);

  async function disconnect(id: string) {
    await fetch(`/api/connectors/${id}`, { method: "DELETE" });
    load();
  }

  const connectedCount = connectors.filter((c) => c.connected).length;

  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center">
        <h3 className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-dim)" }}>Conectores</h3>
        {connectedCount > 0 && (
          <span className="ml-2 rounded-full px-1.5 text-[10px] font-bold" style={{ background: "var(--color-gold)", color: "#241403" }}>{connectedCount}</span>
        )}
        <span className="ml-auto text-xs" style={{ color: "var(--color-ink-dim)" }}>{open ? "▾" : "▸"}</span>
      </button>

      {flash && (
        <div className="mt-2 rounded-lg border px-2 py-1 text-[11px]" style={{ borderColor: "color-mix(in oklab, var(--color-gold) 40%, var(--color-line))", color: "var(--color-gold)" }}>
          {flash}
        </div>
      )}

      <div className="mt-2 flex flex-col gap-2">
        {connectors.map((c) => (
          <div key={c.id} className="rounded-lg border p-2" style={{ borderColor: "var(--color-line)" }}>
            <div className="flex items-center gap-2">
              <span>{c.icon}</span>
              <span className="text-xs font-semibold" style={{ color: "var(--color-ink)" }}>{c.label}</span>
              {c.connected && <span className="ml-auto text-[10px]" style={{ color: "var(--color-gold)" }}>● conectado</span>}
            </div>
            {open && <p className="mt-1 text-[10px]" style={{ color: "var(--color-ink-dim)" }}>{c.blurb}</p>}
            {c.connected && c.accountLabel && (
              <p className="mt-0.5 text-[10px]" style={{ color: "var(--color-ink-dim)" }}>{c.accountLabel}</p>
            )}
            <div className="mt-2">
              {!c.configured ? (
                <span className="text-[10px]" style={{ color: "var(--color-ink-dim)" }}>
                  ⚙ falta configurar as credenciais no servidor
                </span>
              ) : c.connected ? (
                <button onClick={() => disconnect(c.id)} className="text-[11px]" style={{ color: "#e0705a" }}>desconectar</button>
              ) : (
                <a href={`/api/connectors/${c.id}/connect`} className="inline-block rounded-lg px-3 py-1 text-[11px] font-semibold"
                  style={{ background: "linear-gradient(120deg, var(--color-amber), var(--color-gold))", color: "#241403" }}>
                  conectar
                </a>
              )}
            </div>
          </div>
        ))}
        {connectors.length === 0 && <span className="text-[10px]" style={{ color: "var(--color-ink-dim)" }}>carregando…</span>}
      </div>
    </div>
  );
}
