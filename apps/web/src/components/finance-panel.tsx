"use client";

import { useRef, useState } from "react";
import { invalidar, mutarRecurso, useRecurso } from "@/lib/dados/recurso";
import { Icone } from "@/components/presenca/icones";
import { enfileirar, isJobTerminal, type JobView } from "@/lib/jobs";
import { JobProgress } from "@/components/job-progress";

interface Lancamento {
  id: string;
  description: string;
  category: string | null;
  amount: number;
  kind: string;
  dueDate: string | null;
  paid: boolean;
}
interface Totais {
  gastos: number;
  aPagar: number;
  aReceber: number;
  saldoProjetado: number;
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Finanças: clareza para escolher, não um extrato.
 *
 * Ler comprovante e extrato é trabalho de fila (OCR mais um modelo estruturando
 * os campos passa fácil de dez segundos), então a tela enfileira e acompanha o
 * progresso em vez de segurar a requisição.
 */
export function FinancePanel() {
  const { dado } = useRecurso<{ entries: Lancamento[]; totals: Totais | null }>("/api/finance");
  const lancamentos = dado?.entries ?? [];
  const totais = dado?.totals ?? null;
  const [ocupado, setOcupado] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);
  const [trabalhoExtrato, setTrabalhoExtrato] = useState<JobView | null>(null);
  const [trabalhoComprovante, setTrabalhoComprovante] = useState<JobView | null>(null);
  const imagemRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);

  const carregar = () => invalidar("/api/finance");

  function avisar(texto: string) {
    setRecado(texto);
    setTimeout(() => setRecado(null), 6000);
  }

  async function enviar(arquivo: File, rota: string, guardar: (j: JobView | null) => void) {
    setOcupado(true);
    setRecado(null);
    // limpa o trabalho anterior: sem isto a barra do envio passado reaparece
    // por um instante antes de o novo chegar
    guardar(null);
    try {
      const fd = new FormData();
      fd.append("file", arquivo);
      const r = await fetch(rota, { method: "POST", body: fd });
      guardar(await enfileirar(r));
    } catch (e) {
      setOcupado(false);
      avisar(e instanceof Error ? e.message : "Não foi possível enviar o arquivo.");
    }
  }

  function aoMudarExtrato(j: JobView) {
    setTrabalhoExtrato(j);
    if (!isJobTerminal(j.status)) return;
    setOcupado(false);
    if (j.status === "feito") {
      const d = j.resultado as { importados: number } | null;
      avisar(`${d?.importados ?? 0} lançamento(s) importado(s) do extrato.`);
      carregar();
    } else if (j.status === "falhou") {
      avisar(j.erro?.mensagem ?? "Não consegui ler esse extrato.");
    } else {
      avisar("Importação cancelada.");
    }
  }

  function aoMudarComprovante(j: JobView) {
    setTrabalhoComprovante(j);
    if (!isJobTerminal(j.status)) return;
    setOcupado(false);
    if (j.status === "feito") {
      const d = j.resultado as { lancamento: { descricao: string; valor: number } } | null;
      avisar(d ? `${d.lancamento.descricao} · ${brl(d.lancamento.valor)}` : "Comprovante lido.");
      carregar();
    } else if (j.status === "falhou") {
      avisar(j.erro?.mensagem ?? "Não consegui ler esse comprovante.");
    } else {
      avisar("Leitura cancelada.");
    }
  }

  // Os totais são derivados dos lançamentos, então a versão otimista recalcula
  // os dois juntos: mudar só a linha e deixar o total antigo por um instante
  // seria pior do que esperar, porque mostraria uma conta que não fecha.
  async function alternarPago(e: Lancamento) {
    const r = await mutarRecurso<{ entries: Lancamento[]; totals: Totais | null }>({
      chave: "/api/finance",
      otimista: (atual) => ({
        entries: (atual?.entries ?? []).map((x) => (x.id === e.id ? { ...x, paid: !x.paid } : x)),
        totals: atual?.totals ?? null,
      }),
      executar: () =>
        fetch("/api/finance", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: e.id, paid: !e.paid }),
        }),
    });
    if (!r.ok) avisar(r.erro);
  }
  async function apagar(id: string) {
    const r = await mutarRecurso<{ entries: Lancamento[]; totals: Totais | null }>({
      chave: "/api/finance",
      otimista: (atual) => ({ entries: (atual?.entries ?? []).filter((x) => x.id !== id), totals: atual?.totals ?? null }),
      executar: () => fetch(`/api/finance?id=${id}`, { method: "DELETE" }),
    });
    if (!r.ok) avisar(r.erro);
  }

  const aPagar = lancamentos.filter((e) => e.kind === "payable");
  const aReceber = lancamentos.filter((e) => e.kind === "receivable");

  return (
    <>
      <input
        ref={imagemRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void enviar(f, "/api/finance/receipt", setTrabalhoComprovante);
          e.target.value = "";
        }}
      />
      <input
        ref={pdfRef}
        type="file"
        accept=".pdf,application/pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void enviar(f, "/api/finance/statement", setTrabalhoExtrato);
          e.target.value = "";
        }}
      />

      {totais && (
        <div className="stat-grid quatro">
          <article className="panel stat-card">
            <span>Saldo projetado</span>
            <div className="stat-value" style={{ color: totais.saldoProjetado >= 0 ? "var(--color-forest)" : "var(--color-danger)" }}>
              {brl(totais.saldoProjetado)}
            </div>
            <small>O que sobra depois do que está em aberto</small>
          </article>
          <article className="panel stat-card">
            <span>A pagar</span>
            <div className="stat-value">{brl(totais.aPagar)}</div>
            <small>{aPagar.filter((e) => !e.paid).length} em aberto</small>
          </article>
          <article className="panel stat-card">
            <span>A receber</span>
            <div className="stat-value">{brl(totais.aReceber)}</div>
            <small>{aReceber.filter((e) => !e.paid).length} em aberto</small>
          </article>
          <article className="panel stat-card">
            <span>Gastos registrados</span>
            <div className="stat-value">{brl(totais.gastos)}</div>
            <small>Somando o que já saiu</small>
          </article>
        </div>
      )}

      <article className="panel" style={{ marginTop: 22 }}>
        <span className="eyebrow">TRAGA O PAPEL, EU ORGANIZO</span>
        <h2 style={{ marginTop: 10 }}>Uma foto ou um PDF já bastam.</h2>
        <p className="description">
          A Órbita lê o comprovante ou o extrato, identifica os campos e traz para cá. Leitura de
          documento leva alguns segundos, então ela roda em segundo plano: pode continuar usando o app.
        </p>
        <div className="acoes-secao">
          <button className="button secondary" onClick={() => imagemRef.current?.click()} disabled={ocupado}>
            <Icone nome="file" />
            Ler um comprovante
          </button>
          <button className="button secondary" onClick={() => pdfRef.current?.click()} disabled={ocupado}>
            <Icone nome="download" />
            Importar extrato em PDF
          </button>
        </div>
        {recado && <div className="notice">{recado}</div>}
        {trabalhoExtrato && !isJobTerminal(trabalhoExtrato.status) && <JobProgress job={trabalhoExtrato} onChange={aoMudarExtrato} />}
        {trabalhoComprovante && !isJobTerminal(trabalhoComprovante.status) && (
          <JobProgress job={trabalhoComprovante} onChange={aoMudarComprovante} />
        )}
      </article>

      <div className="two-columns" style={{ marginTop: 22 }}>
        <Secao titulo="A pagar" vazio="Nenhuma conta em aberto." lancamentos={aPagar} aoAlternar={alternarPago} aoApagar={apagar} />
        <Secao titulo="A receber" vazio="Nada previsto para entrar." lancamentos={aReceber} aoAlternar={alternarPago} aoApagar={apagar} />
      </div>
    </>
  );
}

