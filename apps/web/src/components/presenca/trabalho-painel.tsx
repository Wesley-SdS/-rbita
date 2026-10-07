"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { quandoLegivel } from "@orbita/core/chat/cartoes-da-tela";
import { invalidar, useRecurso } from "@/lib/dados/recurso";

/**
 * SEU TRABALHO, na tela inicial: as pendências de TODOS os Jiras conectados
 * (lidas ao vivo), o que chegou nas suas PRs do GitHub e as menções e
 * mensagens diretas do Slack. Uma aba por serviço conectado; "Visto" tira do
 * destaque. A consolidação mora em `trabalho/servico.ts`.
 */

type Aba = "jira" | "github" | "slack";

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
  conectados: Record<Aba, number>;
  jira: Issue[];
  jiraFalhas: string[];
  github: Novidade[];
  slack: Novidade[];
}

const CHAVE = "/api/trabalho";
const ROTULO: Record<Aba, string> = { jira: "Jira", github: "GitHub", slack: "Slack" };
const ACAO: Record<string, string> = { APPROVED: "aprovou", CHANGES_REQUESTED: "pediu mudanças", COMMENTED: "comentou" };
const TIPO: Record<string, string> = { comentario: "comentou", review: "fez review", pedido_review: "pediu o seu review", mencao: "te mencionou", mensagem_direta: "te mandou mensagem" };
const hoje = () => new Date().toISOString().slice(0, 10);

function Externo({ href, children, className }: { href: string | null; children: React.ReactNode; className: string }) {
  return href ? <a className={className} href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <strong className={className}>{children}</strong>;
}

export function TrabalhoPainel() {
  const { dado, erro } = useRecurso<Resposta>(CHAVE);
  const abas = (["jira", "github", "slack"] as Aba[]).filter((a) => (dado?.conectados[a] ?? 0) > 0);
  const [aba, setAba] = useState<Aba | null>(null);
  const atual = aba && abas.includes(aba) ? aba : abas[0] ?? null;
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

  const total = (a: Aba) => (a === "jira" ? dado.jira.length : dado[a].length);
  const novidades = atual === "github" ? dado.github : atual === "slack" ? dado.slack : [];

  return (
    <div className="emails">
      <div className="emails-barra">
        <div className="cartao-abas emails-abas" role="tablist" aria-label="Serviços de trabalho">
          {abas.map((a) => (
            <button key={a} type="button" role="tab" aria-selected={atual === a} className={atual === a ? "ativa" : ""} onClick={() => setAba(a)}>
              {ROTULO[a]}
              <span className="cartao-aba-total">{total(a)}</span>
            </button>
          ))}
        </div>
        <span className="trabalho-acoes">
          {novidades.length > 1 && (
            <button type="button" className="text-button" onClick={() => void visto(novidades.map((n) => n.id))}>Marcar tudo como visto</button>
          )}
          {(dado.conectados.github > 0 || dado.conectados.slack > 0) && (
            <button type="button" className="text-button" onClick={() => void atualizar()}>Atualizar agora</button>
          )}
        </span>
      </div>
      {recado && <p className="noticias-recado" role="status">{recado}</p>}
      {atual === "jira" && dado.jiraFalhas.length > 0 && <p className="noticias-recado">Não consegui ler: {dado.jiraFalhas.join(", ")}.</p>}

      {atual === "jira" ? (
        dado.jira.length ? (
          <ul className="emails-lista">
            {dado.jira.map((i) => {
              const atrasada = i.vencimento && i.vencimento < hoje();
              return (
                <li key={`${i.site}-${i.chave}`} className="email-item">
                  <div className="email-linha">
                    <span className="email-de">{i.chave}</span>
                    <span className="email-meta">
                      {abas.length && new Set(dado.jira.map((x) => x.site)).size > 1 ? <span className="email-conta">{i.site}</span> : null}
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
          <div className="panel empty-state">Nada atribuído a você nos Jiras. Bom sinal.</div>
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
        <div className="panel empty-state">Nada novo no {atual ? ROTULO[atual] : ""}.</div>
      )}
    </div>
  );
}
