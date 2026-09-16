"use client";

import { useEffect, useState } from "react";
import { Card, PanelTitle, Input, ErrorRetry } from "@/components/ui";

/**
 * Tela de AJUSTES: renderiza o que o servidor define (grupo, rótulo, tipo,
 * faixa, default, valor efetivo). Não há lista de campos aqui: uma chave nova
 * em packages/core/src/settings/defs.ts aparece sozinha. Lógica de validação
 * é do servidor; este componente só orquestra UI e chamadas.
 */
type SettingType =
  | { kind: "number"; min: number; max: number; step?: number; integer?: boolean }
  | { kind: "boolean" }
  | { kind: "select"; options: { value: string; label: string }[] }
  | { kind: "text"; maxLength?: number }
  | { kind: "list"; maxItems?: number; itemMaxLength?: number };

interface Item {
  key: string; label: string; description: string; unit?: string; warning?: string;
  type: SettingType; value: unknown; default: unknown; overridden: boolean;
}
interface Group { id: string; label: string; settings: Item[] }

const dim = { color: "var(--color-ink-dim)" } as const;

export function SettingsPanel() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setErr(null);
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (alive) setGroups(d.groups ?? []); })
      .catch(() => { if (alive) setErr("Não foi possível carregar os ajustes."); });
    return () => { alive = false; };
  }, [reload]);

  async function save(key: string, value: unknown): Promise<string | null> {
    const r = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, value }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return d.error ?? "Valor inválido";
    setGroups((gs) => gs?.map((g) => ({ ...g, settings: g.settings.map((s) => (s.key === key ? { ...s, value: d.value, overridden: true } : s)) })) ?? null);
    return null;
  }
  async function reset(key: string) {
    await fetch(`/api/settings?key=${encodeURIComponent(key)}`, { method: "DELETE" });
    setGroups((gs) => gs?.map((g) => ({ ...g, settings: g.settings.map((s) => (s.key === key ? { ...s, value: s.default, overridden: false } : s)) })) ?? null);
  }

  if (err) return <Card><PanelTitle className="mb-2">Ajustes</PanelTitle><ErrorRetry message={err} onRetry={() => setReload((n) => n + 1)} /></Card>;

  const total = groups?.reduce((n, g) => n + g.settings.filter((s) => s.overridden).length, 0) ?? 0;

  return (
    <Card>
      <div className="mb-2 flex items-baseline justify-between">
        <PanelTitle>Ajustes</PanelTitle>
        <span className="text-[11px]" style={dim}>{total ? `${total} alterado${total > 1 ? "s" : ""}` : "tudo no padrão"}</span>
      </div>
      <p className="mb-3 text-[12px]" style={dim}>Nada aqui é obrigatório. Mudou, valeu em segundos, sem reiniciar.</p>
      {!groups ? (
        <p className="text-[12px]" style={dim}>Carregando…</p>
      ) : (
        <div className="flex flex-col gap-1">
          {groups.map((g) => (
            <div key={g.id} className="rounded-lg border" style={{ borderColor: "var(--color-line)" }}>
              <button type="button" onClick={() => setOpen(open === g.id ? null : g.id)} className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px]">
                <span>{g.label}</span>
                <span className="text-[11px]" style={dim}>
                  {g.settings.filter((s) => s.overridden).length ? `${g.settings.filter((s) => s.overridden).length} alterado` : ""} {open === g.id ? "▾" : "▸"}
                </span>
              </button>
              {open === g.id && (
                <div className="flex flex-col gap-3 border-t px-3 py-3" style={{ borderColor: "var(--color-line-soft, var(--color-line))" }}>
                  {g.settings.map((s) => <SettingField key={s.key} item={s} onSave={save} onReset={reset} />)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function SettingField({ item, onSave, onReset }: { item: Item; onSave: (k: string, v: unknown) => Promise<string | null>; onReset: (k: string) => Promise<void> }) {
  const [draft, setDraft] = useState<string>(toDraft(item.value));
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(toDraft(item.value)); }, [item.value]);

  async function commit(raw: unknown) {
    setBusy(true);
    setMsg(null);
    const e = await onSave(item.key, raw);
    setMsg(e ?? (item.warning ? item.warning : "Salvo"));
    setBusy(false);
  }
  function commitDraft() {
    if (draft === toDraft(item.value)) return;
    const t = item.type;
    if (t.kind === "number") { const n = Number(draft); if (!Number.isFinite(n)) { setMsg("Número inválido"); return; } void commit(n); }
    else if (t.kind === "list") void commit(draft.split(/[\n,]/).map((x) => x.trim()).filter(Boolean));
    else void commit(draft);
  }

  const t = item.type;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-[12px] font-medium">{item.label}{item.unit ? <span style={dim}> ({item.unit})</span> : null}</label>
        {item.overridden && (
          <button type="button" onClick={() => onReset(item.key)} className="text-[11px] underline" style={dim} title={`Padrão: ${String(item.default)}`}>
            restaurar padrão
          </button>
        )}
      </div>
      <p className="mb-1 text-[11px]" style={dim}>{item.description}</p>
      {t.kind === "number" && (
        <Input type="number" value={draft} min={t.min} max={t.max} step={t.step ?? (t.integer ? 1 : "any")} disabled={busy}
          onChange={(e) => setDraft(e.target.value)} onBlur={commitDraft} onKeyDown={(e) => { if (e.key === "Enter") commitDraft(); }} />
      )}
      {t.kind === "text" && (
        <Input type="text" value={draft} maxLength={t.maxLength} disabled={busy}
          onChange={(e) => setDraft(e.target.value)} onBlur={commitDraft} onKeyDown={(e) => { if (e.key === "Enter") commitDraft(); }} />
      )}
      {t.kind === "list" && (
        <textarea value={draft} disabled={busy} rows={2} placeholder="um por linha"
          className="w-full rounded-lg border px-2 py-1 text-[12px]" style={{ borderColor: "var(--color-line)", background: "transparent" }}
          onChange={(e) => setDraft(e.target.value)} onBlur={commitDraft} />
      )}
      {t.kind === "select" && (
        <select value={String(item.value)} disabled={busy} onChange={(e) => void commit(e.target.value)}
          className="w-full rounded-lg border px-2 py-1 text-[12px]" style={{ borderColor: "var(--color-line)", background: "transparent" }}>
          {t.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      {t.kind === "boolean" && (
        <label className="flex items-center gap-2 text-[12px]">
          <input type="checkbox" checked={Boolean(item.value)} disabled={busy} onChange={(e) => void commit(e.target.checked)} /> ativo
        </label>
      )}
      {msg && <p className="mt-1 text-[11px]" style={{ color: msg === "Salvo" ? "var(--color-gold)" : "var(--color-danger, var(--color-gold))" }}>{msg}</p>}
    </div>
  );
}

function toDraft(v: unknown): string {
  if (Array.isArray(v)) return v.join("\n");
  if (v === null || v === undefined) return "";
  return String(v);
}
