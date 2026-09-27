"use client";

import { useId } from "react";
import { brl, mesCurto, valorSemPrefixo } from "@orbita/core/finance/formato";
import { diasNoMes } from "@orbita/core/finance/calendario";
import { area, caminho, escalaDoRitmo, pontos } from "@/lib/financas/grafico";
import { largura } from "@/lib/financas/apresentacao";

/**
 * Os três gráficos das finanças em SVG inline, sem biblioteca: são poucas
 * linhas e colunas, e uma biblioteca de gráfico custaria mais no bundle do
 * celular do que a tela inteira.
 */

const W = 600;
const H = 104;

/** Ritmo do mês (§6.1.6): acumulado deste mês, do anterior e o teto. */
export function Ritmo({ mes, acumulado, anterior, teto }: { mes: string; acumulado: number[]; anterior: number[]; teto: number | null }) {
  const grad = useId();
  const dias = Math.max(diasNoMes(mes), anterior.length, 2);
  const max = escalaDoRitmo(acumulado, anterior, teto);
  const caixa = { largura: W, altura: H };
  const atual = pontos(acumulado, dias, max, caixa);
  const antes = pontos(anterior, dias, max, caixa);
  const ultimo = atual[atual.length - 1];
  const yTeto = teto && max ? H - (teto / max) * H : null;

  return (
    <figure className="fin-ritmo">
      <div className="fin-ritmo-area">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Gasto acumulado do mês">
          <defs>
            <linearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-forest)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--color-forest)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} className="fin-ritmo-grade" vectorEffect="non-scaling-stroke" />
          ))}
          {antes.length > 1 && <path d={caminho(antes)} className="fin-linha-antes" vectorEffect="non-scaling-stroke" />}
          {yTeto !== null && <line x1={0} x2={W} y1={yTeto} y2={yTeto} className="fin-linha-teto" vectorEffect="non-scaling-stroke" />}
          {atual.length > 1 && <path d={area(atual, caixa)} fill={`url(#${grad})`} />}
          {atual.length > 1 && <path d={caminho(atual)} className="fin-linha-atual" vectorEffect="non-scaling-stroke" />}
        </svg>
        {/* o ponto é HTML e não <circle>: com preserveAspectRatio="none" o círculo viraria elipse */}
        {ultimo && max > 0 && <i className="fin-ritmo-ponto" style={{ left: `${(ultimo[0] / W) * 100}%`, top: `${(ultimo[1] / H) * 100}%` }} />}
      </div>
      <figcaption className="fin-legenda-linha">
        <span><i className="atual" /> este mês</span>
        <span><i className="antes" /> mês passado</span>
        {teto ? <span><i className="teto" /> limite</span> : null}
      </figcaption>
    </figure>
  );
}

export interface Parte {
  nome: string;
  valor: number;
  /** classe de cor (`fixas`, `parcelas`, `metas`, `livre`, `sobra`) */
  classe: string;
}

/** Barra empilhada de "Como o mês se divide" (§6.1.5). Escala: o maior entre total e base. */
export function BarraEmpilhada({ partes, escala }: { partes: Parte[]; escala: number }) {
  const visiveis = partes.filter((p) => p.valor > 0);
  return (
    <div className="fin-empilhada" role="img" aria-label={visiveis.map((p) => `${p.nome} ${brl(p.valor)}`).join(", ")}>
      {visiveis.map((p) => (
        <i key={p.nome} className={p.classe} style={{ width: `${largura(p.valor, escala)}%` }} />
      ))}
    </div>
  );
}

const CW = 540;
const CH = 170;
const BASE = 146;

/** Colunas do histórico (§6.7): gasto e entrada por mês, mesma escala; mês atual tracejado. */
export function ColunasHistorico({ meses }: { meses: { mes: string; gasto: number; entrada: number; atual: boolean }[] }) {
  const max = Math.max(1, ...meses.flatMap((m) => [m.gasto, m.entrada]));
  const passo = CW / Math.max(1, meses.length);
  const bw = Math.min(14, passo / 3);
  const altura = (v: number) => (Math.max(0, v) / max) * (BASE - 8);
  return (
    <div className="fin-colunas">
      <svg viewBox={`0 0 ${CW} ${CH}`} role="img" aria-label="Saídas e entradas dos últimos 12 meses">
        {meses.map((m, i) => {
          const cx = passo * i + passo / 2;
          const hg = altura(m.gasto);
          const he = altura(m.entrada);
          return (
            <g key={m.mes}>
              <title>{`${mesCurto(m.mes)}: saídas ${valorSemPrefixo(m.gasto)}, entradas ${valorSemPrefixo(m.entrada)}`}</title>
              {m.atual && <rect x={cx - passo / 2 + 3} y={2} width={passo - 6} height={BASE + 20} rx={6} className="fin-coluna-atual" />}
              <rect x={cx - bw - 1} y={BASE - hg} width={bw} height={hg} rx={2} className="fin-coluna fin-col-saida" />
              <rect x={cx + 1} y={BASE - he} width={bw} height={he} rx={2} className="fin-coluna fin-col-entrada" />
              <text x={cx} y={BASE + 16} textAnchor="middle" className="fin-coluna-rotulo">{mesCurto(m.mes)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
