"use client";

import { useEffect, useState } from "react";
import { Card, PanelTitle, Input, Button } from "@/components/ui";

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
    <Card>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center">
        <PanelTitle>Conectores</PanelTitle>
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
                <button onClick={() => disconnect(c.id)} className="text-[11px]" style={{ color: "var(--color-danger)" }}>desconectar</button>
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
        {open && <WhatsappBlock />}
      </div>
    </Card>
  );
}

/**
 * WhatsApp não tem OAuth por usuário sem passar pela revisão de app da Meta
 * (Embedded Signup) — o que dá para fazer é tirar o token do `.env` fixo e
 * trazer para cá (CH.2, zero hardcode). Token e phone_id vêm do próprio app
 * da Meta que o dono já configurou.
 */
function WhatsappBlock() {
  const [status, setStatus] = useState<{ configured: boolean; phoneId: string | null } | null>(null);
  const [phoneId, setPhoneId] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    fetch("/api/channels/whatsapp").then((r) => r.json()).then(setStatus).catch(() => setStatus(null));
  }, [reload]);

  async function save() {
    setBusy(true);
    await fetch("/api/channels/whatsapp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phoneId, token }) });
    setBusy(false);
    setToken("");
    setReload((n) => n + 1);
  }
  async function remove() {
    setBusy(true);
    await fetch("/api/channels/whatsapp", { method: "DELETE" });
    setBusy(false);
    setReload((n) => n + 1);
  }

  return (
    <div className="rounded-lg border p-2 text-[11px]" style={{ borderColor: "var(--color-line)" }}>
      <div className="flex items-center gap-2">
        <span>🟢</span>
        <span className="font-semibold" style={{ color: "var(--color-ink)" }}>WhatsApp</span>
        {status?.configured && <span className="ml-auto" style={{ color: "var(--color-gold)" }}>● configurado</span>}
      </div>
      <p className="mt-1" style={{ color: "var(--color-ink-dim)" }}>Token e ID do número do seu app da Meta (WhatsApp Business Cloud API).</p>
      {status?.configured ? (
        <div className="mt-2 flex items-center gap-2">
          <span style={{ color: "var(--color-ink-dim)" }}>número: {status.phoneId}</span>
          <button onClick={remove} disabled={busy} style={{ color: "var(--color-danger)" }}>desconectar</button>
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-1">
          <Input placeholder="phone_id" value={phoneId} onChange={(e) => setPhoneId(e.target.value)} />
          <Input placeholder="token de acesso" type="password" value={token} onChange={(e) => setToken(e.target.value)} />
          <Button onClick={save} disabled={busy || !phoneId || !token} size="sm">salvar</Button>
        </div>
      )}
    </div>
  );
}
