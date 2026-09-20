"use client";

import { useEffect, useState } from "react";
import { Icone } from "@/components/presenca/icones";
import { Card, PanelTitle, Input, Button, ErrorRetry } from "@/components/ui";

/**
 * Câmeras (Onda 5): cadastro sem lista fixa, token de webhook por câmera
 * (Frigate ou script equivalente posta em /api/cameras/ingest) e narração
 * sob demanda dos eventos recebidos — nunca vídeo contínuo, nunca narração
 * automática por padrão (decisão do dono).
 */
const dim = { color: "var(--color-ink-dim)" } as const;

interface Room { id: string; name: string }
interface CameraRow { id: string; name: string; roomId: string | null; enabled: boolean; identifyFaces: boolean; detectGestures: boolean }
interface CameraEventRow {
  id: string; label: string; zone: string | null; score: number | null; snapshot: string | null; narration: string | null; createdAt: string;
  identifiedName: string | null; identifiedLabel: string | null; identifiedOutcome: string | null; identifiedScore: number | null;
}

/**
 * Nada é afirmado sem confiança (PRD §7): "identificado" vira o nome com o
 * percentual, "provável" vira "provavelmente" e o resto é gente desconhecida.
 */
function quemFoi(e: CameraEventRow): string | null {
  const pct = e.identifiedScore === null ? null : `${Math.round(e.identifiedScore * 100)}%`;
  if (e.identifiedOutcome === "identificado" && e.identifiedName) return pct ? `${e.identifiedName} (${pct})` : e.identifiedName;
  if (e.identifiedOutcome === "provavel" && e.identifiedName) return `provavelmente ${e.identifiedName}${pct ? ` (${pct})` : ""}`;
  if (e.identifiedLabel) return e.identifiedLabel;
  if (e.identifiedOutcome === "desconhecido") return "alguém que não reconheci";
  return null;
}

export function CameraPanel() {
  const [tab, setTab] = useState<"cameras" | "eventos">("cameras");
  return (
    <Card>
      <PanelTitle className="mb-2">Câmeras</PanelTitle>
      <div className="mb-3 flex gap-1 text-[14px]">
        {([["cameras", "Câmeras"], ["eventos", "Eventos"]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className="rounded-full border px-2 py-1"
            style={{ borderColor: tab === id ? "var(--color-gold)" : "var(--color-line)", color: tab === id ? "var(--color-gold)" : "var(--color-ink-dim)" }}>
            {label}
          </button>
        ))}
      </div>
      {tab === "cameras" && <CamerasTab />}
      {tab === "eventos" && <EventsTab />}
    </Card>
  );
}

