"use client";

import { useEffect, useState } from "react";
import { brl } from "@orbita/core/finance/formato";
import { mesDe, somarMeses } from "@orbita/core/finance/calendario";
import { useRecurso } from "@/lib/dados/recurso";
import { urlDaVista } from "@/lib/financas/api";
import { juntarOnde, semSufixoDeParcela, separarOnde } from "@/lib/financas/apresentacao";
import type { Extrato, LinhaDeLancamento } from "@/lib/financas/tipos";
import { useFinancas } from "../contexto";
import { BotaoPrincipal, Campo, CampoDinheiro, Duas, Folha, SeletorCategoria, SeletorOnde, Texto } from "../primitivos";

/**
 * Editar compra parcelada inteira (PRD §7.2). A tela só conhece a parcela
 * tocada; o total e a data da primeira saem da PARCELA 1, lida no extrato do
 * mês dela (a primeira leva os centavos que sobram da divisão, §5.18).
 */
export function FolhaParcelas({ lanc }: { lanc: LinhaDeLancamento }) {
  const f = useFinancas();
  const cad = f.cad;
  const n = lanc.parcelaDe ?? 1;
  const mesDaPrimeira = somarMeses(mesDe(lanc.data), -((lanc.parcelaN ?? 1) - 1));
  const { dado: ext } = useRecurso<Extrato>(urlDaVista("extrato", { mes: mesDaPrimeira }));
  const primeira = ext?.dias.flatMap((d) => d.itens).find((l) => l.grupoParcela === lanc.grupoParcela && l.parcelaN === 1) ?? null;

  const [total, setTotal] = useState(lanc.valor * n);
  const [parcelas, setParcelas] = useState(n);
  const [data, setData] = useState(lanc.data);
  const [categoriaId, setCategoriaId] = useState(lanc.categoriaId ?? "");
  const [onde, setOnde] = useState(juntarOnde(lanc.contaId, lanc.cartaoId));
  const [descricao, setDescricao] = useState(semSufixoDeParcela(lanc.descricao ?? ""));

  // quando a parcela 1 chega, o total e a data passam a ser os de verdade
  const idPrimeira = primeira?.id;
  useEffect(() => {
    if (!primeira) return;
    setTotal(primeira.valor + lanc.valor * (n - 1));
    setData(primeira.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idPrimeira]);

  async function refazer() {
    if (total <= 0) return f.avisar("Informe o valor total.");
    const { contaId, cartaoId } = separarOnde(onde);
    await f.executar({
      tipo: "refazer_parcelas", grupo: lanc.grupoParcela, total, parcelas, primeira: data,
      categoriaId: categoriaId || null, contaId, cartaoId, descricao: descricao.trim() || null,
    });
  }

  return (
    <Folha titulo="Editar compra parcelada" aoFechar={f.fechar}>
      <Texto>Mudar aqui refaz as parcelas inteiras, apagando as antigas e criando as novas nas datas certas.</Texto>
      <CampoDinheiro rotulo="Valor total da compra" valor={total} aoMudar={setTotal} grande autoFocus />
      <Duas>
        <Campo rotulo="Parcelas">
          <select value={parcelas} onChange={(e) => setParcelas(Number(e.target.value))}>
            {Array.from({ length: 48 }, (_, i) => i + 1).map((k) => <option key={k} value={k}>{k}x</option>)}
          </select>
        </Campo>
        <Campo rotulo="Primeira em">
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </Campo>
      </Duas>
      <SeletorCategoria valor={categoriaId} aoMudar={setCategoriaId} categorias={cad?.categorias ?? []} natureza="despesa" />
      <SeletorOnde rotulo="Pago com" valor={onde} aoMudar={setOnde} contas={cad?.contas ?? []} cartoes={cad?.cartoes ?? []} />
      <Campo rotulo="Descrição">
        <input type="text" value={descricao} maxLength={200} onChange={(e) => setDescricao(e.target.value)} />
      </Campo>
      {total > 0 && <p className="fin-dica">{parcelas}x de {brl(Math.floor(total / parcelas))}.</p>}
      <BotaoPrincipal onClick={() => void refazer()}>Refazer as parcelas</BotaoPrincipal>
    </Folha>
  );
}
