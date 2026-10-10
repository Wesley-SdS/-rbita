"use client";

import Link from "next/link";
import { useState } from "react";
import { invalidar, useRecurso } from "@/lib/dados/recurso";

/**
 * COM VOCÊ NA ADALINK, na tela inicial: as atividades da gestão e os chamados
 * que estão com o dono, cada um com o PRAZO dito em gente ("faltam 2 dias",
 * "vence hoje às 18:00"), e dois alertas da equipe inteira: chamado atrasado
 * sem tratativa e chamado com um desenvolvedor, mas atrasado. Pedido do dono:
 * "às vezes colocam coisas para mim que não vejo" e "preciso ter a
 * visibilidade do prazo que tenho para finalizar". O prazo e a situação dele
 * vêm prontos do servidor (`core/comigo/regras.ts`); aqui só se desenha.
 */

type Aba = "comigo" | "sem_tratativa" | "dev_atrasado";
type EstadoDoPrazo = "atrasado" | "perto" | "no_prazo" | "pausado" | "sem_prazo";

interface Prazo {
  estado: EstadoDoPrazo;
  quando: string | null;
  texto: string;
  restanteMs: number | null;
}
interface Atividade {
  id: string;
  titulo: string;
  projeto: string | null;
  empresa: string | null;
  coluna: string;
  critica: boolean;
  com: string[];
  prazo: Prazo;
  prazoOrdem: Prazo;
}
interface Chamado {
  id: string;
  codigo: string;
  titulo: string;
  status: string;
  prioridade: string | null;
  responsavel: string | null;
  organizacao: string | null;
  prazoSolucao: Prazo;
  primeiraResposta: Prazo | null;
  prazoOrdem: Prazo;
}
interface Resposta {
  partes: { gestao: boolean; tickets: boolean };
  atividades: Atividade[];
  chamados: { comigo: Chamado[]; semTratativa: Chamado[]; comDevAtrasados: Chamado[] };
  falhas: string[];
  lidoEm: string;
}

const CHAVE = "/api/comigo";

function LinhaDePrazo({ rotulo, prazo }: { rotulo: string; prazo: Prazo }) {
  return (
    <span className={`comigo-prazo ${prazo.estado}`}>
      {rotulo}: <b>{prazo.texto}</b>
    </span>
  );
}

function ItemChamado({ c, mostrarResponsavel }: { c: Chamado; mostrarResponsavel: boolean }) {
  return (
    <li className="email-item">
      <div className="email-linha">
        <span className="email-de">{c.codigo} · chamado</span>
        <span className="email-meta"><span>{c.status}</span></span>
      </div>
      <strong className="email-assunto">{c.titulo}</strong>
      <div className="comigo-prazos">
        <LinhaDePrazo rotulo="Prazo do SLA" prazo={c.prazoSolucao} />
        {c.primeiraResposta ? <LinhaDePrazo rotulo="1ª resposta" prazo={c.primeiraResposta} /> : null}
      </div>
      <p className="email-resumo">
        {[c.prioridade ? `prioridade ${c.prioridade}` : null, c.organizacao, mostrarResponsavel ? (c.responsavel ? `com ${c.responsavel}` : "sem responsável") : null].filter(Boolean).join(" · ")}
      </p>
    </li>
  );
}

function ItemAtividade({ a }: { a: Atividade }) {
  return (
    <li className="email-item">
      <div className="email-linha">
        <span className="email-de">{[a.projeto, a.empresa].filter(Boolean).join(" · ") || "Gestão"} · atividade</span>
        <span className="email-meta"><span>{a.coluna}</span></span>
      </div>
      <strong className="email-assunto">{a.titulo}</strong>
      <div className="comigo-prazos">
        <LinhaDePrazo rotulo="Prazo para finalizar" prazo={a.prazo} />
      </div>
      {a.critica || a.com.length ? (
        <p className="email-resumo">{[a.critica ? "crítica" : null, a.com.length ? `com ${a.com.join(", ")}` : null].filter(Boolean).join(" · ")}</p>
      ) : null}
    </li>
  );
}

