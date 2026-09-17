"use client";

import { useEffect, useState } from "react";
import { Card, PanelTitle, Input, Button, ErrorRetry } from "@/components/ui";

/**
 * Pessoas da casa, acesso por cômodo e consentimento biométrico (Onda 8).
 * NÃO é multi-tenant: são pessoas da MESMA casa (CLAUDE.md §1). A lógica de
 * quem pode consentir, apagar e enxergar quem mora no servidor
 * (packages/core/src/identity); este componente só monta o formulário e
 * mostra o que a API devolve ou recusa.
 */
type Role = "dono" | "morador" | "visitante";
type Relation = "morador" | "visitante_frequente" | "contato_externo";
type BiometricKind = "voz" | "rosto";
type GrantedBy = "propria_pessoa" | "responsavel";

const ROLE_LABEL: Record<Role, string> = { dono: "dono (tudo liberado)", morador: "morador (liberado, salvo restrição)", visitante: "visitante (só onde liberar)" };
const RELATION_LABEL: Record<Relation, string> = { morador: "Morador", visitante_frequente: "Visitante frequente", contato_externo: "Contato externo" };
const KIND_LABEL: Record<BiometricKind, string> = { voz: "voz", rosto: "rosto" };
const dim = { color: "var(--color-ink-dim)" } as const;
const danger = { color: "var(--color-danger)" } as const;
const gold = { color: "var(--color-gold)" } as const;

interface Access { roomId: string; roomName: string; allowed: boolean }
interface ConsentRow { id: string; kinds: string[]; grantedBy: GrantedBy; guardianName: string | null; termVersion: string; grantedAt: string; revokedAt: string | null }
interface VisibilityGrant { subjectPersonId: string; allowed: boolean }
interface PersonRow {
  id: string; name: string; role: Role; aliases: string[]; relation: Relation; isMinor: boolean;
  guardianPersonId: string | null; accountEmail: string | null; access: Access[];
  consentimento: Record<BiometricKind, boolean>; consentimentos: ConsentRow[]; podeVer: VisibilityGrant[];
}
interface Room { id: string; name: string }
interface AuditEntry { id: number | string; action: string; personId: string | null; kind: string | null; source: string | null; confidence: number | null; outcome: string | null; createdAt: string }
interface Term { text: string; version: string }

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}

