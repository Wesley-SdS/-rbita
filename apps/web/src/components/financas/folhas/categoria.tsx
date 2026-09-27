"use client";

import { useState } from "react";
import { PALETA } from "@orbita/core/finance/padroes";
import type { Categoria } from "@/lib/financas/tipos";
import { useFinancas } from "../contexto";
import { Alternador, BotaoApagar, BotaoPrincipal, Campo, CampoDinheiro, Folha, Paleta } from "../primitivos";
import { corAleatoria } from "./cor";

/** Nova categoria / Editar categoria (PRD §7.13). */
export function FolhaCategoria({ categoria }: { categoria?: Categoria }) {
  const f = useFinancas();
  const [nome, setNome] = useState(categoria?.nome ?? "");
  const [natureza, setNatureza] = useState<"despesa" | "receita">(categoria?.natureza ?? "despesa");
  const [orcamento, setOrcamento] = useState(categoria?.orcamento ?? 0);
  // cor sorteada UMA vez, ao abrir: sortear a cada render trocaria a cor sob o dedo
  const [cor, setCor] = useState(() => categoria?.cor ?? corAleatoria());

  async function apagar() {
    if (!window.confirm(`Apagar a categoria ${categoria!.nome}?`)) return;
    await f.executar({ tipo: "apagar_categoria", id: categoria!.id });
  }

  return (
    <Folha titulo={categoria ? "Editar categoria" : "Nova categoria"} aoFechar={f.fechar}>
      <Campo rotulo="Nome">
        <input type="text" value={nome} maxLength={120} autoFocus={!categoria} onChange={(e) => setNome(e.target.value)} />
      </Campo>
      {!categoria && (
        <Alternador<"despesa" | "receita">
          rotulo="Tipo"
          valor={natureza}
          aoMudar={setNatureza}
          opcoes={[{ id: "despesa", rotulo: "Saída", tom: "saida" }, { id: "receita", rotulo: "Entrada", tom: "entrada" }]}
        />
      )}
      <CampoDinheiro rotulo="Orçamento do mês (opcional)" valor={orcamento} aoMudar={setOrcamento} />
      <Paleta cores={PALETA} valor={cor} aoMudar={setCor} />
      <BotaoPrincipal onClick={() => void f.executar({ tipo: "salvar_categoria", id: categoria?.id ?? null, nome, natureza, orcamento, cor })}>Salvar</BotaoPrincipal>
      {categoria && <BotaoApagar onClick={() => void apagar()}>Apagar categoria</BotaoApagar>}
    </Folha>
  );
}
