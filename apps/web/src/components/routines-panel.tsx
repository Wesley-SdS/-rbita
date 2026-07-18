"use client";

import { useEffect, useState } from "react";

interface Notif { id: string; title: string; content: string; read: boolean }
interface Routine { id: string; title: string; intervalMinutes: number }

export function RoutinesPanel() {
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [interval, setIntervalMin] = useState(1440);
  const [busy, setBusy] = useState(false);

  function loadNotifs() {
    fetch("/api/notifications").then((r) => r.json()).then((d) => { setNotifs(d.notifications ?? []); setUnread(d.unread ?? 0); }).catch(() => {});
  }
  function loadRoutines() {
    fetch("/api/routines").then((r) => r.json()).then((d) => setRoutines(d.routines ?? [])).catch(() => {});
  }

  useEffect(() => {
    loadNotifs();
    loadRoutines();
    const poll = setInterval(loadNotifs, 30000);
    // agendador cliente: roda rotinas devidas a cada 5 min enquanto o app está aberto
    const sched = setInterval(() => {
      fetch("/api/routines/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then(loadNotifs).catch(() => {});
    }, 5 * 60 * 1000);
    return () => { clearInterval(poll); clearInterval(sched); };
  }, []);

  async function createRoutine() {
    if (!title.trim() || !prompt.trim() || busy) return;
    setBusy(true);
    try {
      await fetch("/api/routines", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, prompt, intervalMinutes: interval }) });
      setTitle(""); setPrompt(""); loadRoutines();
    } finally { setBusy(false); }
  }
  async function runNow() {
    setBusy(true);
    try {
      await fetch("/api/routines/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: true }) });
      loadNotifs();
    } finally { setBusy(false); }
  }
  async function markRead(id: string) {
    await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    loadNotifs();
  }
  async function deleteRoutine(id: string) {
    await fetch(`/api/routines?id=${id}`, { method: "DELETE" });
    loadRoutines();
  }

  const input = { borderColor: "var(--color-line)", background: "var(--color-ground)", color: "var(--color-ink)" };

  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center">
        <h3 className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-dim)" }}>Proatividade</h3>
        {unread > 0 && (
          <span className="ml-2 rounded-full px-1.5 text-[10px] font-bold" style={{ background: "var(--color-gold)", color: "#241403" }}>{unread}</span>
        )}
        <span className="ml-auto text-xs" style={{ color: "var(--color-ink-dim)" }}>{open ? "▾" : "▸"}</span>
      </button>

      {/* avisos recentes */}
      <div className="mt-2 flex flex-col gap-1">
        {notifs.slice(0, open ? 6 : 2).map((n) => (
          <button key={n.id} onClick={() => markRead(n.id)} className="rounded-lg border p-2 text-left text-[11px]"
            style={{ borderColor: n.read ? "var(--color-line)" : "color-mix(in oklab, var(--color-gold) 40%, var(--color-line))", color: "var(--color-ink-dim)", opacity: n.read ? 0.6 : 1 }}>
            <div className="font-semibold" style={{ color: n.read ? "var(--color-ink-dim)" : "var(--color-gold)" }}>{n.title}</div>
            <div className="line-clamp-2">{n.content}</div>
          </button>
        ))}
        {notifs.length === 0 && <span className="text-[10px]" style={{ color: "var(--color-ink-dim)" }}>sem avisos ainda</span>}
      </div>

      {open && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="font-mono text-[9px] uppercase tracking-wider" style={{ color: "var(--color-ink-dim)" }}>Nova rotina</div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título (ex: Briefing matinal)" className="rounded-lg border px-2 py-1.5 text-xs outline-none" style={input} />
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="O que a Órbita deve fazer? (ex: pesquise 3 notícias de IA)" rows={2} className="rounded-lg border px-2 py-1.5 text-xs outline-none" style={input} />
          <div className="flex items-center gap-2">
            <select value={interval} onChange={(e) => setIntervalMin(Number(e.target.value))} className="rounded-lg border px-2 py-1.5 text-xs" style={input}>
              <option value={60}>a cada hora</option>
              <option value={720}>2x/dia</option>
              <option value={1440}>diário</option>
            </select>
            <button onClick={createRoutine} disabled={busy} className="flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50" style={{ background: "linear-gradient(120deg, var(--color-amber), var(--color-gold))", color: "#241403" }}>Criar</button>
          </div>

          {routines.length > 0 && (
            <div className="mt-1 flex flex-col gap-1">
              {routines.map((r) => (
                <div key={r.id} className="flex items-center gap-1 text-[11px]" style={{ color: "var(--color-ink-dim)" }}>
                  <span className="flex-1 truncate">• {r.title}</span>
                  <button onClick={() => deleteRoutine(r.id)} style={{ color: "#e0705a" }}>×</button>
                </div>
              ))}
              <button onClick={runNow} disabled={busy} className="mt-1 rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50" style={{ borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}>
                {busy ? "…" : "▶ rodar agora"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