function CamerasTab() {
  const [cams, setCams] = useState<CameraRow[] | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [novoToken, setNovoToken] = useState<{ nome: string; token: string } | null>(null);

  useEffect(() => {
    let alive = true;
    setErr(null);
    Promise.all([
      fetch("/api/cameras").then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => d.cameras ?? []),
      fetch("/api/home/rooms").then((r) => r.json()).then((d) => d.rooms ?? []),
    ])
      .then(([c, r]) => { if (alive) { setCams(c); setRooms(r); } })
      .catch(() => { if (alive) setErr("Não foi possível carregar."); });
    return () => { alive = false; };
  }, [reload]);

  // erro de API vira mensagem, nunca um recarregamento mudo que desfaz o
  // clique sem explicar (sessão expirada parecia defeito da câmera)
  async function patch(c: CameraRow, corpo: Record<string, unknown>, falha: string): Promise<boolean> {
    const r = await fetch(`/api/cameras?id=${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }).catch(() => null);
    if (!r?.ok) {
      const d = (await r?.json().catch(() => ({}))) as { error?: string } | undefined;
      window.alert(d?.error ?? falha);
      setReload((n) => n + 1);
      return false;
    }
    setReload((n) => n + 1);
    return true;
  }

  async function add() {
    if (!name.trim()) return;
    const r = await fetch("/api/cameras", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, roomId: roomId || null }) }).catch(() => null);
    const d = (await r?.json().catch(() => ({}))) as { webhookToken?: string; error?: string } | undefined;
    if (!r?.ok) { window.alert(d?.error ?? "Não foi possível cadastrar a câmera."); return; }
    if (d?.webhookToken) setNovoToken({ nome: name, token: d.webhookToken });
    setName("");
    setRoomId("");
    setReload((n) => n + 1);
  }
  async function toggle(c: CameraRow) {
    await patch(c, { enabled: !c.enabled }, "Não foi possível ligar ou desligar a câmera.");
  }
  async function toggleIdentify(c: CameraRow) {
    const ligar = !c.identifyFaces;
    const ok = await patch(c, { identifyFaces: ligar }, "Não foi possível mudar a identificação de rosto.");
    if (ok && ligar) {
      window.alert(`Identificação de rosto ligada em ${c.name}. A narração desta câmera passa a usar só modelo local, nunca a nuvem.

Precisão: contraluz, rosto de lado e gente longe da câmera costumam sair como "não reconheci", e parentes parecidos podem ser confundidos. A Órbita diz "provavelmente" quando não tem certeza, e a trilha de identidade mostra a confiança de cada leitura.`);
    }
  }
  async function toggleGestures(c: CameraRow) {
    await patch(c, { detectGestures: !c.detectGestures }, "Não foi possível mudar a leitura de gestos.");
  }
  async function remove(c: CameraRow) {
    // o histórico de eventos cai junto (cascade), inclusive identificações e
    // gestos já registrados: não dá para desfazer, então pergunta antes
    if (!window.confirm(`Apagar a câmera "${c.name}"? O token do webhook para de valer e todo o histórico de eventos dela, com identificações e gestos, some junto.`)) return;
    const r = await fetch(`/api/cameras?id=${c.id}`, { method: "DELETE" }).catch(() => null);
    if (!r?.ok) {
      const d = (await r?.json().catch(() => ({}))) as { error?: string } | undefined;
      window.alert(d?.error ?? "Não foi possível apagar a câmera.");
      return;
    }
    setReload((n) => n + 1);
  }

  if (err) return <ErrorRetry message={err} onRetry={() => setReload((n) => n + 1)} />;
  if (!cams) return <p className="text-[15px]" style={dim}>Carregando…</p>;

  return (
    <div className="flex flex-col gap-2 text-[15px]">
      <p style={dim}>Sem lista fixa: cadastre cada câmera e aponte o Frigate (ou script equivalente) para o webhook com o token gerado.</p>
      {novoToken && (
        <div className="rounded-lg border p-2" style={{ borderColor: "var(--color-gold)" }}>
          <p>Token de <b>{novoToken.nome}</b> (copie agora, não aparece de novo):</p>
          <code className="block break-all text-[13px]" style={dim}>{novoToken.token}</code>
          <p className="mt-1 text-[13px]" style={dim}>POST /api/cameras/ingest com {"{ token, label, zone?, score?, snapshot? }"}</p>
          <button onClick={() => setNovoToken(null)} className="mt-1 text-[13px]" style={{ color: "var(--color-gold)" }}>fechar</button>
        </div>
      )}
      {cams.map((c) => (
        <div key={c.id} className="flex flex-col gap-1 rounded-lg border px-2 py-1" style={{ borderColor: "var(--color-line)" }}>
          <div className="flex items-center justify-between">
            <div>
              <span>{c.name}</span>
              <span style={dim}> · {rooms.find((r) => r.id === c.roomId)?.name ?? "sem cômodo"}</span>
              {!c.enabled && <span style={{ color: "var(--color-danger)" }}> · desligada</span>}
            </div>
            <div className="flex gap-2">
              <button onClick={() => toggle(c)} style={{ color: "var(--color-gold)" }}>{c.enabled ? "desligar" : "ligar"}</button>
              <button className="icon-button" onClick={() => remove(c)} aria-label="Remover câmera" title="Remover"><Icone nome="trash" /></button>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 text-[14px]" style={dim}>
              <input type="checkbox" checked={c.identifyFaces} onChange={() => void toggleIdentify(c)} />
              Identificar quem aparece
            </label>
            <label className="flex items-center gap-2 text-[14px]" style={dim}>
              <input type="checkbox" checked={c.detectGestures} onChange={() => void toggleGestures(c)} />
              Reconhecer gestos
            </label>
          </div>
          <p className="text-[13px]" style={dim}>
            Liga o reconhecimento de rosto nesta câmera e atualiza quem está em qual cômodo. Com
            isso ligado, a narração da cena usa só modelo local, nunca a nuvem.
          </p>
          <p className="text-[13px]" style={dim}>
            Reconhece gestos como mão levantada nesta câmera. O que cada gesto faz é você que
            decide, criando uma regra sobre o evento identity.gesture.
          </p>
        </div>
      ))}
      <div className="flex gap-2">
        <Input placeholder="nome da câmera" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <select value={roomId} onChange={(e) => setRoomId(e.target.value)} className="rounded-md border px-1 py-0.5" style={{ borderColor: "var(--color-line)", background: "transparent" }}>
          <option value="">sem cômodo</option>
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <Button onClick={add} size="sm">+ câmera</Button>
      </div>
      <p className="text-[13px]" style={dim}>
        Os objetos que a Órbita lembra onde ficaram (tipo "onde deixei a chave") se configuram em
        Ajustes, no grupo Visão: objetos e gestos.
      </p>
    </div>
  );
}

function EventsTab() {
  const [events, setEvents] = useState<CameraEventRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setErr(null);
    // falhar calado aqui faria erro de rede parecer "nenhum evento ainda"
    fetch("/api/cameras/events")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (alive) setEvents(d.events ?? []); })
      .catch(() => { if (alive) setErr("Não foi possível carregar os eventos."); });
    return () => { alive = false; };
  }, [reload]);

  async function narrate(id: string) {
    setBusyId(id);
    const r = await fetch("/api/cameras/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: id }) }).catch(() => null);
    setBusyId(null);
    if (!r?.ok) {
      const d = (await r?.json().catch(() => ({}))) as { error?: string } | undefined;
      window.alert(d?.error ?? "Não foi possível descrever a cena.");
      return;
    }
    setReload((n) => n + 1);
  }

  if (err) return <ErrorRetry message={err} onRetry={() => setReload((n) => n + 1)} />;
  if (!events) return <p className="text-[15px]" style={dim}>Carregando…</p>;
  if (!events.length) return <p className="text-[15px]" style={dim}>Nenhum evento recebido ainda.</p>;

  return (
    <div className="flex max-h-80 flex-col gap-1 overflow-y-auto text-[15px]">
      {events.map((e) => (
        <div key={e.id} className="rounded-lg border px-2 py-1" style={{ borderColor: "var(--color-line)" }}>
          <div className="flex items-center justify-between">
            <span>
              {e.label}{e.zone && ` · ${e.zone}`}
              {quemFoi(e) && <span style={{ color: "var(--color-gold)" }}> · {quemFoi(e)}</span>}
            </span>
            <span style={dim}>{new Date(e.createdAt).toLocaleString("pt-BR")}</span>
          </div>
          {e.narration ? (
            <p className="mt-1" style={dim}>{e.narration}</p>
          ) : e.snapshot ? (
            <button onClick={() => narrate(e.id)} disabled={busyId === e.id} className="mt-1" style={{ color: "var(--color-gold)" }}>
              {busyId === e.id ? "narrando…" : "narrar agora"}
            </button>
          ) : (
            <p className="mt-1" style={dim}>sem imagem</p>
          )}
        </div>
      ))}
    </div>
  );
}
