"use client";

import { useEffect, useState } from "react";
import { Card, PanelTitle, Input, Button, ErrorRetry } from "@/components/ui";

/**
 * A casa (Onda 3): conectar o Home Assistant, cadastrar cômodos, associar
 * dispositivos e ajustar o risco por domínio. Zero hardcode: nenhuma lista
 * fixa de cômodos ou dispositivos, tudo cadastrado aqui.
 */
type Risk = "leitura" | "escrita" | "efeito_externo" | "perigoso";
const RISK_LABEL: Record<Risk, string> = { leitura: "leitura", escrita: "direto", efeito_externo: "efeito externo (aprova)", perigoso: "perigoso (aprova)" };
const dim = { color: "var(--color-ink-dim)" } as const;

interface Room { id: string; name: string; icon: string | null }
interface Entity { entityId: string; domain: string; friendlyName: string; roomId: string | null; state: string | null }
interface DomainRiskRow { domain: string; default: Risk; override: Risk | null; effective: Risk; known: boolean }

export function HomePanel() {
  const [tab, setTab] = useState<"conexao" | "comodos" | "dispositivos" | "risco">("conexao");
  return (
    <Card>
      <PanelTitle className="mb-2">Casa</PanelTitle>
      <div className="mb-3 flex gap-1 text-[11px]">
        {([["conexao", "Conexão"], ["comodos", "Cômodos"], ["dispositivos", "Dispositivos"], ["risco", "Risco por tipo"]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className="rounded-full border px-2 py-1"
            style={{ borderColor: tab === id ? "var(--color-gold)" : "var(--color-line)", color: tab === id ? "var(--color-gold)" : "var(--color-ink-dim)" }}>
            {label}
          </button>
        ))}
      </div>
      {tab === "conexao" && <ConnectionTab />}
      {tab === "comodos" && <RoomsTab />}
      {tab === "dispositivos" && <EntitiesTab />}
      {tab === "risco" && <DomainRiskTab />}
    </Card>
  );
}

function ConnectionTab() {
  const [status, setStatus] = useState<{ connected: boolean; baseUrl: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setErr(null);
    fetch("/api/home/connection").then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => { if (alive) setStatus(d); }).catch(() => { if (alive) setErr("Não foi possível carregar."); });
    return () => { alive = false; };
  }, [reload]);

  async function connect() {
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/home/connection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseUrl, token }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(d.error ?? "Falha ao conectar"); return; }
    setToken("");
    setMsg(`Conectado: ${d.label}`);
    setReload((n) => n + 1);
  }
  async function disconnect() {
    setBusy(true);
    await fetch("/api/home/connection", { method: "DELETE" });
    setBusy(false);
    setReload((n) => n + 1);
  }
  async function syncNow() {
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/home/entities", { method: "POST" });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? `Sincronizado: ${d.total} dispositivos` : (d.error ?? "Falha ao sincronizar"));
  }

  if (err) return <ErrorRetry message={err} onRetry={() => setReload((n) => n + 1)} />;
  if (!status) return <p className="text-[12px]" style={dim}>Carregando…</p>;

  return (
    <div className="flex flex-col gap-2 text-[12px]">
      {status.connected ? (
        <>
          <p>Conectado em <code>{status.baseUrl}</code>.</p>
          <div className="flex gap-2">
            <Button onClick={syncNow} disabled={busy} size="sm">sincronizar agora</Button>
            <Button onClick={disconnect} disabled={busy} variant="danger" size="sm">desconectar</Button>
          </div>
        </>
      ) : (
        <>
          <p style={dim}>Cole o endereço e um token de acesso de longa duração (gerado no seu perfil do Home Assistant).</p>
          <Input placeholder="http://192.168.1.50:8123" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          <Input placeholder="token de acesso" type="password" value={token} onChange={(e) => setToken(e.target.value)} />
          <Button onClick={connect} disabled={busy || !baseUrl || !token} size="sm">{busy ? "testando…" : "conectar"}</Button>
        </>
      )}
      {msg && <p style={{ color: "var(--color-gold)" }}>{msg}</p>}
    </div>
  );
}

