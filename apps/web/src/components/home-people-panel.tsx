"use client";

import { useEffect, useRef, useState } from "react";
import { Icone } from "@/components/presenca/icones";
import { Card, PanelTitle, Input, Button, ErrorRetry } from "@/components/ui";
import { identityLimits, LIMITES_PADRAO, type IdentityLimits } from "@/lib/identity-limits";
import { enfileirar, isJobTerminal, type JobView } from "@/lib/jobs";
import { JobProgress } from "@/components/job-progress";

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
interface VoiceInfo { modelo: string; percepcao: { ok: boolean }; porPessoa: Record<string, Record<string, number>> }
interface FaceInfo { backend: string; percepcao: { ok: boolean }; porPessoa: Record<string, Record<string, number>> }
type PresenceFreshness = "agora" | "recente" | "antigo";
interface PresenceRow {
  personId: string; name: string; roomId: string | null; roomName: string | null;
  source: string; confidence: number | null; seenAt: string; quando: PresenceFreshness;
}

// mesmo texto de leitura sugerida do bench de percepção (apps/perception/bench/bench.html):
// frase natural, com números por extenso, que dá ~45 s de fala normal (a
// duração real vem de identity.voiceEnrollRecordSeconds).
const LEITURA_SUGERIDA =
  "A Órbita organiza minha rotina, acompanha minhas reuniões e cuida da casa. Hoje de manhã revisei a agenda, " +
  "respondi os e-mails mais urgentes e combinei a entrega do relatório para sexta-feira. Depois do almoço, quero " +
  "conferir as contas do mês, ligar para o cliente sobre o contrato novo e lembrar de comprar pão, frutas e café. " +
  "À noite, se der tempo, vou ler um pouco, ouvir música e preparar a lista de tarefas de amanhã. Números também " +
  "contam: quinze, quarenta e dois, cento e oito, mil novecentos e noventa e nove.";

const REASON_LABEL: Record<string, string> = { fala_curta: "fala curta", sem_folga: "parecido com outra pessoa", abaixo_do_limiar: "confiança baixa" };

function formatIdentificacao(d: { outcome: string; name: string | null; score: number; reason: string | null }): string {
  if (d.outcome === "identificado") return `Identificado: ${d.name ?? "?"} (${Math.round(d.score * 100)}%)`;
  if (d.outcome === "provavel") return `Provavelmente ${d.name ?? "alguém"} (${REASON_LABEL[d.reason ?? ""] ?? "confiança baixa"})`;
  return "Voz não reconhecida";
}

function formatIdentificacaoRosto(d: { outcome: string; name: string | null; score: number }): string {
  if (d.outcome === "identificado") return `Identificado: ${d.name ?? "?"} (${Math.round(d.score * 100)}%)`;
  if (d.outcome === "provavel") return `Provavelmente ${d.name ?? "alguém"}`;
  if (d.outcome === "sem_rosto") return "Nenhum rosto na imagem";
  return "Rosto não reconhecido";
}

/** Grava do microfone por `seconds` segundos (ou até chamar `stop`) e devolve o blob webm. Sempre libera o microfone ao final. */
function useMicRecorder() {
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function release() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recRef.current = null;
  }

  useEffect(() => release, []); // libera o mic se o componente sumir com a gravação em curso

  /** Inicia a gravação; `onTick` recebe os segundos restantes; `onDone` recebe o blob final (ou null em erro). */
  async function start(seconds: number, onTick: (remaining: number) => void, onDone: (blob: Blob | null) => void) {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onDone(null);
      return;
    }
    streamRef.current = stream;
    const rec = new MediaRecorder(stream);
    chunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      const blob = chunksRef.current.length ? new Blob(chunksRef.current, { type: "audio/webm" }) : null;
      release();
      onDone(blob);
    };
    recRef.current = rec;
    rec.start();
    let remaining = seconds;
    onTick(remaining);
    timerRef.current = setInterval(() => {
      remaining -= 1;
      onTick(remaining);
      if (remaining <= 0) rec.stop();
    }, 1000);
  }

  function stop() { recRef.current?.stop(); }

  return { start, stop };
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}