export function HomePeoplePanel() {
  const [people, setPeople] = useState<PersonRow[] | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [term, setTerm] = useState<Term | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let alive = true;
    setErr(null);
    Promise.all([
      fetch("/api/home/persons").then((r) => (r.ok ? r.json() : Promise.reject(r))),
      fetch("/api/home/rooms").then((r) => (r.ok ? r.json() : { rooms: [] })).catch(() => ({ rooms: [] })),
      fetch("/api/identity/consent").then((r) => (r.ok ? r.json() : { termo: null })).catch(() => ({ termo: null })),
    ])
      .then(async ([p, r, t]) => {
        if (!alive) return;
        setPeople(p.people ?? []);
        setRooms(r.rooms ?? []);
        setTerm(t.termo ?? null);
      })
      .catch(async (r) => {
        if (!alive) return;
        const d = r instanceof Response ? await r.json().catch(() => ({})) : {};
        setErr(d.error ?? "Não foi possível carregar pessoas da casa.");
        setPeople([]);
      });
    return () => { alive = false; };
  }, [reload]);

  function refresh() { setReload((n) => n + 1); }

  async function remove(p: PersonRow) {
    if (!window.confirm(`Remover ${p.name}? Isto apaga o cadastro, a biometria e o histórico dela, e revoga os consentimentos registrados. Não tem volta.`)) return;
    const r = await fetch(`/api/home/persons?id=${p.id}`, { method: "DELETE" });
    if (!r.ok) { const d = await r.json().catch(() => ({})); window.alert(d.error ?? "Não foi possível remover"); return; }
    if (expanded === p.id) setExpanded(null);
    refresh();
  }
  async function eraseBiometrics(p: PersonRow) {
    if (!window.confirm(`Apagar toda a biometria de ${p.name}? O cadastro fica, mas as amostras de voz e rosto e os consentimentos somem. Não tem volta.`)) return;
    const r = await fetch(`/api/identity/biometrics?personId=${p.id}&confirm=apagar`, { method: "DELETE" });
    if (!r.ok) { const d = await r.json().catch(() => ({})); window.alert(d.error ?? "Não foi possível apagar a biometria"); return; }
    refresh();
  }
  async function setAccess(personId: string, roomId: string, allowed: boolean) {
    const r = await fetch("/api/home/person-access", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personId, roomId, allowed }) });
    if (!r.ok) { const d = await r.json().catch(() => ({})); window.alert(d.error ?? "Não foi possível salvar o acesso"); return; }
    refresh();
  }
  async function clearAccess(personId: string, roomId: string) {
    const r = await fetch(`/api/home/person-access?personId=${personId}&roomId=${roomId}`, { method: "DELETE" });
    if (!r.ok) { const d = await r.json().catch(() => ({})); window.alert(d.error ?? "Não foi possível voltar ao padrão"); return; }
    refresh();
  }
  async function setVisibility(viewerPersonId: string, subjectPersonId: string, allowed: boolean | null) {
    const r = await fetch("/api/identity/visibility", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ viewerPersonId, subjectPersonId, allowed }) });
    if (!r.ok) { const d = await r.json().catch(() => ({})); window.alert(d.error ?? "Não foi possível salvar"); return; }
    refresh();
  }

  if (err) return <Card><PanelTitle className="mb-2">Pessoas da casa</PanelTitle><ErrorRetry message={err} onRetry={refresh} /></Card>;

  return (
    <Card>
      <PanelTitle className="mb-2">Pessoas da casa</PanelTitle>
      <p className="mb-3 text-[12px]" style={dim}>
        Quem mora ou visita, em quais cômodos poderá agir e se consentiu com biometria de voz e
        rosto. Biometria fica só nos computadores desta casa. O reconhecimento por voz e rosto
        chega nas próximas etapas.
      </p>
      {!people ? (
        <p className="text-[12px]" style={dim}>Carregando…</p>
      ) : (
        <div className="flex flex-col gap-2 text-[12px]">
          {people.map((p) => (
            <PersonCard
              key={p.id}
              person={p}
              people={people}
              rooms={rooms}
              term={term}
              expanded={expanded === p.id}
              onToggle={() => setExpanded(expanded === p.id ? null : p.id)}
              onSaved={refresh}
              onRemove={() => remove(p)}
              onEraseBiometrics={() => eraseBiometrics(p)}
              onSetAccess={setAccess}
              onClearAccess={clearAccess}
              onSetVisibility={setVisibility}
            />
          ))}
          {!people.length && <p style={dim}>Ninguém cadastrado ainda.</p>}

          {creating ? (
            <div className="rounded-lg border p-2" style={{ borderColor: "var(--color-line)" }}>
              <PersonForm
                people={people}
                onCancel={() => setCreating(false)}
                onSubmit={async (input) => {
                  const r = await fetch("/api/home/persons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
                  const d = await r.json().catch(() => ({}));
                  if (!r.ok) return d.error ?? "Não foi possível cadastrar";
                  setCreating(false);
                  refresh();
                  return null;
                }}
              />
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setCreating(true)}>+ pessoa</Button>
          )}
        </div>
      )}
    </Card>
  );
}

