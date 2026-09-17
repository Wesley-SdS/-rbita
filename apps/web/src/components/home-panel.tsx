"use client";

import { useEffect, useState } from "react";
import { Card, PanelTitle, Input, Button, ErrorRetry } from "@/components/ui";
import { DEVICE_ID_STORAGE_KEY, getOwnDeviceId } from "@/lib/device-id";

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
type DeviceKind = "navegador" | "satelite" | "celular";
interface OrbitaDevice { id: string; name: string; kind: DeviceKind; roomId: string | null; roomName: string | null; lastSeenAt: string | null }

export function HomePanel() {
  const [tab, setTab] = useState<"conexao" | "comodos" | "dispositivos" | "aparelhos" | "risco">("conexao");
  return (
    <Card>
      <PanelTitle className="mb-2">Casa</PanelTitle>
      <div className="mb-3 flex gap-1 text-[11px]">
        {([["conexao", "Conexão"], ["comodos", "Cômodos"], ["dispositivos", "Dispositivos"], ["aparelhos", "Aparelhos"], ["risco", "Risco por tipo"]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className="rounded-full border px-2 py-1"
            style={{ borderColor: tab === id ? "var(--color-gold)" : "var(--color-line)", color: tab === id ? "var(--color-gold)" : "var(--color-ink-dim)" }}>
            {label}
          </button>
        ))}
      </div>
      {tab === "conexao" && <ConnectionTab />}
      {tab === "comodos" && <RoomsTab />}
      {tab === "dispositivos" && <EntitiesTab />}
      {tab === "aparelhos" && <OrbitaDevicesTab />}
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

const DEVICE_KIND_LABEL: Record<DeviceKind, string> = { navegador: "navegador", satelite: "satélite", celular: "celular" };

function fmtLastSeen(iso: string | null): string {
  if (!iso) return "nunca usado";
  try {
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
    if (min < 1) return "agora";
    if (min < 60) return `há ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `há ${h} h`;
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch { return "—"; }
}

/**
 * Aparelhos que falam com a Órbita (navegador, satélite de voz, celular), não
 * confundir com os dispositivos do Home Assistant (aba "Dispositivos"). Cada
 * aparelho se registra uma vez, guarda o id no localStorage e o manda a cada
 * mensagem: é assim que "apaga a luz daqui" sabe onde é "aqui" e por onde a
 * Órbita avisa no cômodo em que a pessoa está.
 */
function OrbitaDevicesTab() {
  const [devices, setDevices] = useState<OrbitaDevice[] | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [ownId, setOwnId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [newRoomId, setNewRoomId] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  useEffect(() => { setOwnId(getOwnDeviceId()); }, [reload]);

  useEffect(() => {
    let alive = true;
    setErr(null);
    Promise.all([
      fetch("/api/devices").then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => d.devices ?? []),
      fetch("/api/home/rooms").then((r) => r.json()).then((d) => d.rooms ?? []),
    ])
      .then(([dv, rm]) => { if (alive) { setDevices(dv); setRooms(rm); } })
      .catch(() => { if (alive) setErr("Não foi possível carregar os aparelhos."); });
    return () => { alive = false; };
  }, [reload]);

  const own = devices?.find((d) => d.id === ownId) ?? null;

  async function registrarEste() {
    setBusy(true);
    try {
      const r = await fetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Navegador desta máquina", kind: "navegador", roomId: newRoomId || null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { window.alert(d.error ?? "Não foi possível registrar este aparelho."); return; }
      try { localStorage.setItem(DEVICE_ID_STORAGE_KEY, d.id); } catch { /* localStorage indisponível: segue sem lembrar entre sessões */ }
      setReload((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  async function trocarComodo(roomId: string) {
    if (!own) return;
    setBusy(true);
    try {
      const r = await fetch("/api/devices", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: own.id, roomId: roomId || null }) });
      if (!r.ok) { const d = await r.json().catch(() => ({})); window.alert(d.error ?? "Não foi possível trocar o cômodo."); return; }
      setReload((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  async function renomear() {
    if (!own || !nameDraft.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/devices", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: own.id, name: nameDraft.trim() }) });
      if (!r.ok) { const d = await r.json().catch(() => ({})); window.alert(d.error ?? "Não foi possível renomear."); return; }
      setRenaming(false);
      setReload((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  async function esquecer() {
    if (!own) return;
    if (!window.confirm(`Esquecer "${own.name}"? Este navegador para de dizer de onde ele fala e de onde vêm os avisos.`)) return;
    setBusy(true);
    try {
      await fetch(`/api/devices?id=${own.id}`, { method: "DELETE" });
      try { localStorage.removeItem(DEVICE_ID_STORAGE_KEY); } catch { /* segue mesmo sem limpar */ }
      setReload((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  if (err) return <ErrorRetry message={err} onRetry={() => setReload((n) => n + 1)} />;
  if (!devices) return <p className="text-[12px]" style={dim}>Carregando…</p>;

  return (
    <div className="flex flex-col gap-2 text-[12px]">
      <p style={dim}>
        Aparelhos que falam com a Órbita, como este navegador ou um satélite de voz, diferente dos
        dispositivos do Home Assistant. É assim que a Órbita sabe onde é aqui quando você diz
        apaga a luz daqui, e por onde ela avisa no cômodo em que você está.
      </p>

      {own ? (
        <div className="rounded-lg border p-2" style={{ borderColor: "var(--color-gold)" }}>
          {renaming ? (
            <div className="flex gap-2">
              <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && renomear()} />
              <Button size="sm" disabled={busy} onClick={renomear}>salvar</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setRenaming(false)}>cancelar</Button>
            </div>
          ) : (
            <p>
              Este aparelho: <strong>{own.name}</strong> ({own.roomName ?? "sem cômodo"})
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select value={own.roomId ?? ""} disabled={busy} onChange={(e) => trocarComodo(e.target.value)}
              className="rounded-md border px-1 py-0.5" style={{ borderColor: "var(--color-line)", background: "transparent" }}>
              <option value="">sem cômodo</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            {!renaming && (
              <button onClick={() => { setNameDraft(own.name); setRenaming(true); }} className="text-[11px] underline" style={dim} disabled={busy}>
                renomear
              </button>
            )}
            <button onClick={esquecer} className="text-[11px]" style={{ color: "var(--color-danger)" }} disabled={busy}>
              esquecer este aparelho
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border p-2" style={{ borderColor: "var(--color-line)" }}>
          <p className="mb-2" style={dim}>Este navegador ainda não se identificou para a Órbita.</p>
          <div className="flex flex-wrap items-center gap-2">
            <select value={newRoomId} disabled={busy} onChange={(e) => setNewRoomId(e.target.value)}
              className="rounded-md border px-1 py-0.5" style={{ borderColor: "var(--color-line)", background: "transparent" }}>
              <option value="">sem cômodo</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <Button size="sm" disabled={busy} onClick={registrarEste}>{busy ? "registrando…" : "Registrar este aparelho"}</Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <p className="text-[11px] font-medium" style={dim}>Outros aparelhos</p>
        {devices.filter((d) => d.id !== ownId).length === 0 ? (
          <p className="text-[11px]" style={dim}>Nenhum outro aparelho registrado ainda.</p>
        ) : (
          devices.filter((d) => d.id !== ownId).map((d) => (
            <div key={d.id} className="flex items-center justify-between rounded-lg border px-2 py-1" style={{ borderColor: "var(--color-line)" }}>
              <span>{d.name} <span style={dim}>· {DEVICE_KIND_LABEL[d.kind]} · {d.roomName ?? "sem cômodo"}</span></span>
              <span style={dim}>{fmtLastSeen(d.lastSeenAt)}</span>
            </div>
          ))
        )}
      </div>
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
