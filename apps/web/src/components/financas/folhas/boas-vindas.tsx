"use client";

import { useState } from "react";
import { enviarComando } from "@/lib/financas/api";
import { useFinancas } from "../contexto";
import { BotaoPrincipal, CampoDinheiro, Folha, Texto } from "../primitivos";

/**
 * Primeira vez (PRD §10). Fechar de qualquer jeito (Começar, ✕, Esc, fora)
 * marca como vista: a folha aparece UMA vez, e insistir com quem a fechou
 * seria pior do que ela não aparecer.
 */
export function FolhaBoasVindas() {
  const f = useFinancas();
  const [renda, setRenda] = useState(0);

  async function concluir() {
    f.fechar();
    if (renda > 0) await f.executar({ tipo: "definir_renda", valor: renda });
    await enviarComando({ tipo: "boas_vindas_vistas" });
  }

  return (
    <Folha titulo="Bem-vindo às Finanças" aoFechar={() => void concluir()}>
      <Texto>Três passos e o painel começa a trabalhar por você:</Texto>
      <ol className="fin-passos">
        <li><b>Diga quanto entra por mês.</b> É daí que sai o número de quanto você pode gastar hoje.</li>
        <li><b>Cadastre contas fixas e cartões</b> em Ajustes, para o painel saber o que já está comprometido.</li>
        <li><b>Lance cada gasto na hora</b> pelo botão +. Leva cinco segundos e é o que muda o jogo.</li>
      </ol>
      <Texto>Entre com a mesma conta no celular e no computador: os dados são os mesmos nos dois.</Texto>
      <CampoDinheiro rotulo="Renda do mês" valor={renda} aoMudar={setRenda} grande autoFocus />
      <BotaoPrincipal onClick={() => void concluir()}>Começar</BotaoPrincipal>
    </Folha>
  );
}
