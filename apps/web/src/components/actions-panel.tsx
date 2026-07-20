"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui";

interface Action { id: string; kind: string; summary: string; createdAt: string }

/**
 * Ações a confirmar: propostas de ações com efeito (enviar e-mail, criar evento…)
 * criadas pela Órbita. Só são executadas quando o USUÁRIO aprova aqui — o LLM
 * nunca dispara sozinho (gate contra prompt-injection).
 */
export function ActionsPanel() {
  const [actions, setActions] = useState<Action[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    fetch("/api/actions").then((r) => r.json()).then((d) => setActions(d.actions ?? [])).catch(() => {});
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 15000); // reflete propostas criadas no chat
    return () => clearInterval(t);
  }, []);

  async function approve(id: string) {
    setBusy(id);
    try { await fetch("/api/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); load(); }
    finally { setBusy(null); }
  }
  async function reject(id: string) {
    await fetch(`/api/actions?id=${id}`, { method: "DELETE" });
    load();
  }

  if (actions.length === 0) return null; // só aparece quando há algo a confirmar

  return (
    <Card style={{ borderColor: "color-mix(in oklab, var(--color-gold) 50%, var(--color-line))" }}>
      <h3 className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-gold)" }}>Ações a confirmar</h3>
      <div className="mt-2 flex flex-col gap-2">
        {actions.map((a) => (
          <div key={a.id} className="rounded-lg border p-2" style={{ borderColor: "var(--color-line)" }}>
            <div className="text-[11px]" style={{ color: "var(--color-ink)" }}>{a.summary}</div>
            <div className="mt-1.5 flex gap-2">
              <button onClick={() => approve(a.id)} disabled={busy === a.id} className="rounded px-2 py-0.5 text-[11px] font-semibold disabled:opacity-50"
                style={{ background: "linear-gradient(120deg, var(--color-amber), var(--color-gold))", color: "#241403" }}>
                {busy === a.id ? "…" : "✓ confirmar"}
              </button>
              <button onClick={() => reject(a.id)} className="rounded border px-2 py-0.5 text-[11px]" style={{ borderColor: "var(--color-line)", color: "var(--color-danger)" }}>
                ✕ cancelar
              </button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
