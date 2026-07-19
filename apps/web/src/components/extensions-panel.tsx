"use client";

import { useEffect, useState } from "react";

interface Skill { id: string; name: string; instructions: string; enabled: boolean }
interface Mcp { id: string; name: string; url: string; enabled: boolean }

/** Extensões: skills (comportamentos) + servidores MCP (ferramentas externas). */
export function ExtensionsPanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"skills" | "mcp">("skills");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [mcps, setMcps] = useState<Mcp[]>([]);
  const [sName, setSName] = useState(""); const [sInstr, setSInstr] = useState("");
  const [mName, setMName] = useState(""); const [mUrl, setMUrl] = useState("");

  function load() {
    fetch("/api/skills").then((r) => r.json()).then((d) => setSkills(d.skills ?? [])).catch(() => {});
    fetch("/api/mcp").then((r) => r.json()).then((d) => setMcps(d.servers ?? [])).catch(() => {});
  }
  useEffect(load, []);

  async function addSkill() {
    if (!sName.trim() || !sInstr.trim()) return;
    await fetch("/api/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: sName, instructions: sInstr }) });
    setSName(""); setSInstr(""); load();
  }
  async function addMcp() {
    if (!mName.trim() || !mUrl.trim()) return;
    await fetch("/api/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: mName, url: mUrl }) });
    setMName(""); setMUrl(""); load();
  }
  const toggle = async (kind: "skills" | "mcp", id: string, enabled: boolean) => {
    await fetch(`/api/${kind}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, enabled }) });
    load();
  };
  const remove = async (kind: "skills" | "mcp", id: string) => { await fetch(`/api/${kind}?id=${id}`, { method: "DELETE" }); load(); };

  const input = { borderColor: "var(--color-line)", background: "var(--color-ground)", color: "var(--color-ink)" };

  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center">
        <h3 className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-dim)" }}>Extensões</h3>
        {(skills.filter((s) => s.enabled).length + mcps.filter((m) => m.enabled).length) > 0 && (
          <span className="ml-2 rounded-full px-1.5 text-[10px] font-bold" style={{ background: "var(--color-gold)", color: "#241403" }}>
            {skills.filter((s) => s.enabled).length + mcps.filter((m) => m.enabled).length}
          </span>
        )}
        <span className="ml-auto text-xs" style={{ color: "var(--color-ink-dim)" }}>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex gap-1 text-[10px]">
            {(["skills", "mcp"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className="rounded px-2 py-0.5 font-mono uppercase"
                style={{ background: tab === t ? "var(--color-gold)" : "transparent", color: tab === t ? "#241403" : "var(--color-ink-dim)", border: "1px solid var(--color-line)" }}>
                {t === "skills" ? "Skills" : "MCP"}
              </button>
            ))}
          </div>

          {tab === "skills" ? (
            <>
              {skills.map((s) => (
                <div key={s.id} className="flex items-center gap-1.5 text-[11px]">
                  <button onClick={() => toggle("skills", s.id, !s.enabled)}>{s.enabled ? "🟢" : "⚪"}</button>
                  <span className="flex-1 truncate" style={{ color: "var(--color-ink)" }} title={s.instructions}>{s.name}</span>
                  <button onClick={() => remove("skills", s.id)} style={{ color: "#e0705a" }}>×</button>
                </div>
              ))}
              <input value={sName} onChange={(e) => setSName(e.target.value)} placeholder="Nome da skill (ex: Modo dev)" className="rounded-lg border px-2 py-1 text-xs outline-none" style={input} />
              <textarea value={sInstr} onChange={(e) => setSInstr(e.target.value)} placeholder="Instruções (ex: responda sempre com código comentado)" rows={2} className="rounded-lg border px-2 py-1 text-xs outline-none" style={input} />
              <button onClick={addSkill} className="rounded-lg px-3 py-1 text-xs font-semibold" style={{ background: "linear-gradient(120deg, var(--color-amber), var(--color-gold))", color: "#241403" }}>+ skill</button>
            </>
          ) : (
            <>
              {mcps.map((m) => (
                <div key={m.id} className="flex items-center gap-1.5 text-[11px]">
                  <button onClick={() => toggle("mcp", m.id, !m.enabled)}>{m.enabled ? "🟢" : "⚪"}</button>
                  <span className="flex-1 truncate" style={{ color: "var(--color-ink)" }} title={m.url}>{m.name}</span>
                  <button onClick={() => remove("mcp", m.id)} style={{ color: "#e0705a" }}>×</button>
                </div>
              ))}
              <input value={mName} onChange={(e) => setMName(e.target.value)} placeholder="Nome (ex: GitHub)" className="rounded-lg border px-2 py-1 text-xs outline-none" style={input} />
              <input value={mUrl} onChange={(e) => setMUrl(e.target.value)} placeholder="URL do servidor MCP (HTTP streamable)" className="rounded-lg border px-2 py-1 text-xs outline-none" style={input} />
              <button onClick={addMcp} className="rounded-lg px-3 py-1 text-xs font-semibold" style={{ background: "linear-gradient(120deg, var(--color-amber), var(--color-gold))", color: "#241403" }}>+ servidor MCP</button>
              <p className="text-[9px]" style={{ color: "var(--color-ink-dim)" }}>As ferramentas do MCP ficam disponíveis no chat automaticamente.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
