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
  const [sName, setSName] = useState(""); const [sInstr, setSInstr] = useState(""); const [sKw, setSKw] = useState("");
  const [mName, setMName] = useState(""); const [mUrl, setMUrl] = useState("");

  // template estruturado (padrão Adalink) — ajuda a escrever skills melhores
  const SKILL_TEMPLATE = "## Quando usar\n(situações em que esta skill deve agir)\n\n## Quando NÃO usar\n(delegue a outra skill ou responda normal)\n\n## Princípios\n- \n\n## Como responder\n- ";

  function load() {
    fetch("/api/skills").then((r) => r.json()).then((d) => setSkills(d.skills ?? [])).catch(() => {});
    fetch("/api/mcp").then((r) => r.json()).then((d) => setMcps(d.servers ?? [])).catch(() => {});
  }
  useEffect(load, []);

  async function addSkill() {
    if (!sName.trim() || !sInstr.trim()) return;
    await fetch("/api/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: sName, instructions: sInstr, keywords: sKw || undefined }) });
    setSName(""); setSInstr(""); setSKw(""); load();
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
                  <button onClick={() => remove("skills", s.id)} style={{ color: "var(--color-danger)" }}>×</button>
                </div>
              ))}
              <input value={sName} onChange={(e) => setSName(e.target.value)} placeholder="Nome da skill (ex: Modo dev)" className="rounded-lg border px-2 py-1 text-xs outline-none" style={input} />
              <input value={sKw} onChange={(e) => setSKw(e.target.value)} placeholder="Palavras-chave p/ ativar (ex: código, bug, deploy)" className="rounded-lg border px-2 py-1 text-xs outline-none" style={input} />
              <div className="flex items-center gap-1">
                <span className="text-[9px]" style={{ color: "var(--color-ink-dim)" }}>Instruções</span>
                <button onClick={() => setSInstr(SKILL_TEMPLATE)} className="text-[9px]" style={{ color: "var(--color-gold)" }}>usar template</button>
              </div>
              <textarea value={sInstr} onChange={(e) => setSInstr(e.target.value)} placeholder="Como a Órbita deve agir. Dica: use o template (Quando usar / Quando NÃO usar / Princípios)." rows={3} className="rounded-lg border px-2 py-1 text-xs outline-none" style={input} />
              <button onClick={addSkill} className="rounded-lg px-3 py-1 text-xs font-semibold" style={{ background: "linear-gradient(120deg, var(--color-amber), var(--color-gold))", color: "#241403" }}>+ skill</button>
            </>
          ) : (
            <>
              {mcps.map((m) => (
                <div key={m.id} className="flex items-center gap-1.5 text-[11px]">
                  <button onClick={() => toggle("mcp", m.id, !m.enabled)}>{m.enabled ? "🟢" : "⚪"}</button>
                  <span className="flex-1 truncate" style={{ color: "var(--color-ink)" }} title={m.url}>{m.name}</span>
                  <button onClick={() => remove("mcp", m.id)} style={{ color: "var(--color-danger)" }}>×</button>
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
