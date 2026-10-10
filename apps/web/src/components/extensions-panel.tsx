"use client";

import { useState } from "react";
import { invalidar, useRecursos } from "@/lib/dados/recurso";
import { Icone } from "@/components/presenca/icones";
import { Card, Input, Textarea, Button } from "@/components/ui";

interface Skill { id: string; name: string; instructions: string; enabled: boolean }
interface Mcp {
  id: string; name: string; url: string; enabled: boolean; risk: string;
  toolsCatalog?: { name: string; description?: string; somenteLeitura?: boolean }[] | null;
  toolRisks?: Record<string, string> | null;
  /** só os NOMES dos cabeçalhos: o valor (o token) nunca volta do servidor */
  cabecalhos?: string[];
  lastError?: string | null;
}

const ROTULO_DO_RISCO: Record<string, string> = { leitura: "executa direto", efeito_externo: "pede aprovação", perigoso: "perigoso (só pela tela)" };

/** O mesmo cálculo de `riscoDaTool` (core/mcp/pool-rules.ts), só para a tela dizer o padrão. */
function riscoPadrao(m: Mcp, somenteLeitura?: boolean): string {
  if (m.risk === "perigoso" || m.risk === "leitura") return m.risk;
  return somenteLeitura ? "leitura" : "efeito_externo";
}

const patchMcp = (corpo: Record<string, unknown>) =>
  fetch("/api/mcp", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });

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
  const [mHNome, setMHNome] = useState("Authorization"); const [mHValor, setMHValor] = useState("");
  const [mErro, setMErro] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);
  const [novoValor, setNovoValor] = useState(""); const [novoNome, setNovoNome] = useState("Authorization");

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
    const headers = mHValor.trim() && mHNome.trim() ? { [mHNome.trim()]: mHValor.trim() } : undefined;
    const r = await fetch("/api/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: mName, url: mUrl, headers }) });
    if (!r.ok) { setMErro(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Não deu para adicionar."); return; }
    setMErro(""); setMName(""); setMUrl(""); setMHValor(""); load();
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
            {mcps.map((m) => {
              const catalogo = m.toolsCatalog ?? [];
              const diretas = catalogo.filter((t) => (m.toolRisks?.[t.name] ?? riscoPadrao(m, t.somenteLeitura)) === "leitura").length;
              return (
                <div key={m.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 text-[14px]">
                    <button className="switch" role="switch" aria-checked={m.enabled} aria-label={`Ativar ${m.id}`} onClick={() => toggle("mcp", m.id, !m.enabled)} />
                    <button className="flex-1 truncate text-left" style={{ color: "var(--color-ink)" }} title={m.url} onClick={() => setAberto(aberto === m.id ? null : m.id)}>
                      {m.name}
                      <span className="ml-1.5 text-[12px]" style={{ color: "var(--color-ink-dim)" }}>
                        {catalogo.length ? `${catalogo.length} ferramentas, ${diretas} direto` : "sem lista ainda"}
                      </span>
                    </button>
                    {/* risco do servidor inteiro; cada ferramenta pode ter o seu, no detalhe */}
                    <select value={m.risk === "escrita" ? "efeito_externo" : m.risk ?? "efeito_externo"} title="Risco padrão das ferramentas deste servidor"
                      onChange={async (e) => { await patchMcp({ id: m.id, risk: e.target.value }); load(); }}
                      className="rounded-md border px-1 py-0.5 text-[13px]" style={{ borderColor: "var(--color-line)", background: "transparent", color: m.risk === "leitura" ? "inherit" : "var(--color-gold)" }}>
                      <option value="efeito_externo">aprova o que altera</option>
                      <option value="leitura">tudo direto</option>
                      <option value="perigoso">tudo pela tela</option>
                    </select>
                    <button className="icon-button" onClick={() => remove("mcp", m.id)} aria-label="Remover servidor" title="Remover"><Icone nome="trash" /></button>
                  </div>
                  {m.lastError && <p className="text-[12px]" style={{ color: "var(--color-danger, #c0392b)" }}>Última falha: {m.lastError}</p>}
                  {aberto === m.id && (
                    <div className="ml-6 flex flex-col gap-1 text-[13px]">
                      <p style={{ color: "var(--color-ink-dim)" }}>
                        {m.cabecalhos?.length ? `Autenticação guardada (cifrada): ${m.cabecalhos.join(", ")}.` : "Sem cabeçalho de autenticação."}
                      </p>
                      <div className="flex gap-1">
                        <Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Cabeçalho" style={{ maxWidth: 150 }} />
                        <Input type="password" value={novoValor} onChange={(e) => setNovoValor(e.target.value)} placeholder="Novo valor (ex: Bearer ...)" />
                        <Button variant="outline" size="sm" onClick={async () => {
                          if (!novoNome.trim() || !novoValor.trim()) return;
                          await patchMcp({ id: m.id, headers: { [novoNome.trim()]: novoValor.trim() } });
                          setNovoValor(""); load();
                        }}>trocar</Button>
                      </div>
                      {catalogo.map((t) => {
                        const escolha = m.toolRisks?.[t.name] ?? "";
                        return (
                          <div key={t.name} className="flex items-center gap-1.5">
                            <span className="flex-1 truncate" title={t.description}>{t.name}</span>
                            <select value={escolha} title="Risco desta ferramenta"
                              onChange={async (e) => { await patchMcp({ id: m.id, toolRisks: { [t.name]: e.target.value || null } }); load(); }}
                              className="rounded-md border px-1 py-0.5 text-[12px]" style={{ borderColor: "var(--color-line)", background: "transparent", color: (escolha || riscoPadrao(m, t.somenteLeitura)) === "leitura" ? "inherit" : "var(--color-gold)" }}>
                              <option value="">padrão: {ROTULO_DO_RISCO[riscoPadrao(m, t.somenteLeitura)]}</option>
                              <option value="leitura">executa direto</option>
                              <option value="efeito_externo">pede aprovação</option>
                              <option value="perigoso">perigoso (só pela tela)</option>
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            <Input value={mName} onChange={(e) => setMName(e.target.value)} placeholder="Nome (ex: GitHub)" />
            <Input value={mUrl} onChange={(e) => setMUrl(e.target.value)} placeholder="URL do servidor MCP (HTTP streamable)" />
            <div className="flex gap-1">
              <Input value={mHNome} onChange={(e) => setMHNome(e.target.value)} placeholder="Cabeçalho" style={{ maxWidth: 150 }} />
              <Input type="password" value={mHValor} onChange={(e) => setMHValor(e.target.value)} placeholder="Valor do cabeçalho (opcional, ex: Bearer ...)" />
            </div>
            <Button variant="primary" size="md" onClick={addMcp}>+ servidor MCP</Button>
            {mErro && <p className="text-[12px]" style={{ color: "var(--color-danger, #c0392b)" }}>{mErro}</p>}
            <p className="text-[12px]" style={{ color: "var(--color-ink-dim)" }}>As ferramentas do MCP entram no chat pelo assunto do pedido. As que o servidor declara só leitura executam direto; as que alteram algo pedem a sua aprovação. Toque no servidor para escolher ferramenta por ferramenta. O token fica cifrado e não volta para a tela.</p>
          </>
        )}
      </div>
    </Card>
  );
}
