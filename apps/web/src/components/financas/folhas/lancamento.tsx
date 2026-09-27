"use client";

import { useRef, useState } from "react";
import { brl } from "@orbita/core/finance/formato";
import { useFinancas } from "../contexto";
import {
  Alternador, BotaoApagar, BotaoPrincipal, Caixa, Campo, CampoDinheiro, Duas, Folha, SeletorCategoria, SeletorOnde, Texto, primeiraCategoria,
} from "../primitivos";
import { juntarOnde, separarOnde } from "@/lib/financas/apresentacao";
import type { LinhaDeLancamento } from "@/lib/financas/tipos";

type Tipo = "despesa" | "receita" | "transferencia";

/** Novo lançamento / Editar lançamento (PRD §7.1). */
export function FolhaLancamento({ lanc, cartaoId }: { lanc?: LinhaDeLancamento; cartaoId?: string }) {
  const f = useFinancas();
  const cad = f.cad;
  const edicao = !!lanc;
  const [natureza, setNatureza] = useState<"despesa" | "receita">(lanc?.natureza ?? "despesa");
  const [valor, setValor] = useState(lanc?.valor ?? 0);
  const [estorno, setEstorno] = useState(lanc?.estorno ?? false);
  const [categoriaId, setCategoriaId] = useState(lanc ? (lanc.categoriaId ?? "") : primeiraCategoria(cad?.categorias, "despesa"));
  const [onde, setOnde] = useState(
    lanc ? juntarOnde(lanc.contaId, lanc.cartaoId) : cartaoId ? juntarOnde(null, cartaoId) : juntarOnde(cad?.contas[0]?.id, null),
  );
  const [parcelas, setParcelas] = useState(1);
  const [data, setData] = useState(lanc?.data ?? f.hoje);
  const [descricao, setDescricao] = useState(lanc?.descricao ?? "");
  const [atalho, setAtalho] = useState(false);
  const valorRef = useRef<HTMLInputElement>(null);

  // entrada comum lista categorias de entrada; estorno lista as de SAÍDA,
  // porque o dinheiro que voltou abate o gasto daquela categoria (§7.1 item 4)
  const naturezaDaCategoria = natureza === "receita" && !estorno ? "receita" : "despesa";
  const noCartao = onde.startsWith("cartao:");
  const parcelado = !edicao && natureza === "despesa" && noCartao && parcelas > 1;
  const ehParcela = (lanc?.parcelaDe ?? 0) > 1;

  function trocarTipo(t: Tipo) {
    if (t === "transferencia") return f.abrir({ tipo: "transferencia" });
    setNatureza(t);
    const est = t === "receita" ? estorno : false;
    if (t === "despesa") setEstorno(false);
    setCategoriaId(primeiraCategoria(cad?.categorias, t === "receita" && !est ? "receita" : "despesa"));
    // entrada não entra em cartão: volta para a primeira conta
    if (t === "receita" && onde.startsWith("cartao:")) setOnde(juntarOnde(cad?.contas[0]?.id, null));
    if (t === "receita") setParcelas(1);
  }

  function marcarEstorno(v: boolean) {
    setEstorno(v);
    setCategoriaId(primeiraCategoria(cad?.categorias, v ? "despesa" : "receita"));
  }

  function mudarOnde(v: string) {
    setOnde(v);
    if (!v.startsWith("cartao:")) setParcelas(1);
  }

  async function salvar() {
    if (valor <= 0) {
      valorRef.current?.focus();
      return f.avisar("Informe um valor maior que zero.");
    }
    const { contaId, cartaoId: cId } = separarOnde(onde);
    const comum = { natureza, valor, data, descricao: descricao.trim() || null, categoriaId: categoriaId || null, contaId, cartaoId: cId, estorno: natureza === "receita" && estorno };
    await f.executar(
      edicao
        ? { tipo: "editar_lancamento", id: lanc!.id, ...comum }
        : { tipo: "lancar", ...comum, parcelas: parcelado ? parcelas : 1, guardarAtalho: atalho && natureza === "despesa" && !parcelado },
    );
  }

  async function apagar() {
    if (!window.confirm("Apagar este lançamento?")) return;
    await f.executar({ tipo: "apagar_lancamento", id: lanc!.id });
  }

  async function apagarParcelas() {
    if (!lanc?.grupoParcela) return;
    if (!window.confirm(`Apagar todas as ${lanc.parcelaDe} parcelas desta compra?`)) return;
    await f.executar({ tipo: "apagar_parcelas", grupo: lanc.grupoParcela });
  }

  const opcoesTipo = [
    { id: "despesa" as Tipo, rotulo: "Saída", tom: "saida" as const },
    { id: "receita" as Tipo, rotulo: "Entrada", tom: "entrada" as const },
    ...(edicao ? [] : [{ id: "transferencia" as Tipo, rotulo: "Transfer." }]),
  ];

  return (
    <Folha titulo={edicao ? "Editar lançamento" : "Novo lançamento"} aoFechar={f.fechar}>
      {ehParcela && <Texto>Parcela {lanc!.parcelaN} de {lanc!.parcelaDe}. Alterar aqui muda só esta parcela.</Texto>}
      <Alternador<Tipo> rotulo="Tipo" opcoes={opcoesTipo} valor={natureza} aoMudar={trocarTipo} />
      <CampoDinheiro rotulo="Valor" valor={valor} aoMudar={setValor} grande autoFocus entrada={valorRef} />
      {natureza === "receita" && <Caixa rotulo="É estorno ou reembolso de um gasto" marcado={estorno} aoMudar={marcarEstorno} />}
      <SeletorCategoria
        rotulo={natureza === "receita" && estorno ? "Categoria do gasto que voltou" : "Categoria"}
        valor={categoriaId}
        aoMudar={setCategoriaId}
        categorias={cad?.categorias ?? []}
        natureza={naturezaDaCategoria}
      />
      <SeletorOnde rotulo="Pago com" valor={onde} aoMudar={mudarOnde} contas={cad?.contas ?? []} cartoes={natureza === "despesa" ? (cad?.cartoes ?? []) : []} />
      {!edicao && natureza === "despesa" && noCartao && (
        <Campo
          rotulo="Parcelas"
          dica={parcelas > 1 && valor > 0 ? `${parcelas}x de ${brl(Math.floor(valor / parcelas))}, lançadas uma por mês a partir da data escolhida.` : undefined}
        >
          <select value={parcelas} onChange={(e) => setParcelas(Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}x</option>)}
          </select>
        </Campo>
      )}
      <Duas>
        <Campo rotulo="Data">
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </Campo>
        <Campo rotulo="Descrição">
          <input type="text" placeholder="opcional" value={descricao} maxLength={200} onChange={(e) => setDescricao(e.target.value)} />
        </Campo>
      </Duas>
      {!edicao && <Caixa rotulo="Guardar como atalho de um toque" marcado={atalho} aoMudar={setAtalho} />}
      <BotaoPrincipal onClick={() => void salvar()}>{edicao ? "Salvar alterações" : "Lançar"}</BotaoPrincipal>
      {edicao && <BotaoApagar onClick={() => void apagar()}>Apagar lançamento</BotaoApagar>}
      {edicao && ehParcela && lanc!.grupoParcela && (
        <>
          <button type="button" className="button secondary full-width" onClick={() => f.abrir({ tipo: "parcelas", lanc: lanc! })}>
            Editar as {lanc!.parcelaDe} parcelas de uma vez
          </button>
          <BotaoApagar onClick={() => void apagarParcelas()}>Apagar as {lanc!.parcelaDe} parcelas</BotaoApagar>
        </>
      )}
    </Folha>
  );
}
