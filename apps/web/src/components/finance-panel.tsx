"use client";

import { useEffect, useRef, useState } from "react";

interface Entry { id: string; description: string; category: string | null; amount: number; kind: string; dueDate: string | null; paid: boolean }
interface Totals { gastos: number; aPagar: number; aReceber: number; saldoProjetado: number }

const brl = (n: number) => "R$" + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function FinancePanel() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function load() {
    fetch("/api/finance").then((r) => r.json()).then((d) => { setEntries(d.entries ?? []); setTotals(d.totals ?? null); }).catch(() => {});
  }
  useEffect(load, []);

  async function uploadReceipt(file: File) {
    setBusy(true); setFlash("lendo comprovante…");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/finance/receipt", { method: "POST", body: fd });
      const d = await r.json();
      if (r.ok) { setFlash(`✓ ${d.lancamento.descricao} — ${brl(d.lancamento.valor)} (${d.lancamento.tipo})`); load(); }
      else setFlash("⚠ " + (d.error ?? "falha"));
    } finally {
      setBusy(false);
      setTimeout(() => setFlash(null), 6000);
    }
  }

  async function togglePaid(e: Entry) {
    await fetch("/api/finance", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: e.id, paid: !e.paid }) });
    load();
  }
  async function remove(id: string) {
    await fetch(`/api/finance?id=${id}`, { method: "DELETE" });
    load();
  }

  const aPagar = entries.filter((e) => e.kind === "payable");
  const aReceber = entries.filter((e) => e.kind === "receivable");

  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center">
        <h3 className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-dim)" }}>Finanças</h3>
        <span className="ml-auto text-xs" style={{ color: "var(--color-ink-dim)" }}>{open ? "▾" : "▸"}</span>
      </button>

      {totals && (
        <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
          <Mini label="Gastos" value={brl(totals.gastos)} />
          <Mini label="A pagar" value={brl(totals.aPagar)} warn />
          <Mini label="A receber" value={brl(totals.aReceber)} good />
          <Mini label="Saldo proj." value={brl(totals.saldoProjetado)} good={totals.saldoProjetado >= 0} warn={totals.saldoProjetado < 0} />
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadReceipt(f); e.target.value = ""; }} />
      <button onClick={() => fileRef.current?.click()} disabled={busy} className="mt-2 w-full rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50"
        style={{ borderColor: "color-mix(in oklab, var(--color-gold) 40%, var(--color-line))", color: "var(--color-gold)" }}>
        📷 enviar comprovante/cupom (OCR)
      </button>
      {flash && <div className="mt-1 text-[10px]" style={{ color: "var(--color-ink-dim)" }}>{flash}</div>}

      {open && (
        <div className="mt-3 flex flex-col gap-2">
          {aPagar.length > 0 && <Section title="A pagar" entries={aPagar} onToggle={togglePaid} onRemove={remove} />}
          {aReceber.length > 0 && <Section title="A receber" entries={aReceber} onToggle={togglePaid} onRemove={remove} />}
          {aPagar.length === 0 && aReceber.length === 0 && <span className="text-[10px]" style={{ color: "var(--color-ink-dim)" }}>sem contas em aberto</span>}
        </div>
      )}
    </div>
  );
}

function Mini({ label, value, good, warn }: { label: string; value: string; good?: boolean; warn?: boolean }) {
  return (
    <div className="rounded-lg border p-1.5" style={{ borderColor: "var(--color-line)" }}>
      <div className="font-mono text-[8px] uppercase" style={{ color: "var(--color-ink-dim)" }}>{label}</div>
      <div className="font-bold" style={{ color: good ? "var(--color-gold)" : warn ? "#e0705a" : "var(--color-ink)" }}>{value}</div>
    </div>
  );
}

function Section({ title, entries, onToggle, onRemove }: { title: string; entries: Entry[]; onToggle: (e: Entry) => void; onRemove: (id: string) => void }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase" style={{ color: "var(--color-ink-dim)" }}>{title}</div>
      {entries.map((e) => (
        <div key={e.id} className="flex items-center gap-1.5 py-0.5 text-[11px]" style={{ opacity: e.paid ? 0.5 : 1 }}>
          <button onClick={() => onToggle(e)} title={e.paid ? "reabrir" : "marcar quitada"}>{e.paid ? "☑" : "☐"}</button>
          <span className="flex-1 truncate" style={{ color: "var(--color-ink)", textDecoration: e.paid ? "line-through" : "none" }}>{e.description}</span>
          {e.dueDate && <span style={{ color: "var(--color-ink-dim)" }}>{e.dueDate.slice(5, 10)}</span>}
          <span className="font-semibold" style={{ color: "var(--color-ink)" }}>R${e.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
          <button onClick={() => onRemove(e.id)} style={{ color: "#e0705a" }}>×</button>
        </div>
      ))}
    </div>
  );
}
