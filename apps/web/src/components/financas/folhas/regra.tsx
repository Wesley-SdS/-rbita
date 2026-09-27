"use client";

import { useState } from "react";
import type { Regra } from "@/lib/financas/tipos";
import { useFinancas } from "../contexto";
import { BotaoApagar, BotaoPrincipal, Campo, Folha, SeletorCategoria, Texto } from "../primitivos";

/** Nova regra / Editar regra de categorização (PRD §7.16). */
export function FolhaRegra({ regra }: { regra?: Regra }) {
  const f = useFinancas();
  const cad = f.cad;
  const [contem, setContem] = useState(regra?.contem ?? "");
  const [categoriaId, setCategoriaId] = useState(regra?.categoriaId ?? cad?.categorias[0]?.id ?? "");

  return (
    <Folha titulo={regra ? "Editar regra" : "Nova regra"} aoFechar={f.fechar}>
      <Texto>Quando a descrição de um lançamento importado contiver este texto, a categoria abaixo é sugerida.</Texto>
      <Campo rotulo="Se a descrição contiver">
        <input type="text" placeholder="IFOOD" value={contem} maxLength={120} autoFocus={!regra} onChange={(e) => setContem(e.target.value)} />
      </Campo>
      <SeletorCategoria rotulo="Usar a categoria" valor={categoriaId} aoMudar={setCategoriaId} categorias={cad?.categorias ?? []} marcarEntrada />
      <BotaoPrincipal onClick={() => void f.executar({ tipo: "salvar_regra", id: regra?.id ?? null, contem, categoriaId })}>Salvar</BotaoPrincipal>
      {regra && <BotaoApagar onClick={() => void f.executar({ tipo: "apagar_regra", id: regra.id })}>Apagar regra</BotaoApagar>}
    </Folha>
  );
}
