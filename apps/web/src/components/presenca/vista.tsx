"use client";

import { useState } from "react";

/**
 * Cabeçalho de tela do Presença: sobrancelha, título com o ponto menta e uma
 * linha de contexto. Toda tela abre igual, e é isso que faz o conjunto parecer
 * um produto só em vez de oito páginas parecidas.
 */
export function TituloDaVista({
  sobrancelha,
  titulo,
  subtitulo,
  acao,
}: {
  sobrancelha: string;
  titulo: string;
  subtitulo: string;
  acao?: React.ReactNode;
}) {
  return (
    <div className="view-heading">
      <div>
        <span className="eyebrow">{sobrancelha}</span>
        <h1>
          {titulo}
          <span className="mint-period">.</span>
        </h1>
        <p>{subtitulo}</p>
      </div>
      {acao}
    </div>
  );
}

export interface Aba {
  id: string;
  rotulo: string;
  conteudo: React.ReactNode;
}

/**
 * Abas de uma seção.
 *
 * Existem porque o app tem mais assuntos do que o protótipo previu telas: Casa
 * reúne ambientes, pessoas, câmeras e acompanhamento, e Preferências reúne
 * nove painéis. Virar item de menu para cada um encheria a barra lateral, que
 * é justamente o que a proposta quis esvaziar.
 *
 * Só a aba ativa é montada: os painéis buscam dados ao montar, e montar os
 * nove de Preferências de uma vez traria nove requisições que ninguém pediu.
 */
export function Abas({ abas, inicial }: { abas: Aba[]; inicial?: string }) {
  const [ativa, setAtiva] = useState(inicial ?? abas[0]?.id ?? "");
  const atual = abas.find((a) => a.id === ativa) ?? abas[0];

  return (
    <>
      <div className="filter-bar" role="tablist">
        {abas.map((a) => (
          <button
            key={a.id}
            role="tab"
            aria-selected={a.id === atual?.id}
            className={`filter-chip ${a.id === atual?.id ? "active" : ""}`}
            onClick={() => setAtiva(a.id)}
          >
            {a.rotulo}
          </button>
        ))}
      </div>
      <div role="tabpanel">{atual?.conteudo}</div>
    </>
  );
}
