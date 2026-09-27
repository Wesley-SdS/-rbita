"use client";

import { brl, mesCurto, mesLongo, valorSemPrefixo, iniciais } from "@orbita/core/finance/formato";
import { useFinancas, useVista } from "./contexto";
import { ColunasHistorico } from "./graficos";
import { Bloco, Carregando, Link, Pastilha, Vazio } from "./primitivos";
import type { Historico as THistorico } from "@/lib/financas/tipos";
import { ErrorRetry } from "@/components/ui";

/** Doze meses para trás (PRD §6.7). */
export function Historico() {
  const f = useFinancas();
  const { dado: h, erro, recarregar } = useVista<THistorico>("historico");
  if (!h) return erro ? <ErrorRetry message={erro} onRetry={recarregar} /> : <Carregando />;
  const algum = h.meses.some((m) => m.temMovimento);
  const atual = h.meses.find((m) => m.atual)?.mes ?? f.mesAtual;

  return (
    <div className="fin-pilha">
      <Bloco titulo="Últimos 12 meses" direita={<Link onClick={() => f.irPara("previsao")}>ver os 12 meses à frente</Link>}>
        {!algum ? (
          <Vazio titulo="Ainda não há histórico." texto="Depois de dois ou três meses lançando, esta tela mostra sua tendência." />
        ) : (
          <>
            <ColunasHistorico meses={h.meses} />
            <div className="fin-legenda-linha">
              <span><i className="leg-saida" /> saídas</span>
              <span><i className="leg-entrada" /> entradas</span>
            </div>
          </>
        )}
      </Bloco>
      {algum && (
        <div className="fin-indicadores tres">
          <div className="fin-ind">
            <span>Média por mês</span>
            <strong>{brl(h.media)}</strong>
          </div>
          {h.maisCaro && (
            <div className="fin-ind">
              <span>Mês mais caro</span>
              <strong className="fin-tom-saida">{mesCurto(h.maisCaro.mes)} · {valorSemPrefixo(h.maisCaro.gasto)}</strong>
            </div>
          )}
          {h.maisLeve && (
            <div className="fin-ind">
              <span>Mês mais leve</span>
              <strong className="fin-tom-entrada">{mesCurto(h.maisLeve.mes)} · {valorSemPrefixo(h.maisLeve.gasto)}</strong>
            </div>
          )}
        </div>
      )}
      <Bloco titulo={`${primeiraMaiuscula(mesLongo(atual))} contra a média dos 3 meses anteriores`}>
        {h.comparacao.length === 0 ? (
          <Vazio titulo="Sem base de comparação ainda." />
        ) : (
          h.comparacao.map((c) => {
            const nome = c.categoria?.nome ?? "Sem categoria";
            const subiu = c.diferenca > 0;
            return (
              <div key={c.categoriaId ?? "sem"} className="fin-linha estatica">
                <Pastilha texto={c.categoria?.iniciais ?? iniciais(nome)} cor={c.categoria?.cor} />
                <span className="fin-linha-corpo">
                  <strong>{nome}</strong>
                  <small>média {brl(c.media)}, agora {brl(c.agora)}</small>
                </span>
                <b className={subiu ? "fin-tom-saida" : "fin-tom-entrada"}>
                  {subiu ? "+" : "−"}{Math.abs(Math.round(c.pct))}%
                </b>
              </div>
            );
          })
        )}
      </Bloco>
    </div>
  );
}

const primeiraMaiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
