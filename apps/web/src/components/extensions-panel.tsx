"use client";

import { useState } from "react";
import { invalidar, useRecursos } from "@/lib/dados/recurso";
import { Icone } from "@/components/presenca/icones";
import { Card, Input, Textarea, Button } from "@/components/ui";

interface Skill { id: string; name: string; instructions: string; enabled: boolean }
interface Mcp { id: string; name: string; url: string; enabled: boolean; risk: string }

/** Extensões: skills (comportamentos) + servidores MCP (ferramentas externas). */
export function ExtensionsPanel() {
  const [tab, setTab] = useState<"skills" | "mcp">("skills");
  // As duas listas mudam pouco e a tela Conexões volta a elas o tempo todo.
  const { dados } = useRecursos<{ skillsResp: { skills: Skill[] }; mcpResp: { servers: Mcp[] } }>(
    { skillsResp: "/api/skills", mcpResp: "/api/mcp" },
    { estavel: true },
  );
  const skills = dados.skillsResp?.skills ?? [];
  const mcps = dados.mcpResp?.servers ?? [];
  const [sName, setSName] = useState(""); const [sInstr, setSInstr] = useState(""); const [sKw, setSKw] = useState("");
  const [mName, setMName] = useState(""); const [mUrl, setMUrl] = useState("");

  // template estruturado (padrão Adalink) — ajuda a escrever skills melhores
  const SKILL_TEMPLATE = "## Quando usar\n(situações em que esta skill deve agir)\n\n## Quando NÃO usar\n(delegue a outra skill ou responda normal)\n\n## Princípios\n- \n\n## Como responder\n- ";

  const load = () => invalidar("/api/skills", "/api/mcp");

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

  return (
    <Card>
      <div className="section-heading">
        <h2>Extensões</h2>
        {(skills.filter((s) => s.enabled).length + mcps.filter((m) => m.enabled).length) > 0 && (
          <span className="tag green">
            {skills.filter((s) => s.enabled).length + mcps.filter((m) => m.enabled).length} ativa(s)
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-col gap-2">
        <div className="flex gap-1 text-[13px]">
          {(["skills", "mcp"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className="filter-chip"
              style={{ background: tab === t ? "var(--color-gold)" : "transparent", color: tab === t ? "var(--color-accent-ink)" : "var(--color-ink-dim)", border: "1px solid var(--color-line)" }}>
              {t === "skills" ? "Skills" : "MCP"}
            </button>
          ))}
        </div>

        {tab === "skills" ? (
          <>
            {skills.map((s) => (
              <div key={s.id} className="flex items-center gap-1.5 text-[14px]">
                <button className="switch" role="switch" aria-checked={s.enabled} aria-label={`Ativar ${s.id}`} onClick={() => toggle("skills", s.id, !s.enabled)} />
                <span className="flex-1 truncate" style={{ color: "var(--color-ink)" }} title={s.instructions}>{s.name}</span>
                <button className="icon-button" onClick={() => remove("skills", s.id)} aria-label="Remover habilidade" title="Remover"><Icone nome="trash" /></button>
              </div>
            ))}
            <Input value={sName} onChange={(e) => setSName(e.target.value)} placeholder="Nome da skill (ex: Modo dev)" />
            <Input value={sKw} onChange={(e) => setSKw(e.target.value)} placeholder="Palavras-chave p/ ativar (ex: código, bug, deploy)" />
            <div className="flex items-center gap-1">
              <span className="text-[12px]" style={{ color: "var(--color-ink-dim)" }}>Instruções</span>
              <button onClick={() => setSInstr(SKILL_TEMPLATE)} className="text-[12px]" style={{ color: "var(--color-gold)" }}>usar template</button>
            </div>
            <Textarea size="sm" value={sInstr} onChange={(e) => setSInstr(e.target.value)} placeholder="Como a Órbita deve agir. Dica: use o template (Quando usar / Quando NÃO usar / Princípios)." rows={3} />
            <Button variant="primary" size="md" onClick={addSkill}>+ skill</Button>
          </>
        ) : (
          <>
            {mcps.map((m) => (
              <div key={m.id} className="flex items-center gap-1.5 text-[14px]">
                <button className="switch" role="switch" aria-checked={m.enabled} aria-label={`Ativar ${m.id}`} onClick={() => toggle("mcp", m.id, !m.enabled)} />
                <span className="flex-1 truncate" style={{ color: "var(--color-ink)" }} title={m.url}>{m.name}</span>
                {/* risco das tools do servidor: "leitura" executa direto; o resto passa pela aprovação */}
                <select value={m.risk ?? "efeito_externo"} title="Risco das ferramentas deste servidor"
                  onChange={async (e) => { await fetch("/api/mcp", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: m.id, risk: e.target.value }) }); load(); }}
                  className="rounded-md border px-1 py-0.5 text-[13px]" style={{ borderColor: "var(--color-line)", background: "transparent", color: m.risk === "leitura" ? "inherit" : "var(--color-gold)" }}>
                  <option value="leitura">somente leitura</option>
                  <option value="efeito_externo">com efeito (aprova)</option>
                  <option value="perigoso">perigoso (aprova)</option>
                </select>
                <button className="icon-button" onClick={() => remove("mcp", m.id)} aria-label="Remover servidor" title="Remover"><Icone nome="trash" /></button>
              </div>
            ))}
            <Input value={mName} onChange={(e) => setMName(e.target.value)} placeholder="Nome (ex: GitHub)" />
            <Input value={mUrl} onChange={(e) => setMUrl(e.target.value)} placeholder="URL do servidor MCP (HTTP streamable)" />
            <Button variant="primary" size="md" onClick={addMcp}>+ servidor MCP</Button>
            <p className="text-[12px]" style={{ color: "var(--color-ink-dim)" }}>As ferramentas do MCP entram no chat automaticamente. Por padrão passam pela aprovação; marque "somente leitura" para executarem direto.</p>
          </>
        )}
      </div>
    </Card>
  );
}
