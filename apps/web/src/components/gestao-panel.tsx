"use client";

import { useState } from "react";
import { useRecurso } from "@/lib/dados/recurso";
import { Icone } from "@/components/presenca/icones";

/**
 * Gestão: para onde o dinheiro da casa está indo.
 *
 * Existe por uma medição de 22/09/2026 que não dá para esquecer: o painel de
 * economia mostrava 136 tokens enquanto a casa tinha acabado de fazer 356
 * chamadas de modelo. O resumo lia a tabela `message`, e só o chat escreve
 * ali — tudo que a Órbita faz sozinha era invisível. Uma rotina cadastrada com
 * intervalo de um minuto rodou a noite inteira sem aparecer em lugar nenhum.
 *
 * Por isso esta tela é organizada por FLUXO antes de por modelo: a pergunta
 * que importa não é "quanto gastei com o gpt-5" e sim "o que é que está
 * gastando".
 */
const NOME_DO_FLUXO: Record<string, string> = {
  chat: "Conversa",
  rotina: "Rotinas",
  regra: "Regras proativas",
  resumo_conversa: "Resumo de conversa",
  resumo_reuniao: "Resumo de reunião",
  compromissos: "Compromissos",
  transcricao: "Transcrição",
  transcricao_viva: "Transcrição ao vivo",
  voz_tempo_real: "Voz em tempo real",
  ocr: "Leitura de documento",
  visao: "Visão",
  camera: "Câmeras",
  embedding: "Indexação e busca",
  tts: "Voz da Órbita",
  memoria: "Memória",
  financas: "Finanças",
  casa: "Casa",
  acompanhamento: "Acompanhar tarefa",
};

const NOME_DA_UNIDADE: Record<string, string> = {
  tokens: "tokens",
  segundos: "s de áudio",
  caracteres: "caracteres",
  paginas: "páginas",
  requisicoes: "chamadas",
};

interface Grupo {
  chave: string;
  chamadas: number;
  custoUsd: number;
  entrada: number;
  saida: number;
  falhas: number;
  semPreco: number;
  unidades: string[];
}
interface Linha {
  fluxo: string;
  referencia: string | null;
  provider: string;
  modelo: string;
  unidade: string;
  entrada: number;
  saida: number;
  custoUsd: number;
  cobranca: string;
  duracaoMs: number | null;
  erro: string | null;
  createdAt: string;
}
interface Dados {
  periodoDias: number;
  resumo: {
    totalUsd: number;
    chamadas: number;
    falhas: number;
    chamadasAssinatura: number;
    chamadasLocais: number;
    chamadasSemPreco: number;
    porFluxo: Grupo[];
    porProvedor: Grupo[];
    porModelo: Grupo[];
  };
  porDia: { dia: string; custoUsd: number; chamadas: number }[];
  ultimas: Linha[];
}

const PERIODOS = [
  { id: "hoje", label: "Hoje" },
  { id: "semana", label: "7 dias" },
  { id: "mes", label: "30 dias" },
  { id: "trimestre", label: "90 dias" },
];

const usd = (n: number) => (n < 0.01 && n > 0 ? "< US$ 0,01" : `US$ ${n.toFixed(2).replace(".", ",")}`);
const num = (n: number) => n.toLocaleString("pt-BR");
const nomeDoFluxo = (f: string) => NOME_DO_FLUXO[f] ?? f.replace(/_/g, " ");

