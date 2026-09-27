"use client";

import { brl, dataLonga } from "@orbita/core/finance/formato";
import { useFinancas, useVista, type SubContas } from "./contexto";
import { Alternador, Barra, Bloco, Carregando, Faixa, Indicador, Vazio } from "./primitivos";
import { LinhaConta } from "./linha-conta";
import { plural } from "@/lib/financas/apresentacao";
import { textoDosJuros } from "@/lib/financas/dinheiro";
import type { Contas as TContas, Divida } from "@/lib/financas/tipos";
import { ErrorRetry } from "@/components/ui";

/** Contas a pagar e a receber, e dívidas (PRD §6.3). */
export function Contas() {
  const f = useFinancas();
  const sub = f.ui.subContas;
  const { dado: c, erro, recarregar } = useVista<TContas>("contas", { mes: f.ui.mes });
  if (!c) return erro ? <ErrorRetry message={erro} onRetry={recarregar} /> : <Carregando />;

  const lista = sub === "aberto" ? c.emAberto : sub === "mes" ? c.doMes : c.quitadas;
  return (
    <div className="fin-pilha">
      <div className="fin-indicadores tres">
        <Indicador rotulo="A pagar em 30 dias" valor={c.topo.aPagar} tom={c.topo.aPagar > 0 ? "saida" : null} />
        <Indicador rotulo="A receber em 30 dias" valor={c.topo.aReceber} tom="entrada" />
        <Indicador rotulo="Em atraso" valor={c.topo.emAtraso} tom={c.topo.emAtraso > 0 ? "saida" : null} />
      </div>
      <Alternador<SubContas>
        rotulo="Lista de contas"
        valor={sub}
        aoMudar={(v) => f.mudarUi({ subContas: v })}
        opcoes={[
          { id: "aberto", rotulo: "Em aberto" },
          { id: "mes", rotulo: "Do mês" },
          { id: "quitadas", rotulo: "Quitadas" },
          { id: "dividas", rotulo: "Dívidas" },
        ]}
      />
      {sub === "dividas" ? (
        <Dividas dividas={c.dividas} />
      ) : (
        <Bloco>
          <div className="fin-botoes fin-botoes-topo">
            <button type="button" className="button primary compacto fin-cresce" onClick={() => f.abrir({ tipo: "compromisso" })}>
              + Nova conta a pagar ou receber
            </button>
            <button type="button" className="button secondary compacto" onClick={() => f.abrir({ tipo: "boleto" })}>
              Ler boleto
            </button>
          </div>
          {lista.length === 0 ? (
            <Vazio titulo="Nenhuma conta nesta lista." texto="Cadastre aluguel, internet, assinatura, boleto: tudo que tem data para vencer." />
          ) : (
            lista.map((x) => <LinhaConta key={x.id} c={x} />)
          )}
        </Bloco>
      )}
    </div>
  );
}

function Dividas({ dividas }: { dividas: Divida[] }) {
  const f = useFinancas();
  return (
    <div className="fin-pilha">
      <button type="button" className="button primary compacto" onClick={() => f.abrir({ tipo: "divida" })}>
        + Cadastrar dívida
      </button>
      {dividas.length === 0 ? (
        <Bloco>
          <Vazio
            titulo="Nenhuma dívida cadastrada."
            texto="Aqui é só para dívida que cobra juros: rotativo do cartão, empréstimo, cheque especial, crediário. Conta a pagar comum fica na aba Em aberto e não aparece neste total."
          />
        </Bloco>
      ) : (
        dividas.map((d) => {
          const q = d.quitacao;
          return (
            <Bloco key={d.id} className="fin-divida">
              <header className="fin-cartao-topo">
                <i className="fin-fita" style={{ background: "var(--fin-saida)" }} />
                <strong>{d.nome}</strong>
                <button type="button" className="fin-link" onClick={() => f.abrir({ tipo: "divida", divida: d })}>editar</button>
              </header>
              <span className="fin-farol-rotulo">Saldo devedor</span>
              <strong className="fin-numero medio fin-tom-saida">{brl(d.saldo)}</strong>
              <p className="fin-nota">
                {d.jurosMes > 0 ? `${textoDosJuros(d.jurosMes)}% de juros ao mês. ` : ""}
                {d.parcelaMensal > 0 ? `Pagando ${brl(d.parcelaMensal)} por mês.` : "Sem parcela definida."}
              </p>
              <Barra pct={d.saldoInicial > 0 ? (d.abatido / d.saldoInicial) * 100 : 0} cor="var(--fin-entrada)" rotulo="Quanto já foi abatido" />
              <small className="fin-dica">{brl(d.abatido)} já abatidos de {brl(d.saldoInicial)}</small>
              {q.tipo === "impossivel" ? (
                <Faixa tom="urgente" icone="!">
                  {q.motivo === "parcela_nao_cobre_juros"
                    ? "A parcela não cobre nem os juros. Do jeito que está, essa dívida nunca acaba."
                    : "Defina quanto você paga por mês para ver a previsão de quitação."}
                </Faixa>
              ) : q.tipo === "previsao" ? (
                <Faixa tom="calmo" icone="calendar">
                  Quita em <b>{q.meses} {plural(q.meses, "mês", "meses")}</b>, pagando {brl(q.totalPago)} no total. <b>{brl(q.juros)}</b> só de juros.
                </Faixa>
              ) : (
                <Faixa tom="calmo" icone="✓">Quitada.</Faixa>
              )}
              {d.saldo > 0 && (
                <button type="button" className="button secondary compacto full-width" onClick={() => f.abrir({ tipo: "pagar_divida", divida: d })}>
                  Registrar pagamento
                </button>
              )}
              <div className="fin-historico-pag">
                {d.pagamentos.length === 0 ? (
                  <small className="fin-dica">Nenhum pagamento registrado.</small>
                ) : (
                  d.pagamentos.map((p) => (
                    <div key={p.id} className="fin-linha estatica">
                      <span className="fin-ok" aria-hidden="true">✓</span>
                      <span className="fin-linha-corpo">
                        <strong>{dataLonga(p.data)}</strong>
                        <small>{brl(p.juros)} de juros, {brl(p.abatimento)} de abatimento</small>
                      </span>
                      <span className="fin-valor">{brl(p.valor)}</span>
                    </div>
                  ))
                )}
              </div>
            </Bloco>
          );
        })
      )}
    </div>
  );
}