function PersonCard({ person, people, rooms, term, expanded, onToggle, onSaved, onRemove, onEraseBiometrics, onSetAccess, onClearAccess, onSetVisibility }: {
  person: PersonRow; people: PersonRow[]; rooms: Room[]; term: Term | null; expanded: boolean;
  onToggle: () => void; onSaved: () => void; onRemove: () => void; onEraseBiometrics: () => void;
  onSetAccess: (personId: string, roomId: string, allowed: boolean) => void;
  onClearAccess: (personId: string, roomId: string) => void;
  onSetVisibility: (viewerPersonId: string, subjectPersonId: string, allowed: boolean | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [consenting, setConsenting] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const p = person;

  return (
    <div className="rounded-lg border p-2" style={{ borderColor: "var(--color-line)" }}>
      <div className="flex items-center justify-between gap-2">
        <button onClick={onToggle} className="min-w-0 flex-1 text-left">
          <strong>{p.name}</strong> <span style={dim}>· {ROLE_LABEL[p.role]} · {RELATION_LABEL[p.relation]}</span>
          {p.isMinor && <span className="ml-1 rounded border px-1" style={{ borderColor: "var(--color-gold)", color: "var(--color-gold)", fontSize: "10px" }}>menor</span>}
          <div className="text-[11px]" style={dim}>
            voz: {p.consentimento.voz ? <span style={gold}>consentido</span> : "sem consentimento"} · rosto: {p.consentimento.rosto ? <span style={gold}>consentido</span> : "sem consentimento"}
          </div>
        </button>
        <button onClick={onRemove} title="Remover pessoa" style={danger}>×</button>
      </div>

      {expanded && (
        <div className="mt-2 flex flex-col gap-3 border-t pt-2" style={{ borderColor: "var(--color-line)" }}>
          {editing ? (
            <PersonForm
              people={people}
              initial={p}
              onCancel={() => setEditing(false)}
              onSubmit={async (input) => {
                const r = await fetch("/api/home/persons", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id, ...input }) });
                const d = await r.json().catch(() => ({}));
                if (!r.ok) return d.error ?? "Não foi possível salvar";
                setEditing(false);
                onSaved();
                return null;
              }}
            />
          ) : (
            <button onClick={() => setEditing(true)} className="self-start text-[11px] underline" style={dim}>editar cadastro</button>
          )}

          {p.role !== "dono" && (
            <div>
              <p className="mb-1 text-[11px] font-medium">Acesso por cômodo</p>
              <div className="flex flex-col gap-1">
                {rooms.map((r) => {
                  const a = p.access.find((x) => x.roomId === r.id);
                  return (
                    <div key={r.id} className="flex items-center justify-between">
                      <span>{r.name}</span>
                      <div className="flex gap-1">
                        <button onClick={() => onSetAccess(p.id, r.id, true)} className="rounded border px-1.5" style={{ borderColor: "var(--color-line)", color: a?.allowed === true ? "var(--color-gold)" : "var(--color-ink-dim)" }}>libera</button>
                        <button onClick={() => onSetAccess(p.id, r.id, false)} className="rounded border px-1.5" style={{ borderColor: "var(--color-line)", color: a?.allowed === false ? "var(--color-danger)" : "var(--color-ink-dim)" }}>nega</button>
                        {a && <button onClick={() => onClearAccess(p.id, r.id)} className="rounded border px-1.5" style={dim}>padrão</button>}
                      </div>
                    </div>
                  );
                })}
                {!rooms.length && <p style={dim}>Cadastre cômodos em Casa para definir acesso por lugar.</p>}
              </div>
            </div>
          )}

          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[11px] font-medium">Consentimento biométrico</p>
              {!consenting && <button onClick={() => setConsenting(true)} className="text-[11px] underline" style={gold}>registrar consentimento</button>}
            </div>
            {consenting && (
              <ConsentForm
                person={p}
                people={people}
                term={term}
                onCancel={() => setConsenting(false)}
                onSubmit={async (input) => {
                  const r = await fetch("/api/identity/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
                  const d = await r.json().catch(() => ({}));
                  if (!r.ok) return d.error ?? "Não foi possível registrar o consentimento";
                  setConsenting(false);
                  onSaved();
                  return null;
                }}
              />
            )}
            {p.consentimentos.length > 0 ? (
              <div className="mt-1 flex flex-col gap-1">
                {p.consentimentos.map((c) => (
                  <div key={c.id} className="flex items-center justify-between text-[11px]" style={c.revokedAt ? dim : undefined}>
                    <span>
                      {c.kinds.map((k) => KIND_LABEL[k as BiometricKind] ?? k).join(", ")} · {c.grantedBy === "responsavel" ? `responsável${c.guardianName ? ` (${c.guardianName})` : ""}` : "própria pessoa"} · {fmtDate(c.grantedAt)}
                      {c.revokedAt ? ` · revogado em ${fmtDate(c.revokedAt)}` : ""}
                    </span>
                    {!c.revokedAt && (
                      <button
                        onClick={async () => {
                          if (!window.confirm("Revogar este consentimento?")) return;
                          const r = await fetch(`/api/identity/consent?id=${c.id}`, { method: "DELETE" });
                          if (!r.ok) { const d = await r.json().catch(() => ({})); window.alert(d.error ?? "Não foi possível revogar"); return; }
                          onSaved();
                        }}
                        className="shrink-0 rounded border px-1.5"
                        style={danger}
                      >
                        revogar
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              !consenting && <p className="text-[11px]" style={dim}>Nenhum consentimento registrado ainda.</p>
            )}
          </div>

          <div>
            <p className="mb-1 text-[11px] font-medium">Quem pode perguntar sobre {p.name}</p>
            <p className="mb-1 text-[11px]" style={dim}>O dono sempre pode. Cada um pode perguntar sobre si mesmo. O responsável pode sobre quem ele cuida.</p>
            <div className="flex flex-col gap-1">
              {people.filter((v) => v.id !== p.id).map((viewer) => {
                const grant = viewer.podeVer.find((g) => g.subjectPersonId === p.id);
                const current = grant ? grant.allowed : null;
                return (
                  <div key={viewer.id} className="flex items-center justify-between text-[11px]">
                    <span>{viewer.name}</span>
                    <select
                      value={current === null ? "padrao" : current ? "pode" : "nao_pode"}
                      onChange={(e) => {
                        const v = e.target.value;
                        onSetVisibility(viewer.id, p.id, v === "padrao" ? null : v === "pode");
                      }}
                      className="rounded border px-1.5 py-0.5"
                      style={{ borderColor: "var(--color-line)", background: "transparent", color: "var(--color-ink)" }}
                    >
                      <option value="padrao">padrão</option>
                      <option value="pode">pode</option>
                      <option value="nao_pode">não pode</option>
                    </select>
                  </div>
                );
              })}
              {people.length <= 1 && <p style={dim}>Cadastre outra pessoa para configurar isto.</p>}
            </div>
          </div>

          <div>
            <button onClick={() => setAuditOpen((v) => !v)} className="text-[11px] underline" style={dim}>
              {auditOpen ? "▾" : "▸"} trilha de identidade
            </button>
            {auditOpen && <AuditTrail personId={p.id} />}
          </div>

          <div className="flex gap-2 border-t pt-2" style={{ borderColor: "var(--color-line)" }}>
            <Button size="sm" variant="outline" onClick={onEraseBiometrics}>apagar biometria</Button>
            <Button size="sm" variant="danger" onClick={onRemove}>remover pessoa</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AuditTrail({ personId }: { personId: string }) {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/identity/audit?personId=${personId}&limit=50`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => { if (alive) setRows(d.audit ?? []); })
      .catch(() => { if (alive) setErr("Não foi possível carregar a trilha."); });
    return () => { alive = false; };
  }, [personId]);

  if (err) return <p className="mt-1 text-[11px]" style={danger}>{err}</p>;
  if (!rows) return <p className="mt-1 text-[11px]" style={dim}>Carregando…</p>;
  if (!rows.length) return <p className="mt-1 text-[11px]" style={dim}>Sem eventos ainda.</p>;
  return (
    <div className="mt-1 flex flex-col gap-0.5 text-[11px]" style={dim}>
      {rows.map((a) => (
        <div key={a.id}>
          {fmtDate(a.createdAt)} · {a.action}{a.kind ? ` (${a.kind})` : ""}{a.outcome ? ` · ${a.outcome}` : ""}{a.source ? ` · ${a.source}` : ""}
          {a.confidence != null ? ` · ${Math.round(a.confidence * 100)}%` : ""}
        </div>
      ))}
    </div>
  );
}

interface PersonInput { name: string; role: Role; aliases: string[]; relation: Relation; isMinor: boolean; guardianPersonId: string | null; accountEmail: string | null }

function PersonForm({ people, initial, onSubmit, onCancel }: {
  people: PersonRow[]; initial?: PersonRow;
  onSubmit: (input: PersonInput) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [aliases, setAliases] = useState((initial?.aliases ?? []).join(", "));
  const [role, setRole] = useState<Role>(initial?.role ?? "morador");
  const [relation, setRelation] = useState<Relation>(initial?.relation ?? "morador");
  const [isMinor, setIsMinor] = useState(initial?.isMinor ?? false);
  const [guardianPersonId, setGuardianPersonId] = useState<string>(initial?.guardianPersonId ?? "");
  const [accountEmail, setAccountEmail] = useState(initial?.accountEmail ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const guardians = people.filter((p) => p.id !== initial?.id && !p.isMinor);

  async function submit() {
    if (!name.trim()) { setMsg("Nome é obrigatório"); return; }
    setBusy(true);
    setMsg(null);
    const e = await onSubmit({
      name: name.trim(),
      role,
      aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean),
      relation,
      isMinor,
      guardianPersonId: isMinor && guardianPersonId ? guardianPersonId : null,
      accountEmail: accountEmail.trim() ? accountEmail.trim() : null,
    });
    setBusy(false);
    if (e) setMsg(e);
  }

  return (
    <div className="flex flex-col gap-2 text-[12px]">
      <Input placeholder="nome" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
      <Input placeholder="apelidos, separados por vírgula" value={aliases} disabled={busy} onChange={(e) => setAliases(e.target.value)} />
      <div className="flex gap-2">
        <select value={role} disabled={busy} onChange={(e) => setRole(e.target.value as Role)} className="flex-1 rounded-lg border px-2 py-1" style={{ borderColor: "var(--color-line)", background: "transparent" }}>
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        <select value={relation} disabled={busy} onChange={(e) => setRelation(e.target.value as Relation)} className="flex-1 rounded-lg border px-2 py-1" style={{ borderColor: "var(--color-line)", background: "transparent" }}>
          {(Object.keys(RELATION_LABEL) as Relation[]).map((r) => <option key={r} value={r}>{RELATION_LABEL[r]}</option>)}
        </select>
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={isMinor} disabled={busy} onChange={(e) => setIsMinor(e.target.checked)} /> menor de idade
      </label>
      {isMinor && (
        <select value={guardianPersonId} disabled={busy} onChange={(e) => setGuardianPersonId(e.target.value)} className="rounded-lg border px-2 py-1" style={{ borderColor: "var(--color-line)", background: "transparent" }}>
          <option value="">responsável (escolha)</option>
          {guardians.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      )}
      <Input type="email" placeholder="e-mail da conta de login (opcional)" value={accountEmail} disabled={busy} onChange={(e) => setAccountEmail(e.target.value)} />
      {msg && <p className="text-[11px]" style={danger}>{msg}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => void submit()}>salvar</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>cancelar</Button>
      </div>
    </div>
  );
}

interface ConsentInput { personId: string; kinds: BiometricKind[]; grantedBy: GrantedBy; guardianPersonId: string | null; termVersion: string }

function ConsentForm({ person, people, term, onSubmit, onCancel }: {
  person: PersonRow; people: PersonRow[]; term: Term | null;
  onSubmit: (input: ConsentInput) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [voz, setVoz] = useState(false);
  const [rosto, setRosto] = useState(false);
  const [guardianPersonId, setGuardianPersonId] = useState(person.guardianPersonId ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const guardians = people.filter((p) => p.id !== person.id && !p.isMinor);

  async function submit() {
    if (!term) { setMsg("Termo indisponível no momento"); return; }
    if (!voz && !rosto) { setMsg("Marque ao menos um tipo (voz ou rosto)"); return; }
    if (person.isMinor && !guardianPersonId) { setMsg("Escolha o responsável que está consentindo"); return; }
    setBusy(true);
    setMsg(null);
    const kinds: BiometricKind[] = [...(voz ? (["voz"] as const) : []), ...(rosto ? (["rosto"] as const) : [])];
    const e = await onSubmit({
      personId: person.id,
      kinds,
      grantedBy: person.isMinor ? "responsavel" : "propria_pessoa",
      guardianPersonId: person.isMinor ? guardianPersonId : null,
      termVersion: term.version,
    });
    setBusy(false);
    if (e) setMsg(e);
  }

  return (
    <div className="mb-2 flex flex-col gap-2 rounded-lg border p-2 text-[12px]" style={{ borderColor: "var(--color-line)" }}>
      {!term ? (
        <p style={dim}>Termo de consentimento indisponível no momento.</p>
      ) : (
        <>
          <p className="text-[11px] font-medium">Termo de consentimento (versão {term.version})</p>
          <div className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded border p-2 text-[11px]" style={{ borderColor: "var(--color-line)", ...dim }}>{term.text}</div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={voz} disabled={busy} onChange={(e) => setVoz(e.target.checked)} /> voz</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={rosto} disabled={busy} onChange={(e) => setRosto(e.target.checked)} /> rosto</label>
          {person.isMinor ? (
            <>
              <p className="text-[11px]" style={dim}>{person.name} é menor: o consentimento só vale se vier do responsável.</p>
              <select value={guardianPersonId} disabled={busy} onChange={(e) => setGuardianPersonId(e.target.value)} className="rounded-lg border px-2 py-1" style={{ borderColor: "var(--color-line)", background: "transparent" }}>
                <option value="">responsável (escolha)</option>
                {guardians.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </>
          ) : (
            <p className="text-[11px]" style={dim}>{person.name} consente por si mesma.</p>
          )}
          {msg && <p className="text-[11px]" style={danger}>{msg}</p>}
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void submit()}>aceitar e registrar</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>cancelar</Button>
          </div>
        </>
      )}
    </div>
  );
}
