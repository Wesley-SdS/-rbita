"use client";

import { useEffect, useState } from "react";

/** Linha rótulo→valor usada nos painéis de sessão/economia. */
export function Stat({ label, value, accent, good }: { label: string; value: string; accent?: boolean; good?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-1 text-[13px]" style={{ color: "var(--color-ink-dim)" }}>
      <span>{label}</span>
      <b className="font-mono" style={{ color: good ? "#8ac98f" : accent ? "var(--color-gold)" : "var(--color-ink)" }}>{value}</b>
    </div>
  );
}

/** Liga/desliga notificações push do navegador (proatividade). */
export function PushToggle() {
  const [status, setStatus] = useState<"unsupported" | "denied" | "off" | "on" | "loading">("loading");
  const [busy, setBusy] = useState(false);
  useEffect(() => { import("@/lib/push/client").then((m) => m.pushStatus()).then(setStatus).catch(() => setStatus("unsupported")); }, []);
  async function toggle() {
    setBusy(true);
    try {
      const m = await import("@/lib/push/client");
      if (status === "on") { await m.disablePush(); setStatus("off"); }
      else { const r = await m.enablePush(); setStatus(r.ok ? "on" : "off"); }
    } finally { setBusy(false); }
  }
  async function test() { await fetch("/api/push/test", { method: "POST" }); }
  if (status === "unsupported") return null;
  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
      <h3 className="mb-2 font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-dim)" }}>Notificações push</h3>
      {status === "denied" ? (
        <p className="text-[12px]" style={{ color: "var(--color-ink-dim)" }}>Permissão bloqueada no navegador. Libere nas configurações do site para receber avisos.</p>
      ) : (
        <div className="flex items-center gap-2">
          <button onClick={toggle} disabled={busy || status === "loading"}
            className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
            style={{ borderColor: status === "on" ? "var(--color-gold)" : "var(--color-line)", color: status === "on" ? "var(--color-gold)" : "var(--color-ink-dim)" }}>
            {busy ? "…" : status === "on" ? "🔔 Ativas" : "🔕 Ativar"}
          </button>
          {status === "on" && (
            <button onClick={test} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}>
              Testar
            </button>
          )}
        </div>
      )}
    </div>
  );
}

type ProfileT = { assistantName: string; userName: string | null; persona: string | null };

/** Persona configurável: nome da assistente, como te chamar e tom/estilo. */
export function PersonaPanel() {
  const [p, setP] = useState<ProfileT | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    fetch("/api/profile").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d?.profile) setP({ assistantName: d.profile.assistantName ?? "Órbita", userName: d.profile.userName ?? "", persona: d.profile.persona ?? "" });
    }).catch(() => {});
  }, []);
  async function save() {
    if (!p) return;
    setSaving(true); setSaved(false);
    try {
      const r = await fetch("/api/profile", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assistantName: p.assistantName || "Órbita", userName: p.userName || null, persona: p.persona || null }),
      });
      if (r.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
    } finally { setSaving(false); }
  }
  const field = { borderColor: "var(--color-line)", background: "var(--color-ground)", color: "var(--color-ink)" };
  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
      <h3 className="mb-3 font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-dim)" }}>Persona</h3>
      {!p ? (
        <div className="py-2 text-[13px]" style={{ color: "var(--color-ink-dim)" }}>—</div>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="text-[11px]" style={{ color: "var(--color-ink-dim)" }}>Nome da assistente</label>
          <input value={p.assistantName} onChange={(e) => setP({ ...p, assistantName: e.target.value })} maxLength={40}
            className="rounded-lg border px-3 py-2 text-sm outline-none" style={field} placeholder="Órbita" />
          <label className="text-[11px]" style={{ color: "var(--color-ink-dim)" }}>Como te chamar</label>
          <input value={p.userName ?? ""} onChange={(e) => setP({ ...p, userName: e.target.value })} maxLength={40}
            className="rounded-lg border px-3 py-2 text-sm outline-none" style={field} placeholder="opcional" />
          <label className="text-[11px]" style={{ color: "var(--color-ink-dim)" }}>Tom & preferências</label>
          <textarea value={p.persona ?? ""} onChange={(e) => setP({ ...p, persona: e.target.value })} maxLength={2000} rows={3}
            className="resize-y rounded-lg border px-3 py-2 text-sm outline-none" style={field}
            placeholder="Ex.: seja direto e objetivo; me trate por você; evite jargão." />
          <button onClick={save} disabled={saving}
            className="mt-1 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ background: "linear-gradient(120deg, var(--color-amber), var(--color-gold))", color: "#241403" }}>
            {saving ? "Salvando…" : saved ? "Salvo ✓" : "Salvar persona"}
          </button>
        </div>
      )}
    </div>
  );
}

type Usage = {
  requests: number; tokensTotal: number; localRequests: number; cloudRequests: number;
  economiaBRL: number; cloudSpentBRL: number; energyWhEstimate: number; energyCostBRL: number; liquidoBRL: number;
  assumptions: { LOCAL_WATTS: number; KWH_PRICE_BRL: number };
};

/** Economia acumulada vs. nuvem — dados reais persistidos (/api/usage). */
export function EconomyPanel({ refreshKey }: { refreshKey: number }) {
  const [u, setU] = useState<Usage | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/usage").then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d) setU(d); }).catch(() => {});
    return () => { alive = false; };
  }, [refreshKey]);
  const money = (n: number) => "R$" + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pctLocal = u && u.requests ? Math.round((u.localRequests / u.requests) * 100) : 0;
  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
      <h3 className="mb-3 font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-dim)" }}>Economia vs. nuvem</h3>
      {!u ? (
        <div className="py-2 text-[13px]" style={{ color: "var(--color-ink-dim)" }}>—</div>
      ) : (
        <>
          <Stat label="Respostas locais" value={`${u.localRequests}/${u.requests} (${pctLocal}%)`} />
          <Stat label="Tokens (~saída)" value={u.tokensTotal.toLocaleString("pt-BR")} />
          <Stat label="Energia local (est.)" value={`${u.energyWhEstimate.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} Wh`} />
          <Stat label="Custo da energia (est.)" value={money(u.energyCostBRL)} />
          {u.cloudSpentBRL > 0 && <Stat label="Gasto em nuvem paga" value={money(u.cloudSpentBRL)} accent />}
          <div className="mt-3 rounded-xl border p-3" style={{ borderColor: "color-mix(in oklab, var(--color-gold) 30%, transparent)", background: "color-mix(in oklab, var(--color-gold) 12%, transparent)" }}>
            <div className="font-mono text-[10px] uppercase" style={{ color: "var(--color-gold)" }}>você economizou</div>
            <div className="mt-1 text-xl font-bold">{money(u.economiaBRL)} <span className="text-xs" style={{ color: "var(--color-ink-dim)" }}>vs. pagar por uso</span></div>
            <div className="mt-1 text-[11px]" style={{ color: "var(--color-ink-dim)" }}>líquido de energia: <b>{money(u.liquidoBRL)}</b></div>
          </div>
          <p className="mt-2 text-[10px] leading-snug" style={{ color: "var(--color-ink-dim)" }}>
            Estimativa: energia a {u.assumptions.LOCAL_WATTS}W · {money(u.assumptions.KWH_PRICE_BRL)}/kWh (sem GPU dedicada, valor configurável). Economia = preço de referência da nuvem para respostas locais/Max.
          </p>
        </>
      )}
    </div>
  );
}
