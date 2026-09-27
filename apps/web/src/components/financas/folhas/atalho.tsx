"use client";

import { useState } from "react";
import { juntarOnde, separarOnde } from "@/lib/financas/apresentacao";
import type { Atalho } from "@/lib/financas/tipos";
import { useFinancas } from "../contexto";
import { BotaoApagar, BotaoPrincipal, Campo, CampoDinheiro, Folha, SeletorCategoria, SeletorOnde, primeiraCategoria } from "../primitivos";

/** Novo / Editar atalho de um toque (PRD §7.5). Apagar não pede confirmação, como no PRD. */
export function FolhaAtalho({ atalho }: { atalho?: Atalho }) {
  const f = useFinancas();
  const cad = f.cad;
  const [rotulo, setRotulo] = useState(atalho?.rotulo ?? "");
  const [valor, setValor] = useState(atalho?.valor ?? 0);
  const [categoriaId, setCategoriaId] = useState(atalho ? (atalho.categoriaId ?? "") : primeiraCategoria(cad?.categorias, "despesa"));
  const [onde, setOnde] = useState(atalho ? juntarOnde(atalho.contaId, atalho.cartaoId) : juntarOnde(cad?.contas[0]?.id, null));

  async function salvar() {
    const { contaId, cartaoId } = separarOnde(onde);
    await f.executar({ tipo: "salvar_atalho", id: atalho?.id ?? null, rotulo, valor, categoriaId: categoriaId || null, contaId, cartaoId });
  }

  return (
    <Folha titulo={atalho ? "Editar atalho" : "Novo atalho"} aoFechar={f.fechar}>
      <Campo rotulo="Nome do atalho">
        <input type="text" placeholder="Almoço" value={rotulo} maxLength={120} autoFocus onChange={(e) => setRotulo(e.target.value)} />
      </Campo>
      <CampoDinheiro rotulo="Valor" valor={valor} aoMudar={setValor} grande />
      <SeletorCategoria valor={categoriaId} aoMudar={setCategoriaId} categorias={cad?.categorias ?? []} natureza="despesa" />
      <SeletorOnde rotulo="Pago com" valor={onde} aoMudar={setOnde} contas={cad?.contas ?? []} cartoes={cad?.cartoes ?? []} />
      <BotaoPrincipal onClick={() => void salvar()}>Salvar</BotaoPrincipal>
      {atalho && <BotaoApagar onClick={() => void f.executar({ tipo: "apagar_atalho", id: atalho.id })}>Apagar atalho</BotaoApagar>}
    </Folha>
  );
}