function Secao({
  titulo,
  vazio,
  lancamentos,
  aoAlternar,
  aoApagar,
}: {
  titulo: string;
  vazio: string;
  lancamentos: Lancamento[];
  aoAlternar: (e: Lancamento) => void;
  aoApagar: (id: string) => void;
}) {
  const hoje = new Date();
  return (
    <article className="panel">
      <h2>{titulo}</h2>
      {lancamentos.length === 0 ? (
        <div className="empty-state">{vazio}</div>
      ) : (
        lancamentos.map((e) => {
          const vencida = !e.paid && e.dueDate && new Date(e.dueDate) < hoje;
          return (
            <div key={e.id} className={`list-row lancamento ${e.paid ? "quitado" : ""}`}>
              <button
                className="icon-button"
                onClick={() => aoAlternar(e)}
                aria-label={e.paid ? `Reabrir ${e.description}` : `Marcar ${e.description} como quitada`}
                title={e.paid ? "Reabrir" : "Marcar como quitada"}
              >
                <Icone nome={e.paid ? "check" : "clock"} />
              </button>
              <div>
                <strong>{e.description}</strong>
                <small>
                  {e.category ? `${e.category} · ` : ""}
                  {e.dueDate ? (vencida ? `venceu em ${e.dueDate.slice(8, 10)}/${e.dueDate.slice(5, 7)}` : `vence em ${e.dueDate.slice(8, 10)}/${e.dueDate.slice(5, 7)}`) : "sem data"}
                </small>
              </div>
              <span className={`money-value ${vencida ? "vencida" : ""}`}>{brl(e.amount)}</span>
              <button className="icon-button" onClick={() => aoApagar(e.id)} aria-label={`Apagar ${e.description}`} title="Apagar">
                <Icone nome="trash" />
              </button>
            </div>
          );
        })
      )}
    </article>
  );
}
