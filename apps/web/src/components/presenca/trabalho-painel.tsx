"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { quandoLegivel } from "@orbita/core/chat/cartoes-da-tela";
import { invalidar, useRecurso } from "@/lib/dados/recurso";
import { Icone } from "./icones";

/**
 * SEU TRABALHO, na tela inicial: as pendências de TODOS os Jiras conectados
 * (lidas ao vivo), o que chegou nas suas PRs do GitHub e as menções e
 * mensagens diretas do Slack. Uma aba por Jira (com o nome que o dono deu,
 * pelo lápis), mais GitHub e Slack; "Visto" tira do destaque. A consolidação
 * mora em `trabalho/servico.ts`.
 */

type Servico = "jira" | "github" | "slack";
/** "github", "slack" ou "jira:<site>": cada Jira é uma aba, para o nome valer para ele só */
type Aba = string;

interface Issue {
  chave: string;
  titulo: string;
  status: string;
  prioridade: string | null;
  vencimento: string | null;
  site: string;
  link: string;
}
interface Novidade {
  id: string;
  tipo: string;
  contexto: string;
  autor: string;
  estado: string | null;
  trecho: string;
  url: string | null;
  quando: string;
}
interface Resposta {
  conectados: Record<Servico, number>;
  jira: Issue[];
  jiraFalhas: string[];
  sitesJira: string[];
  apelidos: Record<string, string>;
  github: Novidade[];
  slack: Novidade[];
}

const CHAVE = "/api/trabalho";
const ROTULO: Record<Servico, string> = { jira: "Jira", github: "GitHub", slack: "Slack" };
const NOME_MAX = 40;
const ACAO: Record<string, string> = { APPROVED: "aprovou", CHANGES_REQUESTED: "pediu mudanças", COMMENTED: "comentou" };
const TIPO: Record<string, string> = { comentario: "comentou", review: "fez review", pedido_review: "pediu o seu review", mencao: "te mencionou", mensagem_direta: "te mandou mensagem" };
const hoje = () => new Date().toISOString().slice(0, 10);

function Externo({ href, children, className }: { href: string | null; children: React.ReactNode; className: string }) {
  return href ? <a className={className} href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <strong className={className}>{children}</strong>;
}

