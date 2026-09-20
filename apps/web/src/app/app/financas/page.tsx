"use client";

import dynamic from "next/dynamic";
import { TituloDaVista, Abas } from "@/components/presenca/vista";

function Esqueleto() {
  return <div className="panel empty-state">Carregando…</div>;
}

const FinancePanel = dynamic(() => import("@/components/finance-panel").then((m) => m.FinancePanel), { ssr: false, loading: Esqueleto });
const TodoPanel = dynamic(() => import("@/components/todo-panel").then((m) => m.TodoPanel), { ssr: false, loading: Esqueleto });

export default function PaginaFinancas() {
  return (
    <section className="view">
      <TituloDaVista
        sobrancelha="CLAREZA PARA ESCOLHER"
        titulo="Seu dinheiro, em perspectiva"
        subtitulo="Um olhar simples para as finanças e para o que ainda precisa da sua mão."
      />
      <Abas
        abas={[
          { id: "financas", rotulo: "Finanças", conteudo: <FinancePanel /> },
          { id: "tarefas", rotulo: "Tarefas", conteudo: <TodoPanel /> },
        ]}
      />
    </section>
  );
}
