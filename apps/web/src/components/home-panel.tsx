"use client";

import { useEffect, useState } from "react";
import { Input, Button, ErrorRetry } from "@/components/ui";
import { DEVICE_ID_STORAGE_KEY, getOwnDeviceId } from "@/lib/device-id";
import { Icone } from "@/components/presenca/icones";

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

/**
 * As abas da casa são exportadas UMA A UMA, e não embrulhadas num painel com
 * abas próprias. O motivo: a tela "Minha casa" já tem abas, e aninhar dois
 * níveis (aba dentro de aba) obriga a pessoa a procurar em dois lugares para
 * achar uma coisa só.
 */
export { ConnectionTab as CasaConexao, RoomsTab as CasaComodos, EntitiesTab as CasaDispositivos, OrbitaDevicesTab as CasaAparelhos, DomainRiskTab as CasaRiscoPorTipo };

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
  if (!status) return <p className="text-[15px]" style={dim}>Carregando…</p>;

  return (
    <div className="panel flex flex-col gap-2 text-[15px]">
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
  const [comodos, setComodos] = useState<Room[] | null>(null);
  const [dispositivos, setDispositivos] = useState<Entity[]>([]);
  const [aparelhos, setAparelhos] = useState<OrbitaDevice[]>([]);
  const [nome, setNome] = useState("");
  const [recarregar, setRecarregar] = useState(0);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    // Os três juntos porque o cartão do cômodo só faz sentido dizendo o que há
    // dentro dele: um cômodo vazio na tela não explica por que existe.
    Promise.all([
      fetch("/api/home/rooms").then((r) => r.json()).then((d) => d.rooms ?? []),
      fetch("/api/home/entities").then((r) => r.json()).then((d) => d.entities ?? []).catch(() => []),
      fetch("/api/devices").then((r) => r.json()).then((d) => d.devices ?? []).catch(() => []),
    ])
      .then(([c, e, a]) => {
        setComodos(c);
        setDispositivos(e);
        setAparelhos(a);
      })
      .catch(() => setComodos([]));
  }, [recarregar]);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    setErro(null);
    const r = await fetch("/api/home/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nome }),
    }).catch(() => null);
    if (!r?.ok) {
      setErro(((await r?.json().catch(() => ({}))) as { error?: string })?.error ?? "Não foi possível criar o cômodo.");
      return;
    }
    setNome("");
    setRecarregar((n) => n + 1);
  }

  async function apagar(id: string, nomeDoComodo: string) {
    if (!window.confirm(`Apagar ${nomeDoComodo}? Os dispositivos e aparelhos ligados a ele ficam sem cômodo.`)) return;
    setErro(null);
    const r = await fetch(`/api/home/rooms?id=${id}`, { method: "DELETE" }).catch(() => null);
    if (!r?.ok) {
      setErro(((await r?.json().catch(() => ({}))) as { error?: string })?.error ?? "Não foi possível apagar o cômodo.");
      return;
    }
    setRecarregar((n) => n + 1);
  }

  if (!comodos) return <div className="panel empty-state">Carregando os ambientes…</div>;

  return (
    <>
      <div className="section-heading quick-heading" style={{ marginTop: 0 }}>
        <div>
          <h2>Seus ambientes</h2>
          <p className="descricao-secao">
            Sem lista fixa: a casa é a que você cadastrar. É o cômodo que diz à Órbita onde é “aqui”.
          </p>
        </div>
      </div>

      {erro && (
        <div className="aviso-erro">
          <span>{erro}</span>
        </div>
      )}

      <div className="three-columns">
        {comodos.map((c) => {
          const daCasa = dispositivos.filter((d) => d.roomId === c.id);
          const daOrbita = aparelhos.filter((a) => a.roomId === c.id);
          return (
            <article key={c.id} className="panel room-card">
              <div className="room-visual">
                <div className="room-illustration" aria-hidden="true" />
              </div>
              <div className="room-body">
                <div className="room-label">
                  <h3>{c.name}</h3>
                  <button className="icon-button" onClick={() => apagar(c.id, c.name)} aria-label={`Apagar ${c.name}`} title="Apagar cômodo">
                    <Icone nome="trash" />
                  </button>
                </div>
                <p>
                  {daCasa.length === 0 && daOrbita.length === 0
                    ? "Nenhum dispositivo aqui ainda."
                    : [
                        daCasa.length ? `${daCasa.length} ${daCasa.length === 1 ? "dispositivo" : "dispositivos"}` : null,
                        daOrbita.length ? `${daOrbita.length} ${daOrbita.length === 1 ? "aparelho da Órbita" : "aparelhos da Órbita"}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                </p>
                {daCasa.length > 0 && (
                  <div className="room-tags">
                    {daCasa.slice(0, 5).map((d) => (
                      <span key={d.entityId} className="tag">
                        {d.friendlyName}
                      </span>
                    ))}
                    {daCasa.length > 5 && <span className="tag">+{daCasa.length - 5}</span>}
                  </div>
                )}
              </div>
            </article>
          );
        })}

        <form className="panel room-card room-novo" onSubmit={criar}>
          <span className="quick-icon mint-bg">
            <Icone nome="plus" />
          </span>
          <h3>Um cômodo novo</h3>
          <p>Sala, escritório, quarto das crianças. O nome é o que você usa em voz alta.</p>
          <label className="field">
            Nome do cômodo
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Escritório" maxLength={60} required />
          </label>
          <button type="submit" className="button primary full-width">
            <Icone nome="check" />
            Criar cômodo
          </button>
        </form>
      </div>

      <div className="notice">
        “Aqui” vem do aparelho, não de adivinhação: sem um aparelho cadastrado num cômodo, a Órbita
        pergunta qual é em vez de agir no lugar errado.
      </div>
    </>
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
    const r = await fetch("/api/home/entities", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityId, roomId }) }).catch(() => null);
    if (!r?.ok) { window.alert(((await r?.json().catch(() => ({}))) as { error?: string })?.error ?? "Não foi possível mudar o cômodo do dispositivo."); return; }
    setReload((n) => n + 1);
  }

  if (!entities) return <p className="text-[15px]" style={dim}>Carregando…</p>;
  if (!entities.length) return <p className="text-[15px]" style={dim}>Nenhum dispositivo ainda. Conecte o Home Assistant e sincronize na aba Conexão.</p>;

  return (
    <div className="panel flex max-h-[60vh] flex-col gap-1 overflow-y-auto text-[15px]">
      {entities.map((e) => (
        <div key={e.entityId} className="flex items-center gap-2 rounded-lg border px-2 py-1" style={{ borderColor: "var(--color-line)" }}>
          <div className="min-w-0 flex-1">
            <div className="truncate">{e.friendlyName}</div>
            <div style={dim}>{e.entityId} · {e.state ?? "sem estado"}</div>
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
  } catch { return "data desconhecida"; }
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
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [abrirOutro, setAbrirOutro] = useState(false);
  const [outroNome, setOutroNome] = useState("");
  const [outroTipo, setOutroTipo] = useState<DeviceKind>("satelite");
  const [outroComodo, setOutroComodo] = useState("");

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

  // toda mutação passa por aqui: erro de API vira mensagem na tela, nunca um
  // recarregamento silencioso que devolve o controle ao valor antigo
  async function mutar(req: () => Promise<Response>, falha: string): Promise<boolean> {
    setBusy(true);
    try {
      const r = await req();
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        window.alert(d.error ?? falha);
        return false;
      }
      setReload((n) => n + 1);
      return true;
    } catch {
      window.alert(falha);
      return false;
    } finally {
      setBusy(false);
    }
  }

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

  /**
   * Satélite de voz e celular não abrem esta tela para se registrarem sozinhos:
   * o dono cadastra aqui e leva o id gerado para a configuração do aparelho.
   */
  async function registrarOutro() {
    if (!outroNome.trim()) return;
    const ok = await mutar(
      () => fetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: outroNome.trim(), kind: outroTipo, roomId: outroComodo || null }),
      }),
      "Não foi possível cadastrar o aparelho.",
    );
    if (ok) { setOutroNome(""); setOutroComodo(""); setAbrirOutro(false); }
  }

  async function trocarComodo(id: string, roomId: string) {
    await mutar(
      () => fetch("/api/devices", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, roomId: roomId || null }) }),
      "Não foi possível trocar o cômodo.",
    );
  }

  async function renomear(id: string) {
    if (!nameDraft.trim()) return;
    const ok = await mutar(
      () => fetch("/api/devices", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, name: nameDraft.trim() }) }),
      "Não foi possível renomear.",
    );
    if (ok) setRenamingId(null);
  }

  async function esquecer(d: OrbitaDevice) {
    const proprio = d.id === ownId;
    const aviso = proprio
      ? `Esquecer "${d.name}"? Este navegador para de dizer de onde ele fala e de onde vêm os avisos.`
      : `Esquecer "${d.name}"? Ele deixa de indicar um cômodo, e os avisos param de sair por ele.`;
    if (!window.confirm(aviso)) return;
    const ok = await mutar(() => fetch(`/api/devices?id=${d.id}`, { method: "DELETE" }), "Não foi possível esquecer o aparelho.");
    if (ok && proprio) {
      try { localStorage.removeItem(DEVICE_ID_STORAGE_KEY); } catch { /* segue mesmo sem limpar */ }
    }
  }

  function Acoes({ d }: { d: OrbitaDevice }) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <select value={d.roomId ?? ""} disabled={busy} onChange={(e) => trocarComodo(d.id, e.target.value)}
          className="rounded-md border px-1 py-0.5" style={{ borderColor: "var(--color-line)", background: "transparent" }}>
          <option value="">sem cômodo</option>
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <button onClick={() => { setNameDraft(d.name); setRenamingId(d.id); }} className="text-[14px] underline" style={dim} disabled={busy}>
          renomear
        </button>
        <button onClick={() => esquecer(d)} className="text-[14px]" style={{ color: "var(--color-danger)" }} disabled={busy}>
          esquecer
        </button>
      </div>
    );
  }

  if (err) return <ErrorRetry message={err} onRetry={() => setReload((n) => n + 1)} />;
  if (!devices) return <p className="text-[15px]" style={dim}>Carregando…</p>;

  const outros = devices.filter((d) => d.id !== ownId);

  return (
    <div className="panel flex flex-col gap-2 text-[15px]">
      <p style={dim}>
        Aparelhos que falam com a Órbita, como este navegador ou um satélite de voz, diferente dos
        dispositivos do Home Assistant. É assim que a Órbita sabe onde é aqui quando você diz
        apaga a luz daqui, e por onde ela avisa no cômodo em que você está.
      </p>

      {own ? (
        <div className="rounded-lg border p-2" style={{ borderColor: "var(--color-gold)" }}>
          {renamingId === own.id ? (
            <div className="flex gap-2">
              <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && renomear(own.id)} />
              <Button size="sm" disabled={busy} onClick={() => renomear(own.id)}>salvar</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setRenamingId(null)}>cancelar</Button>
            </div>
          ) : (
            <>
              <p>
                Este aparelho: <strong>{own.name}</strong> ({own.roomName ?? "sem cômodo"})
              </p>
              <div className="mt-2">
                <Acoes d={own} />
              </div>
            </>
          )}
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
        <p className="text-[14px] font-medium" style={dim}>Outros aparelhos</p>
        {outros.length === 0 ? (
          <p className="text-[14px]" style={dim}>Nenhum outro aparelho registrado ainda.</p>
        ) : (
          outros.map((d) => (
            <div key={d.id} className="flex flex-col gap-1 rounded-lg border px-2 py-1" style={{ borderColor: "var(--color-line)" }}>
              {renamingId === d.id ? (
                <div className="flex gap-2">
                  <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && renomear(d.id)} />
                  <Button size="sm" disabled={busy} onClick={() => renomear(d.id)}>salvar</Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setRenamingId(null)}>cancelar</Button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{d.name} <span style={dim}>· {DEVICE_KIND_LABEL[d.kind]} · {d.roomName ?? "sem cômodo"}</span></span>
                  <span className="shrink-0" style={dim}>{fmtLastSeen(d.lastSeenAt)}</span>
                </div>
              )}
              {d.kind !== "navegador" && (
                <p className="text-[13px]" style={dim}>
                  id para configurar no aparelho: <code>{d.id}</code>
                </p>
              )}
              <Acoes d={d} />
            </div>
          ))
        )}
        {abrirOutro ? (
          <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border p-2" style={{ borderColor: "var(--color-line)" }}>
            <Input placeholder="nome do aparelho" value={outroNome} onChange={(e) => setOutroNome(e.target.value)} onKeyDown={(e) => e.key === "Enter" && registrarOutro()} />
            <select value={outroTipo} disabled={busy} onChange={(e) => setOutroTipo(e.target.value as DeviceKind)}
              className="rounded-md border px-1 py-0.5" style={{ borderColor: "var(--color-line)", background: "transparent" }}>
              <option value="satelite">satélite</option>
              <option value="celular">celular</option>
              <option value="navegador">navegador</option>
            </select>
            <select value={outroComodo} disabled={busy} onChange={(e) => setOutroComodo(e.target.value)}
              className="rounded-md border px-1 py-0.5" style={{ borderColor: "var(--color-line)", background: "transparent" }}>
              <option value="">sem cômodo</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <Button size="sm" disabled={busy || !outroNome.trim()} onClick={registrarOutro}>salvar</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setAbrirOutro(false)}>cancelar</Button>
          </div>
        ) : (
          <button onClick={() => setAbrirOutro(true)} className="mt-1 self-start text-[14px] underline" style={dim} disabled={busy}>
            + cadastrar outro aparelho (satélite, celular)
          </button>
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

  if (!rows) return <p className="text-[15px]" style={dim}>Carregando…</p>;
  if (!rows.length) return <p className="text-[15px]" style={dim}>Sincronize os dispositivos para ver os tipos existentes na sua casa.</p>;

  return (
    <div className="panel flex flex-col gap-1 text-[15px]">
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