export function TrabalhoPainel() {
  const { dado, erro } = useRecurso<Resposta>(CHAVE);
  // um Jira por aba. Se a leitura dos sites falhou (a conta existe, os sites não vieram), fica uma aba "Jira" só
  const sites = dado?.sitesJira ?? [];
  const abasJira: Aba[] = (dado?.conectados.jira ?? 0) > 0 ? (sites.length ? sites.map((s) => `jira:${s}`) : ["jira:"]) : [];
  const abas: Aba[] = [...abasJira, ...(["github", "slack"] as Servico[]).filter((a) => (dado?.conectados[a] ?? 0) > 0)];
  const [aba, setAba] = useState<Aba | null>(null);
  const atual = aba && abas.includes(aba) ? aba : abas[0] ?? null;
  const siteAtual = atual?.startsWith("jira:") ? atual.slice(5) : null;
  const nomeDaAba = (a: Aba) => (a.startsWith("jira:") ? (dado?.apelidos[a.slice(5)] ?? (a.slice(5) || ROTULO.jira)) : ROTULO[a as Servico]);
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);
  const recargas = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => recargas.current.forEach(clearTimeout), []);

  async function atualizar() {
    const r = await fetch("/api/trabalho/atualizar", { method: "POST" });
    setRecado(r.ok || r.status === 202 ? "Olhando o GitHub e o Slack agora." : "Não consegui olhar agora.");
    setTimeout(() => setRecado(null), 6000);
    recargas.current.forEach(clearTimeout);
    recargas.current = [5_000, 15_000, 35_000].map((ms) => setTimeout(() => invalidar(CHAVE), ms));
  }
  async function visto(ids: string[]) {
    await fetch("/api/trabalho/visto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
    invalidar(CHAVE);
  }

  async function salvarNome() {
    if (siteAtual === null) return;
    setSalvando(true);
    const r = await fetch("/api/trabalho/apelido", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ site: siteAtual, apelido: rascunho.trim() }) });
    setSalvando(false);
    if (r.ok) {
      setEditando(false);
      invalidar(CHAVE);
    } else {
      const d = await r.json().catch(() => ({}));
      setRecado(d.error ?? "Não consegui salvar o nome.");
      setTimeout(() => setRecado(null), 6000);
    }
  }

  if (erro && !dado) return <div className="panel empty-state">Não consegui carregar o seu trabalho agora.</div>;
  if (!dado) return <div className="panel empty-state">Carregando…</div>;
  if (!abas.length) {
    return (
      <div className="panel empty-state noticias-vazio">
        <strong>Conecte Jira, GitHub e Slack e as pendências ficam aqui.</strong>
        <span>
          Por token, sem criar aplicativo: <Link href="/app/conexoes">abrir Conexões</Link>.
        </span>
      </div>
    );
  }

  const issuesDe = (site: string) => (site ? dado.jira.filter((i) => i.site === site) : dado.jira);
  const total = (a: Aba) => (a.startsWith("jira:") ? issuesDe(a.slice(5)).length : dado[a as "github" | "slack"].length);
  const novidades = atual === "github" ? dado.github : atual === "slack" ? dado.slack : [];
  const issues = siteAtual !== null ? issuesDe(siteAtual) : [];

  return (
    <div className="emails">
      <div className="emails-barra">
        <div className="cartao-abas emails-abas" role="tablist" aria-label="Serviços de trabalho">
          {abas.map((a) => (
            <button key={a} type="button" role="tab" aria-selected={atual === a} className={atual === a ? "ativa" : ""} onClick={() => setAba(a)}>
              {nomeDaAba(a)}
              <span className="cartao-aba-total">{total(a)}</span>
            </button>
          ))}
        </div>
        <span className="trabalho-acoes">
          {siteAtual !== null && !editando && (
            <button
              type="button"
              className="text-button"
              aria-label={`Editar o nome de ${nomeDaAba(atual!)}`}
              title="Editar o nome deste Jira"
              onClick={() => {
                setRascunho(dado.apelidos[siteAtual] ?? "");
                setEditando(true);
              }}
            >
              <Icone nome="edit" />
            </button>
          )}
          {novidades.length > 1 && (
            <button type="button" className="text-button" onClick={() => void visto(novidades.map((n) => n.id))}>Marcar tudo como visto</button>
          )}
          {(dado.conectados.github > 0 || dado.conectados.slack > 0) && (
            <button type="button" className="text-button" onClick={() => void atualizar()}>Atualizar agora</button>
          )}
        </span>
      </div>
      {editando && siteAtual !== null && (
        <form
          className="trabalho-nome"
          onSubmit={(e) => {
            e.preventDefault();
            void salvarNome();
          }}
        >
          <input
            className="inline-input compacto"
            value={rascunho}
            maxLength={NOME_MAX}
            autoFocus
            placeholder={siteAtual || "Nome do Jira"}
            aria-label="Nome deste Jira"
            onChange={(e) => setRascunho(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setEditando(false)}
          />
          <button type="submit" className="button secondary compacto" disabled={salvando}>Salvar</button>
          <button type="button" className="text-button" onClick={() => setEditando(false)}>Cancelar</button>
          <span className="email-nota">Vazio volta ao nome do site{siteAtual ? ` (${siteAtual})` : ""}.</span>
        </form>
      )}
      {recado && <p className="noticias-recado" role="status">{recado}</p>}
      {siteAtual !== null && dado.jiraFalhas.length > 0 && <p className="noticias-recado">Não consegui ler: {dado.jiraFalhas.join(", ")}.</p>}

      {siteAtual !== null ? (
        issues.length ? (
          <ul className="emails-lista">
            {issues.map((i) => {
              const atrasada = i.vencimento && i.vencimento < hoje();
              return (
                <li key={`${i.site}-${i.chave}`} className="email-item">
                  <div className="email-linha">
                    <span className="email-de">{i.chave}</span>
                    <span className="email-meta">
                      {i.vencimento ? <span className={atrasada ? "cartao-quando atrasado" : ""}>{atrasada ? "atrasada, " : "até "}{quandoLegivel(i.vencimento)}</span> : null}
                    </span>
                  </div>
                  <Externo className="email-assunto" href={i.link || null}>{i.titulo}</Externo>
                  <p className="email-resumo">{[i.status, i.prioridade].filter(Boolean).join(" · ")}</p>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="panel empty-state">Nada atribuído a você em {nomeDaAba(atual!)}. Bom sinal.</div>
        )
      ) : novidades.length ? (
        <ul className="emails-lista">
          {novidades.map((n) => (
            <li key={n.id} className="email-item">
              <div className="email-linha">
                <span className="email-de">
                  {n.autor || "Alguém"} {n.estado ? ACAO[n.estado] ?? TIPO[n.tipo] : TIPO[n.tipo] ?? n.tipo}
                </span>
                <span className="email-meta"><span>{quandoLegivel(n.quando)}</span></span>
              </div>
              <Externo className="email-assunto" href={n.url}>{n.contexto}</Externo>
              {n.trecho ? <p className="email-resumo">{n.trecho.length > 280 ? `${n.trecho.slice(0, 280)}…` : n.trecho}</p> : null}
              {n.estado === "CHANGES_REQUESTED" ? <span className="email-chip importante">Pediram mudanças</span> : null}
              <div className="email-acoes">
                <button type="button" className="text-button" onClick={() => void visto([n.id])}>Visto</button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="panel empty-state">Nada novo no {atual ? nomeDaAba(atual) : ""}.</div>
      )}
    </div>
  );
}
