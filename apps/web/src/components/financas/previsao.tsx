"use client";

import { brl, mesCurto } from "@orbita/core/finance/formato";
import { useFinancas, useVista } from "./contexto";
import { Barra, Bloco, Carregando, Etiqueta, Faixa } from "./primitivos";
import { largura } from "@/lib/financas/apresentacao";
import type { Previsao as TPrevisao } from "@/lib/financas/tipos";
import { ErrorRetry } from "@/components/ui";

/** "-R$ 120,00": o livre negativo leva o sinal antes do prefixo (§6.6). */
const comSinal = (c: number) => (c < 0 ? `-${brl(-c)}` : brl(c));

/** Doze meses à frente, sempre a partir de hoje (PRD §6.6). */
export function Previsao() {
  const f = useFinancas();
  const { dado: p, erro, recarregar } = useVista<TPrevisao>("previsao");
  if (!p) return erro ? <ErrorRetry message={erro} onRetry={recarregar} /> : <Carregando />;
  const escala = Math.max(1, ...p.meses.flatMap((m) => [m.entra, m.comprometido]));
  const apertado = p.maisApertado;

  return (
    <div className="fin-pilha">
      <div className="fin-botoes">
        <button type="button" className="button secondary compacto" onClick={() => f.irPara("painel")}>‹ Painel</button>
        <span className="fin-dica">12 meses à frente</span>
      </div>
      <Bloco className="fin-farol">
        <span className="fin-farol-rotulo">Já comprometido nos próximos 12 meses</span>
        <strong className="fin-numero">{brl(p.totalComprometido)}</strong>
        <p className="fin-farol-sub">contas fixas, parcelas em aberto e parcelas de metas, somando tudo que já está decidido.</p>
        {apertado &&
          (apertado.livre < 0 ? (
            <Faixa tom="urgente" icone="!">
              Em <b>{mesCurto(apertado.mes)}</b> o comprometido passa o que entra em <b>{brl(-apertado.livre)}</b>.
            </Faixa>
          ) : (
            <p className="fin-nota">
              Mês mais apertado: <b>{mesCurto(apertado.mes)}</b>, sobrando {brl(apertado.livre)} para o dia a dia.
            </p>
          ))}
        {!p.temRenda && (
          <Faixa tom="perto" icone="info">
            Sem renda cadastrada, a projeção só mostra o que sai. Preencha em Ajustes para ver o que sobra.
          </Faixa>
        )}
      </Bloco>
      <Bloco>
        {p.meses.map((m) => {
          const partes = [
            m.contasFixas > 0 ? `(fixos ${brl(m.contasFixas)})` : "",
            m.parcelas > 0 ? `(parcelas ${brl(m.parcelas)})` : "",
            m.metas > 0 ? `(metas ${brl(m.metas)})` : "",
          ].filter(Boolean).join(" ");
          return (
            <button key={m.mes} type="button" className="fin-mes-linha" onClick={() => f.irPara("extrato", { mes: m.mes })}>
              <span className="fin-mes-linha-topo">
                <strong>{mesCurto(m.mes)}</strong>
                {m.atual && <Etiqueta tom="alerta">agora</Etiqueta>}
                <b className={m.livre < 0 ? "fin-tom-saida" : "fin-tom-entrada"}>{comSinal(m.livre)} livres</b>
              </span>
              <Barra pct={largura(m.entra, escala)} cor="var(--fin-entrada)" rotulo="Entra" />
              <Barra pct={largura(m.comprometido, escala)} cor="var(--fin-saida)" rotulo="Comprometido" />
              <small className="fin-dica">
                entra {brl(m.entra)} · comprometido {brl(m.comprometido)} {partes}
              </small>
              {!m.atual && p.mediaLivre > 0 && m.saldoProjetado !== null && (
                <small className="fin-dica">
                  no seu ritmo de {brl(p.mediaLivre)} por mês de gasto livre, o saldo em contas fecha em{" "}
                  <b className={m.saldoProjetado < 0 ? "fin-tom-saida" : "fin-tom-entrada"}>{brl(m.saldoProjetado)}</b>
                </small>
              )}
            </button>
          );
        })}
        <p className="fin-rodape">
          {p.mediaLivre > 0
            ? "A projeção de saldo usa a média do seu gasto livre dos últimos 3 meses. Ela muda conforme você lança."
            : "Depois de um mês inteiro lançando, aparece aqui a projeção de saldo usando o seu ritmo real de gasto."}{" "}
          Toque em um mês para ver os lançamentos dele.
        </p>
      </Bloco>
    </div>
  );
}