export function ComigoPainel() {
  const { dado, erro } = useRecurso<Resposta>(CHAVE);
  const [aba, setAba] = useState<Aba>("comigo");
  const [lendo, setLendo] = useState(false);

  async function atualizar() {
    setLendo(true);
    await fetch(`${CHAVE}?fresco=1`).catch(() => undefined);
    invalidar(CHAVE);
    setLendo(false);
  }

  if (erro && !dado) return <div className="panel empty-state">Não consegui ler a gestão e os chamados agora.</div>;
  if (!dado) return <div className="panel empty-state">Carregando…</div>;
  if (!dado.partes.gestao && !dado.partes.tickets) {
    return (
      <div className="panel empty-state noticias-vazio">
        <strong>Ligue os servidores da gestão e dos chamados e o que está com você aparece aqui.</strong>
        <span>
          Eles ficam em <Link href="/app/conexoes">Extensões, MCP</Link>.
        </span>
      </div>
    );
  }

  // o que é do dono numa lista só, do prazo mais apertado para o mais folgado
  const meus = [
    ...dado.atividades.map((a) => ({ tipo: "atividade" as const, a, ordem: a.prazoOrdem })),
    ...dado.chamados.comigo.map((c) => ({ tipo: "chamado" as const, c, ordem: c.prazoOrdem })),
  ].sort((x, y) => (x.ordem.restanteMs ?? Infinity) - (y.ordem.restanteMs ?? Infinity));
  const conta = (estado: EstadoDoPrazo) => meus.filter((m) => m.ordem.estado === estado).length;
  const abas: { id: Aba; rotulo: string; total: number; alerta: boolean }[] = [
    { id: "comigo", rotulo: "Com você", total: meus.length, alerta: conta("atrasado") > 0 },
    ...(dado.partes.tickets
      ? [
          { id: "sem_tratativa" as const, rotulo: "Sem tratativa", total: dado.chamados.semTratativa.length, alerta: dado.chamados.semTratativa.length > 0 },
          { id: "dev_atrasado" as const, rotulo: "Com dev, atrasados", total: dado.chamados.comDevAtrasados.length, alerta: dado.chamados.comDevAtrasados.length > 0 },
        ]
      : []),
  ];
  const atual = abas.some((a) => a.id === aba) ? aba : "comigo";
  const resumo = [conta("atrasado") ? `${conta("atrasado")} atrasado${conta("atrasado") > 1 ? "s" : ""}` : null, conta("perto") ? `${conta("perto")} na reta final` : null].filter(Boolean).join(", ");

  return (
    <div className="emails">
      <div className="emails-barra">
        <div className="cartao-abas emails-abas" role="tablist" aria-label="O que está com você">
          {abas.map((a) => (
            <button key={a.id} type="button" role="tab" aria-selected={atual === a.id} className={atual === a.id ? "ativa" : ""} onClick={() => setAba(a.id)}>
              {a.rotulo}
              <span className={`cartao-aba-total${a.alerta && a.total ? " atrasado" : ""}`}>{a.total}</span>
            </button>
          ))}
        </div>
        <span className="trabalho-acoes">
          <button type="button" className="text-button" disabled={lendo} onClick={() => void atualizar()}>{lendo ? "Lendo…" : "Atualizar agora"}</button>
        </span>
      </div>
      {dado.falhas.length > 0 && <p className="noticias-recado">Não consegui ler {dado.falhas.join(" nem ")}.</p>}
      {atual === "comigo" && resumo ? <p className="noticias-recado">Com você: {resumo}.</p> : null}

      {atual === "comigo" ? (
        meus.length ? (
          <ul className="emails-lista">
            {meus.map((m) => (m.tipo === "atividade" ? <ItemAtividade key={`a-${m.a.id}`} a={m.a} /> : <ItemChamado key={`c-${m.c.id}`} c={m.c} mostrarResponsavel={false} />))}
          </ul>
        ) : (
          <div className="panel empty-state">Nada com você na gestão nem nos chamados.</div>
        )
      ) : (atual === "sem_tratativa" ? dado.chamados.semTratativa : dado.chamados.comDevAtrasados).length ? (
        <ul className="emails-lista">
          {(atual === "sem_tratativa" ? dado.chamados.semTratativa : dado.chamados.comDevAtrasados).map((c) => (
            <ItemChamado key={c.id} c={c} mostrarResponsavel />
          ))}
        </ul>
      ) : (
        <div className="panel empty-state">{atual === "sem_tratativa" ? "Nenhum chamado atrasado sem tratativa." : "Nenhum chamado com desenvolvedor atrasado."}</div>
      )}
    </div>
  );
}