export function GestaoPanel() {
  const [periodo, setPeriodo] = useState("semana");
  const { dado, erro, carregando } = useRecurso<Dados>(`/api/gestao?periodo=${periodo}`);

  if (erro) return <div className="aviso-ameno atencao"><span>{erro}</span></div>;
  if (!dado && carregando) return <p className="description">Somando o consumo…</p>;
  const d = dado;
  if (!d) return null;

  const r = d.resumo;
  const pico = Math.max(...d.porDia.map((x) => x.custoUsd), 0.0001);

  return (
    <>
      <div className="gestao-periodos">
        {PERIODOS.map((p) => (
          <button
            key={p.id}
            className={`button ${periodo === p.id ? "primary" : "secondary"} compacto`}
            onClick={() => setPeriodo(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="stat-grid quatro">
        <article className="panel stat-card">
          <span>Pago por uso</span>
          <div className="stat-value">{usd(r.totalUsd)}</div>
          <small>{num(r.chamadas)} chamada(s) no período</small>
        </article>
        <article className="panel stat-card">
          <span>Pela assinatura</span>
          <div className="stat-value">{num(r.chamadasAssinatura)}</div>
          {/* não custa por chamada, mas consome a cota — e é a cota que estoura em 429 */}
          <small>Não entram no valor acima, mas gastam a sua cota</small>
        </article>
        <article className="panel stat-card">
          <span>Na sua máquina</span>
          <div className="stat-value">{num(r.chamadasLocais)}</div>
          <small>Só energia, sem fatura</small>
        </article>
        <article className="panel stat-card">
          <span>Sem preço informado</span>
          <div className="stat-value">{num(r.chamadasSemPreco)}</div>
          <small>{r.chamadasSemPreco > 0 ? "O provedor não publica preço: o custo é desconhecido, não zero" : "Todo gasto do período tem preço conhecido"}</small>
        </article>
      </div>

      {r.chamadas === 0 && (
        <div className="aviso-ameno" style={{ marginTop: 18 }}>
          <span>Nada foi consumido neste período. Se você esperava movimento aqui, pode ser que o registro seja mais novo que o uso.</span>
        </div>
      )}

      <article className="panel" style={{ marginTop: 22 }}>
        <div className="section-heading">
          <h2>O que está gastando</h2>
        </div>
        <p className="description">
          Por fluxo, não por modelo: a pergunta útil é o que consome, não qual modelo atendeu.
        </p>
        <div className="gestao-barras">
          {r.porFluxo.map((g) => (
            <div key={g.chave} className="gestao-linha">
              <span className="gestao-rotulo">{nomeDoFluxo(g.chave)}</span>
              <span className="gestao-barra">
                <i style={{ width: `${Math.max(2, (g.custoUsd / Math.max(r.totalUsd, 0.0001)) * 100)}%` }} />
              </span>
              <span className="gestao-valor">{usd(g.custoUsd)}</span>
              <span className="gestao-detalhe">
                {num(g.chamadas)}×
                {g.falhas > 0 && <b title="chamadas que falharam: custaram tempo e às vezes dinheiro"> · {g.falhas} falha(s)</b>}
              </span>
            </div>
          ))}
          {r.porFluxo.length === 0 && <p className="description">Sem consumo registrado.</p>}
        </div>
      </article>

      <div className="gestao-duas">
        <article className="panel">
          <div className="section-heading"><h2>Por provedor</h2></div>
          {r.porProvedor.map((g) => (
            <div key={g.chave} className="stat-row">
              <span>{g.chave}</span>
              <b>{usd(g.custoUsd)}</b>
            </div>
          ))}
          {r.porProvedor.length === 0 && <p className="description">Nada ainda.</p>}
        </article>

        <article className="panel">
          <div className="section-heading"><h2>Por dia</h2></div>
          <div className="gestao-dias">
            {d.porDia.map((x) => (
              <div key={x.dia} className="gestao-dia" title={`${x.dia}: ${usd(x.custoUsd)} em ${num(x.chamadas)} chamada(s)`}>
                <i style={{ height: `${Math.max(3, (x.custoUsd / pico) * 100)}%` }} />
                <span>{x.dia.slice(8)}</span>
              </div>
            ))}
          </div>
        </article>
      </div>

      <article className="panel" style={{ marginTop: 22 }}>
        <div className="section-heading"><h2>Últimas chamadas</h2></div>
        <p className="description">
          Para conferir uma linha específica quando um número parecer estranho. Total não explica gasto fora de hora.
        </p>
        <div className="gestao-tabela">
          {d.ultimas.map((l, i) => (
            <div key={i} className={`gestao-item ${l.erro ? "falhou" : ""}`}>
              <span className="gestao-hora">{new Date(l.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              <span className="gestao-fluxo">
                {nomeDoFluxo(l.fluxo)}
                {l.referencia && <small> · {l.referencia}</small>}
              </span>
              <span className="gestao-modelo">{l.modelo}</span>
              <span className="gestao-qtd">
                {num(l.entrada + l.saida)} {NOME_DA_UNIDADE[l.unidade] ?? l.unidade}
              </span>
              <span className="gestao-custo">
                {l.cobranca === "assinatura" ? "assinatura" : l.cobranca === "local" ? "local" : usd(l.custoUsd)}
              </span>
              {l.erro && (
                <span className="gestao-erro" title={l.erro}>
                  <Icone nome="info" />
                </span>
              )}
            </div>
          ))}
          {d.ultimas.length === 0 && <p className="description">Nenhuma chamada registrada no período.</p>}
        </div>
      </article>
    </>
  );
}