/** Texto da idade do avistamento de presença: "agora", "visto há X min" ou "visto por último em <data>". */
function quandoLabel(p: PresenceRow): string {
  if (p.quando === "agora") return "agora";
  if (p.quando === "recente") {
    const min = Math.max(1, Math.round((Date.now() - new Date(p.seenAt).getTime()) / 60_000));
    return `visto há ${min} min`;
  }
  return `visto por último em ${fmtDate(p.seenAt)}`;
}

export function HomePeoplePanel() {
  const [people, setPeople] = useState<PersonRow[] | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [term, setTerm] = useState<Term | null>(null);
  const [voiceInfo, setVoiceInfo] = useState<VoiceInfo | null>(null);
  const [faceInfo, setFaceInfo] = useState<FaceInfo | null>(null);
  const [presenca, setPresenca] = useState<PresenceRow[] | null>(null);
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
      fetch("/api/identity/voice").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/identity/face").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/identity/presence").then((r) => (r.ok ? r.json() : { presenca: [] })).catch(() => ({ presenca: [] })),
    ])
      .then(async ([p, r, t, v, f, pr]) => {
        if (!alive) return;
        setPeople(p.people ?? []);
        setRooms(r.rooms ?? []);
        setTerm(t.termo ?? null);
        setVoiceInfo(v ?? null);
        setFaceInfo(f ?? null);
        setPresenca(pr.presenca ?? []);
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
      <p className="mb-3 text-[15px]" style={dim}>
        Quem mora ou visita, em quais cômodos poderá agir e se consentiu com biometria de voz e
        rosto. Biometria fica só nos computadores desta casa.
      </p>
      <PresenceBlock presenca={presenca} onRefresh={refresh} />
      {!people ? (
        <p className="text-[15px]" style={dim}>Carregando…</p>
      ) : (
        <div className="flex flex-col gap-2 text-[15px]">
          {people.map((p) => (
            <PersonCard
              key={p.id}
              person={p}
              people={people}
              rooms={rooms}
              term={term}
              voiceInfo={voiceInfo}
              faceInfo={faceInfo}
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

          {people.length > 0 && (
            <>
              <VoiceTools voiceInfo={voiceInfo} onRecalculated={refresh} />
              <FaceTools faceInfo={faceInfo} onRecalculated={refresh} />
            </>
          )}

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

/** Bloco "Quem está em casa", no topo do painel: presença por câmera com identificação ligada. */
function PresenceBlock({ presenca, onRefresh }: { presenca: PresenceRow[] | null; onRefresh: () => void }) {
  return (
    <div className="mb-3 rounded-lg border p-2" style={{ borderColor: "var(--color-line)" }}>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[14px] font-medium">Quem está em casa</p>
        <button onClick={onRefresh} className="text-[14px] underline" style={dim}>atualizar</button>
      </div>
      {!presenca ? (
        <p className="text-[14px]" style={dim}>Carregando…</p>
      ) : presenca.length === 0 ? (
        <p className="text-[14px]" style={dim}>
          A presença aparece aqui quando uma câmera com identificação ligada reconhecer alguém.
        </p>
      ) : (
        <div className="flex flex-col gap-0.5 text-[14px]">
          {presenca.map((p) => (
            <div key={p.personId} className="flex items-center justify-between gap-2">
              <span>
                {p.name} · {p.roomName ?? "cômodo não definido"}
                {p.confidence !== null && p.confidence !== undefined && <span style={dim}> · {Math.round(p.confidence * 100)}%</span>}
              </span>
              <span style={p.quando === "agora" ? gold : dim}>{quandoLabel(p)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PersonCard({ person, people, rooms, term, voiceInfo, faceInfo, expanded, onToggle, onSaved, onRemove, onEraseBiometrics, onSetAccess, onClearAccess, onSetVisibility }: {
  person: PersonRow; people: PersonRow[]; rooms: Room[]; term: Term | null; voiceInfo: VoiceInfo | null; faceInfo: FaceInfo | null; expanded: boolean;
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
          <div className="text-[14px]" style={dim}>
            voz: {p.consentimento.voz ? <span style={gold}>consentido</span> : "sem consentimento"} · rosto: {p.consentimento.rosto ? <span style={gold}>consentido</span> : "sem consentimento"}
          </div>
        </button>
        <button className="icon-button" onClick={onRemove} aria-label="Remover pessoa" title="Remover pessoa"><Icone nome="trash" /></button>
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
            <button onClick={() => setEditing(true)} className="self-start text-[14px] underline" style={dim}>editar cadastro</button>
          )}

          {p.role !== "dono" && (
            <div>
              <p className="mb-1 text-[14px] font-medium">Acesso por cômodo</p>
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
              <p className="text-[14px] font-medium">Consentimento biométrico</p>
              {!consenting && <button onClick={() => setConsenting(true)} className="text-[14px] underline" style={gold}>registrar consentimento</button>}
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
                  <div key={c.id} className="flex items-center justify-between text-[14px]" style={c.revokedAt ? dim : undefined}>
                    <span>
                      {c.kinds.map((k) => KIND_LABEL[k as BiometricKind] ?? k).join(", ")} · {c.grantedBy === "responsavel" ? `responsável${c.guardianName ? ` (${c.guardianName})` : ""}` : "própria pessoa"} · {fmtDate(c.grantedAt)}
                      {c.revokedAt ? ` · revogado em ${fmtDate(c.revokedAt)}` : ""}
                    </span>
                    {!c.revokedAt && (
                      <button
                        onClick={async () => {
                          if (!window.confirm("Revogar este consentimento? A Órbita para de cadastrar nova biometria desta pessoa, mas o que já foi cadastrado só some em Apagar biometria.")) return;
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
              !consenting && <p className="text-[14px]" style={dim}>Nenhum consentimento registrado ainda.</p>
            )}
          </div>

          <VoiceSection person={p} voiceInfo={voiceInfo} onEnrolled={onSaved} />

          <FaceSection person={p} faceInfo={faceInfo} onEnrolled={onSaved} />

          <div>
            <p className="mb-1 text-[14px] font-medium">Quem pode perguntar sobre {p.name}</p>
            <p className="mb-1 text-[14px]" style={dim}>O dono sempre pode. Cada um pode perguntar sobre si mesmo. O responsável pode sobre quem ele cuida.</p>
            <div className="flex flex-col gap-1">
              {people.filter((v) => v.id !== p.id).map((viewer) => {
                const grant = viewer.podeVer.find((g) => g.subjectPersonId === p.id);
                const current = grant ? grant.allowed : null;
                return (
                  <div key={viewer.id} className="flex items-center justify-between text-[14px]">
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
            <button onClick={() => setAuditOpen((v) => !v)} className="text-[14px] underline" style={dim}>
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

// o que faz o reconhecimento errar, dito onde o cadastro acontece (§7: a tela
// mostra os limites em vez de deixar o dono descobrir errando)
const DICAS_ROSTO = "Rosto de frente, bem iluminado e sem óculos escuros. Contraluz (janela atrás), rosto de lado ou foto de longe costumam virar \"não reconheci\". Irmãos e parentes parecidos podem ser confundidos: cadastre os dois e confira na trilha.";
const DICAS_VOZ = "Fale em ritmo normal, num ambiente sem música nem TV. Áudio muito comprimido (chamada de vídeo, por exemplo) piora o reconhecimento, e gravação curta sai no máximo como \"provavelmente\".";

/** Seção "Voz" da pessoa expandida: quantas amostras tem do modelo atual e o botão de gravar mais uma. */
function VoiceSection({ person, voiceInfo, onEnrolled }: { person: PersonRow; voiceInfo: VoiceInfo | null; onEnrolled: () => void }) {
  const { start, stop } = useMicRecorder();
  // quanto gravar é config do dono: com o número fixo aqui, subir a fala mínima
  // na tela de Ajustes faria todo cadastro ser recusado sem explicação
  const [limites, setLimites] = useState<IdentityLimits>(LIMITES_PADRAO);
  useEffect(() => { let alive = true; identityLimits().then((l) => { if (alive) setLimites(l); }); return () => { alive = false; }; }, []);
  const [recording, setRecording] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const consentiu = person.consentimento.voz;
  const modelo = voiceInfo?.modelo ?? null;
  const amostras = modelo ? voiceInfo?.porPessoa[person.id]?.[modelo] ?? 0 : 0;
  const percepcaoOk = voiceInfo?.percepcao.ok ?? false;

  async function record() {
    setMsg(null);
    setOk(null);
    setRecording(true);
    await start(limites.cadastroVozSegundos, setRemaining, async (blob) => {
      setRecording(false);
      if (!blob) { setMsg("Sem acesso ao microfone."); return; }
      setBusy(true);
      try {
        const fd = new FormData();
        fd.append("personId", person.id);
        fd.append("file", blob, "amostra.webm");
        const r = await fetch("/api/identity/voice?acao=cadastrar", { method: "POST", body: fd });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) setMsg(d.error ?? "Não foi possível cadastrar a amostra.");
        else { setOk(`Amostra cadastrada (${d.speechS?.toFixed?.(1) ?? "?"} s de fala).`); onEnrolled(); }
      } catch {
        setMsg("Falha ao enviar a amostra.");
      } finally {
        setBusy(false);
      }
    });
  }

  return (
    <div>
      <p className="mb-1 text-[14px] font-medium">Voz</p>
      <p className="mb-1 text-[14px]" style={dim}>
        {modelo ? `${amostras} amostra${amostras === 1 ? "" : "s"} do modelo atual` : "Sem informação do modelo"}
        {" · "}serviço local {percepcaoOk ? <span style={gold}>no ar</span> : <span style={danger}>fora do ar</span>}
      </p>
      {!consentiu ? (
        <p className="text-[14px]" style={dim}>Registre o consentimento de voz de {person.name} para poder gravar amostras.</p>
      ) : recording ? (
        <div className="flex flex-col gap-1">
          <p className="text-[14px]" style={gold}>gravando… {remaining}s restantes</p>
          <p className="max-h-16 overflow-y-auto text-[14px]" style={dim}>Leia em voz alta: “{LEITURA_SUGERIDA}”</p>
          <Button size="sm" variant="outline" onClick={stop}>parar agora</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <Button size="sm" variant="outline" disabled={busy || !percepcaoOk} onClick={() => void record()}>
            {busy ? "enviando…" : `Gravar amostra de voz (${limites.cadastroVozSegundos} s)`}
          </Button>
          <p className="text-[13px]" style={dim}>{DICAS_VOZ}</p>
        </div>
      )}
      {msg && <p className="mt-1 text-[14px]" style={danger}>{msg}</p>}
      {ok && <p className="mt-1 text-[14px]" style={gold}>{ok}</p>}
    </div>
  );
}

/** Ferramentas de voz do painel: testar reconhecimento e recalcular assinaturas após trocar o modelo. */
function VoiceTools({ voiceInfo, onRecalculated }: { voiceInfo: VoiceInfo | null; onRecalculated: () => void }) {
  const { start, stop } = useMicRecorder();
  const [limites, setLimites] = useState<IdentityLimits>(LIMITES_PADRAO);
  useEffect(() => { let alive = true; identityLimits().then((l) => { if (alive) setLimites(l); }); return () => { alive = false; }; }, []);
  const [recording, setRecording] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [recalcJob, setRecalcJob] = useState<JobView | null>(null);
  const [recalcMsg, setRecalcMsg] = useState<string | null>(null);

  async function testar() {
    setResult(null);
    setRecording(true);
    await start(limites.testeVozSegundos, setRemaining, async (blob) => {
      setRecording(false);
      if (!blob) { setResult("Sem acesso ao microfone."); return; }
      setBusy(true);
      try {
        const fd = new FormData();
        fd.append("file", blob, "teste.webm");
        const r = await fetch("/api/identity/voice?acao=identificar", { method: "POST", body: fd });
        const d = await r.json().catch(() => ({}));
        setResult(r.ok ? formatIdentificacao(d) : (d.error ?? "Não foi possível identificar."));
      } catch {
        setResult("Falha ao testar o reconhecimento.");
      } finally {
        setBusy(false);
      }
    });
  }

  // recalcular vira trabalho de fila (N chamadas ao serviço local, 0,3 a
  // 8,6 s cada, não cabe numa requisição): enfileira e acompanha pelo JobProgress
  async function recalcular() {
    setRecalcMsg(null);
    try {
      const r = await fetch("/api/identity/voice?acao=recalcular", { method: "POST" });
      setRecalcJob(await enfileirar(r));
    } catch (e) {
      setRecalcMsg(e instanceof Error ? e.message : "Falha ao recalcular.");
    }
  }

  function onRecalcChange(j: JobView) {
    setRecalcJob(j);
    if (j.status !== "feito") return;
    const d = j.resultado as { modelo: string; recalculadas: number; semAudio: number; falharam: number } | null;
    if (!d) return;
    setRecalcMsg(
      `${d.recalculadas} assinatura${d.recalculadas === 1 ? "" : "s"} recalculada${d.recalculadas === 1 ? "" : "s"} no modelo ${d.modelo}` +
        `${d.semAudio ? `, ${d.semAudio} sem áudio guardado` : ""}${d.falharam ? `, ${d.falharam} falharam` : ""}.`,
    );
    onRecalculated();
  }

  return (
    <div className="flex flex-col gap-1 rounded-lg border p-2" style={{ borderColor: "var(--color-line)" }}>
      <p className="text-[14px] font-medium">Reconhecimento por voz</p>
      {recording ? (
        <div className="flex items-center gap-2 text-[14px]" style={gold}>
          <span>gravando… {remaining}s</span>
          <button onClick={stop} className="underline" style={dim}>parar agora</button>
        </div>
      ) : (
        <Button size="sm" variant="outline" disabled={busy || !(voiceInfo?.percepcao.ok ?? false)} onClick={() => void testar()}>
          {busy ? "identificando…" : `Testar reconhecimento (${limites.testeVozSegundos} s)`}
        </Button>
      )}
      {result && <p className="text-[14px]" style={dim}>{result}</p>}
      <button
        onClick={() => void recalcular()}
        disabled={recalcJob !== null && !isJobTerminal(recalcJob.status)}
        className="mt-1 self-start text-[14px] underline disabled:opacity-50"
        style={dim}
      >
        Recalcular assinaturas
      </button>
      {recalcJob && <JobProgress job={recalcJob} onChange={onRecalcChange} compact />}
      {recalcMsg && <p className="text-[14px]" style={dim}>{recalcMsg}</p>}
    </div>
  );
}

/**
 * Câmera embutida para tirar uma foto: mostra o vídeo ao vivo, captura um
 * quadro para canvas e devolve o blob JPEG só depois de confirmado. Libera a
 * câmera (track.stop()) ao confirmar, cancelar ou desmontar, sempre.
 */
function FacePhotoCapture({ onCaptured, onCancel }: { onCaptured: (blob: Blob) => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);

  function releaseCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  useEffect(() => {
    let alive = true;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user" } })
      .then((stream) => {
        if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => undefined);
        }
        setReady(true);
      })
      .catch(() => { if (alive) setErr("Sem acesso à câmera."); });
    return () => {
      alive = false;
      releaseCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  function shoot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => { if (blob) setPreview({ blob, url: URL.createObjectURL(blob) }); }, "image/jpeg", 0.9);
  }

  function retake() {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  function confirm() {
    if (!preview) return;
    releaseCamera();
    onCaptured(preview.blob);
  }

  function cancel() {
    releaseCamera();
    if (preview) URL.revokeObjectURL(preview.url);
    onCancel();
  }

  return (
    <div className="flex flex-col gap-1 rounded-lg border p-2" style={{ borderColor: "var(--color-line)" }}>
      {err && <p className="text-[14px]" style={danger}>{err}</p>}
      {preview ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview.url} alt="Prévia da foto" className="max-h-40 rounded" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={confirm}>usar esta foto</Button>
            <Button size="sm" variant="outline" onClick={retake}>tirar de novo</Button>
            <Button size="sm" variant="outline" onClick={cancel}>cancelar</Button>
          </div>
        </>
      ) : (
        <>
          <video ref={videoRef} muted playsInline className="max-h-40 rounded" style={{ background: "#000" }} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!ready} onClick={shoot}>tirar foto</Button>
            <Button size="sm" variant="outline" onClick={cancel}>cancelar</Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Seção "Rosto" da pessoa expandida: quantas fotos tem do backend atual e como cadastrar mais uma. */
function FaceSection({ person, faceInfo, onEnrolled }: { person: PersonRow; faceInfo: FaceInfo | null; onEnrolled: () => void }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const consentiu = person.consentimento.rosto;
  const backend = faceInfo?.backend ?? null;
  const fotos = backend ? faceInfo?.porPessoa[person.id]?.[backend] ?? 0 : 0;
  const percepcaoOk = faceInfo?.percepcao.ok ?? false;

  async function enviar(file: Blob, filename: string) {
    setMsg(null);
    setOk(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("personId", person.id);
      fd.append("file", file, filename);
      const r = await fetch("/api/identity/face?acao=cadastrar", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setMsg(d.error ?? "Não foi possível cadastrar a foto.");
      else { setOk(`Foto cadastrada (rosto de ${d.faceSize ?? "?"} px).`); onEnrolled(); }
    } catch {
      setMsg("Falha ao enviar a foto.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="mb-1 text-[14px] font-medium">Rosto</p>
      <p className="mb-1 text-[14px]" style={dim}>
        {backend ? `${fotos} foto${fotos === 1 ? "" : "s"} do modelo atual` : "Sem informação do modelo"}
        {" · "}serviço local {percepcaoOk ? <span style={gold}>no ar</span> : <span style={danger}>fora do ar</span>}
      </p>
      {!consentiu ? (
        <p className="text-[14px]" style={dim}>Registre o consentimento de rosto de {person.name} para poder cadastrar fotos.</p>
      ) : showCamera ? (
        <FacePhotoCapture
          onCaptured={(blob) => { setShowCamera(false); void enviar(blob, "foto.jpg"); }}
          onCancel={() => setShowCamera(false)}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void enviar(f, f.name);
            }}
          />
          <Button size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? "enviando…" : "Adicionar foto"}
          </Button>
          <Button size="sm" variant="outline" disabled={busy || !percepcaoOk} onClick={() => setShowCamera(true)}>
            Tirar foto pela webcam
          </Button>
          <p className="w-full text-[13px]" style={dim}>{DICAS_ROSTO}</p>
        </div>
      )}
      {msg && <p className="mt-1 text-[14px]" style={danger}>{msg}</p>}
      {ok && <p className="mt-1 text-[14px]" style={gold}>{ok}</p>}
    </div>
  );
}

/** Ferramentas de rosto do painel: testar reconhecimento (webcam ou arquivo) e recalcular assinaturas. */
function FaceTools({ faceInfo, onRecalculated }: { faceInfo: FaceInfo | null; onRecalculated: () => void }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [recalcJob, setRecalcJob] = useState<JobView | null>(null);
  const [recalcMsg, setRecalcMsg] = useState<string | null>(null);

  const percepcaoOk = faceInfo?.percepcao.ok ?? false;

  async function identificar(file: Blob, filename: string) {
    setResult(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file, filename);
      const r = await fetch("/api/identity/face?acao=identificar", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      setResult(r.ok ? formatIdentificacaoRosto(d) : (d.error ?? "Não foi possível identificar."));
    } catch {
      setResult("Falha ao testar o reconhecimento.");
    } finally {
      setBusy(false);
    }
  }

  // recalcular vira trabalho de fila (uma chamada ao serviço local por foto): enfileira e acompanha pelo JobProgress
  async function recalcular() {
    setRecalcMsg(null);
    try {
      const r = await fetch("/api/identity/face?acao=recalcular", { method: "POST" });
      setRecalcJob(await enfileirar(r));
    } catch (e) {
      setRecalcMsg(e instanceof Error ? e.message : "Falha ao recalcular.");
    }
  }

  function onRecalcChange(j: JobView) {
    setRecalcJob(j);
    if (j.status !== "feito") return;
    const d = j.resultado as { backend: string; recalculadas: number; semFoto: number; semRosto: number; falharam: number } | null;
    if (!d) return;
    // antes disto, semRosto e falharam sumiam calados (só semFoto virava texto)
    setRecalcMsg(
      `${d.recalculadas} assinatura${d.recalculadas === 1 ? "" : "s"} recalculada${d.recalculadas === 1 ? "" : "s"} no modelo ${d.backend}` +
        `${d.semFoto ? `, ${d.semFoto} sem foto guardada` : ""}${d.semRosto ? `, ${d.semRosto} sem rosto detectado na foto` : ""}${d.falharam ? `, ${d.falharam} falharam` : ""}.`,
    );
    onRecalculated();
  }

  return (
    <div className="flex flex-col gap-1 rounded-lg border p-2" style={{ borderColor: "var(--color-line)" }}>
      <p className="text-[14px] font-medium">Reconhecimento por rosto</p>
      {showCamera ? (
        <FacePhotoCapture
          onCaptured={(blob) => { setShowCamera(false); void identificar(blob, "teste.jpg"); }}
          onCancel={() => setShowCamera(false)}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void identificar(f, f.name);
            }}
          />
          <Button size="sm" variant="outline" disabled={busy || !percepcaoOk} onClick={() => setShowCamera(true)}>
            {busy ? "identificando…" : "Testar rosto (webcam)"}
          </Button>
          <Button size="sm" variant="outline" disabled={busy || !percepcaoOk} onClick={() => fileRef.current?.click()}>
            usar arquivo
          </Button>
        </div>
      )}
      {result && <p className="text-[14px]" style={dim}>{result}</p>}
      <button
        onClick={() => void recalcular()}
        disabled={recalcJob !== null && !isJobTerminal(recalcJob.status)}
        className="mt-1 self-start text-[14px] underline disabled:opacity-50"
        style={dim}
      >
        Recalcular assinaturas de rosto
      </button>
      {recalcJob && <JobProgress job={recalcJob} onChange={onRecalcChange} compact />}
      {recalcMsg && <p className="text-[14px]" style={dim}>{recalcMsg}</p>}
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

  if (err) return <p className="mt-1 text-[14px]" style={danger}>{err}</p>;
  if (!rows) return <p className="mt-1 text-[14px]" style={dim}>Carregando…</p>;
  if (!rows.length) return <p className="mt-1 text-[14px]" style={dim}>Sem eventos ainda.</p>;
  return (
    <div className="mt-1 flex flex-col gap-0.5 text-[14px]" style={dim}>
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
    <div className="flex flex-col gap-2 text-[15px]">
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
      {msg && <p className="text-[14px]" style={danger}>{msg}</p>}
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
    <div className="mb-2 flex flex-col gap-2 rounded-lg border p-2 text-[15px]" style={{ borderColor: "var(--color-line)" }}>
      {!term ? (
        <p style={dim}>Termo de consentimento indisponível no momento.</p>
      ) : (
        <>
          <p className="text-[14px] font-medium">Termo de consentimento (versão {term.version})</p>
          <div className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded border p-2 text-[14px]" style={{ borderColor: "var(--color-line)", ...dim }}>{term.text}</div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={voz} disabled={busy} onChange={(e) => setVoz(e.target.checked)} /> voz</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={rosto} disabled={busy} onChange={(e) => setRosto(e.target.checked)} /> rosto</label>
          {person.isMinor ? (
            <>
              <p className="text-[14px]" style={dim}>{person.name} é menor: o consentimento só vale se vier do responsável.</p>
              <select value={guardianPersonId} disabled={busy} onChange={(e) => setGuardianPersonId(e.target.value)} className="rounded-lg border px-2 py-1" style={{ borderColor: "var(--color-line)", background: "transparent" }}>
                <option value="">responsável (escolha)</option>
                {guardians.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </>
          ) : (
            <p className="text-[14px]" style={dim}>{person.name} consente por si mesma.</p>
          )}
          {msg && <p className="text-[14px]" style={danger}>{msg}</p>}
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void submit()}>aceitar e registrar</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>cancelar</Button>
          </div>
        </>
      )}
    </div>
  );
}
