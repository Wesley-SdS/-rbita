"use client";

import { useEffect, useState } from "react";
import { Card, PanelTitle, Input, Button } from "@/components/ui";

/**
 * Pessoas da casa e acesso por cômodo (B7.1). NÃO é multi-tenant: são pessoas
 * da MESMA casa, com permissão por pessoa e cômodo — a aplicação ainda não
 * tem um jeito de saber "quem está falando" (isso é da Onda 6), então isto é
 * o cadastro pronto para quando essa identidade existir.
 */
type Role = "dono" | "morador" | "visitante";
const ROLE_LABEL: Record<Role, string> = { dono: "dono (tudo liberado)", morador: "morador (liberado, salvo restrição)", visitante: "visitante (só onde liberar)" };
const dim = { color: "var(--color-ink-dim)" } as const;

interface Access { roomId: string; roomName: string; allowed: boolean }
interface PersonRow { id: string; name: string; role: Role; access: Access[] }
interface Room { id: string; name: string }

export function HomePeoplePanel() {
  const [people, setPeople] = useState<PersonRow[] | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("morador");
  const [reload, setReload] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/home/persons").then((r) => r.json()).then((d) => d.people ?? []),
      fetch("/api/home/rooms").then((r) => r.json()).then((d) => d.rooms ?? []),
    ]).then(([p, r]) => { setPeople(p); setRooms(r); }).catch(() => setPeople([]));
  }, [reload]);

  async function add() {
    if (!name.trim()) return;
    await fetch("/api/home/persons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, role }) });
    setName("");
    setReload((n) => n + 1);
  }
  async function remove(id: string) {
    await fetch(`/api/home/persons?id=${id}`, { method: "DELETE" });
    setReload((n) => n + 1);
  }
  async function setAccess(personId: string, roomId: string, allowed: boolean) {
    await fetch("/api/home/person-access", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personId, roomId, allowed }) });
    setReload((n) => n + 1);
  }
  async function clearAccess(personId: string, roomId: string) {
    await fetch(`/api/home/person-access?personId=${personId}&roomId=${roomId}`, { method: "DELETE" });
    setReload((n) => n + 1);
  }

  return (
    <Card>
      <PanelTitle className="mb-2">Pessoas da casa</PanelTitle>
      <p className="mb-3 text-[12px]" style={dim}>
        Quem mora ou visita, e em quais cômodos poderá agir. <strong style={{ color: "var(--color-danger)" }}>Isto ainda é só o
        cadastro: nenhuma ação da casa é bloqueada por esta permissão hoje</strong>, porque falta
        saber "quem está pedindo" (identidade de voz/dispositivo, Onda 6, ainda não resolvida). Não
        trate isto como controle parental funcional ainda.
      </p>
      {!people ? (
        <p className="text-[12px]" style={dim}>Carregando…</p>
      ) : (
        <div className="flex flex-col gap-2 text-[12px]">
          {people.map((p) => (
            <div key={p.id} className="rounded-lg border p-2" style={{ borderColor: "var(--color-line)" }}>
              <div className="flex items-center justify-between">
                <button onClick={() => setExpanded(expanded === p.id ? null : p.id)} className="text-left">
                  <strong>{p.name}</strong> <span style={dim}>· {ROLE_LABEL[p.role]}</span>
                </button>
                <button onClick={() => remove(p.id)} style={{ color: "var(--color-danger)" }}>×</button>
              </div>
              {expanded === p.id && p.role !== "dono" && (
                <div className="mt-2 flex flex-col gap-1">
                  {rooms.map((r) => {
                    const a = p.access.find((x) => x.roomId === r.id);
                    return (
                      <div key={r.id} className="flex items-center justify-between">
                        <span>{r.name}</span>
                        <div className="flex gap-1">
                          <button onClick={() => setAccess(p.id, r.id, true)} className="rounded border px-1.5" style={{ borderColor: "var(--color-line)", color: a?.allowed === true ? "var(--color-gold)" : "var(--color-ink-dim)" }}>libera</button>
                          <button onClick={() => setAccess(p.id, r.id, false)} className="rounded border px-1.5" style={{ borderColor: "var(--color-line)", color: a?.allowed === false ? "var(--color-danger)" : "var(--color-ink-dim)" }}>nega</button>
                          {a && <button onClick={() => clearAccess(p.id, r.id)} className="rounded border px-1.5" style={{ borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}>padrão</button>}
                        </div>
                      </div>
                    );
                  })}
                  {!rooms.length && <p style={dim}>Cadastre cômodos em Casa para definir acesso por lugar.</p>}
                </div>
              )}
            </div>
          ))}
          <div className="flex gap-2">
            <Input placeholder="nome" value={name} onChange={(e) => setName(e.target.value)} />
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="rounded-lg border px-2 py-1" style={{ borderColor: "var(--color-line)", background: "transparent" }}>
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <Button onClick={add} size="sm">+ pessoa</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