function RoomsTab() {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [name, setName] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    fetch("/api/home/rooms").then((r) => r.json()).then((d) => setRooms(d.rooms ?? [])).catch(() => setRooms([]));
  }, [reload]);

  async function add() {
    if (!name.trim()) return;
    await fetch("/api/home/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    setName("");
    setReload((n) => n + 1);
  }
  async function remove(id: string) {
    await fetch(`/api/home/rooms?id=${id}`, { method: "DELETE" });
    setReload((n) => n + 1);
  }

  return (
    <div className="flex flex-col gap-2 text-[12px]">
      <p style={dim}>Sem lista fixa: crie os cômodos que existirem na sua casa.</p>
      {rooms?.map((r) => (
        <div key={r.id} className="flex items-center justify-between rounded-lg border px-2 py-1" style={{ borderColor: "var(--color-line)" }}>
          <span>{r.name}</span>
          <button onClick={() => remove(r.id)} style={{ color: "var(--color-danger)" }}>×</button>
        </div>
      ))}
      <div className="flex gap-2">
        <Input placeholder="nome do cômodo" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <Button onClick={add} size="sm">+ cômodo</Button>
      </div>
    </div>
  );
}

function EntitiesTab() {
  const [entities, setEntities] = useState<Entity[] | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    Promise.all([
      fetch("/api/home/entities").then((r) => r.json()).then((d) => d.entities ?? []),
      fetch("/api/home/rooms").then((r) => r.json()).then((d) => d.rooms ?? []),
    ]).then(([e, r]) => { setEntities(e); setRooms(r); }).catch(() => setEntities([]));
  }, [reload]);

  async function setRoom(entityId: string, roomId: string | null) {
    await fetch("/api/home/entities", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityId, roomId }) });
    setReload((n) => n + 1);
  }

  if (!entities) return <p className="text-[12px]" style={dim}>Carregando…</p>;
  if (!entities.length) return <p className="text-[12px]" style={dim}>Nenhum dispositivo ainda. Conecte o Home Assistant e sincronize na aba Conexão.</p>;

  return (
    <div className="flex max-h-72 flex-col gap-1 overflow-y-auto text-[12px]">
      {entities.map((e) => (
        <div key={e.entityId} className="flex items-center gap-2 rounded-lg border px-2 py-1" style={{ borderColor: "var(--color-line)" }}>
          <div className="min-w-0 flex-1">
            <div className="truncate">{e.friendlyName}</div>
            <div style={dim}>{e.entityId} · {e.state ?? "—"}</div>
          </div>
          <select value={e.roomId ?? ""} onChange={(ev) => setRoom(e.entityId, ev.target.value || null)}
            className="shrink-0 rounded-md border px-1 py-0.5" style={{ borderColor: "var(--color-line)", background: "transparent" }}>
            <option value="">sem cômodo</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}

function DomainRiskTab() {
  const [rows, setRows] = useState<DomainRiskRow[] | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    fetch("/api/home/domain-risk").then((r) => r.json()).then((d) => setRows(d.domains ?? [])).catch(() => setRows([]));
  }, [reload]);

  async function setRisk(domain: string, risk: Risk | "") {
    await fetch("/api/home/domain-risk", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain, risk: risk || null }) });
    setReload((n) => n + 1);
  }

  if (!rows) return <p className="text-[12px]" style={dim}>Carregando…</p>;
  if (!rows.length) return <p className="text-[12px]" style={dim}>Sincronize os dispositivos para ver os tipos existentes na sua casa.</p>;

  return (
    <div className="flex flex-col gap-1 text-[12px]">
      <p style={dim}>Fechadura, alarme, portão e registro pedem aprovação por padrão; luz, tomada, mídia e clima executam direto. Ajuste como preferir.</p>
      {rows.map((r) => (
        <div key={r.domain} className="flex items-center justify-between rounded-lg border px-2 py-1" style={{ borderColor: "var(--color-line)" }}>
          <span>{r.domain}{!r.known && <span style={dim}> (tipo novo)</span>}</span>
          <select value={r.override ?? ""} onChange={(e) => setRisk(r.domain, e.target.value as Risk | "")}
            className="rounded-md border px-1 py-0.5" style={{ borderColor: "var(--color-line)", background: "transparent", color: r.effective === "perigoso" ? "var(--color-gold)" : "inherit" }}>
            <option value="">{RISK_LABEL[r.default]} (padrão)</option>
            {(Object.keys(RISK_LABEL) as Risk[]).filter((k) => k !== r.default).map((k) => <option key={k} value={k}>{RISK_LABEL[k]}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}
