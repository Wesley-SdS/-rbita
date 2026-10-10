"use client";

import { useEffect, useState } from "react";
import type { CartaoDaTela } from "@orbita/core/chat/cartoes-da-tela";
import { CartaoDaTelaView, ICONE_DO_TIPO } from "./cartao-da-tela";
import { Icone } from "./icones";
import { QuadroTela } from "./quadro-tela";

/**
 * O PAINEL LATERAL dos cartões da conversa, no desenho do Adalink-Agents-Pipeline
 * (pedido do dono, 09/10/2026): dentro da mensagem fica só um atalho (`CartaoAtalho`);
 * o cartão abre aqui ao lado, com espaço para as abas e a lista, e expande para a
 * tela inteira. Na tela estreita ele já abre por cima de tudo.
 *
 * Os cartões da mesma resposta ficam juntos: dá para passar de um para o outro
 * sem voltar à mensagem.
 */

export function PainelDeCartoes({ cartoes, ativo, aoEscolher, aoFechar }: { cartoes: CartaoDaTela[]; ativo: string; aoEscolher: (id: string) => void; aoFechar: () => void }) {
  const [telaCheia, setTelaCheia] = useState(false);
  const cartao = cartoes.find((c) => c.id === ativo) ?? cartoes[0];

  useEffect(() => {
    // Esc sai da tela cheia; se não estiver nela, fecha o painel
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (telaCheia) setTelaCheia(false);
      else aoFechar();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [telaCheia, aoFechar]);

  if (!cartao) return null;
  return (
    <aside className={`panel painel-artefato${telaCheia ? " tela-cheia" : ""}`} aria-label={`Cartão: ${cartao.titulo}`}>
      <div className="painel-artefato-barra">
        {cartoes.length > 1 ? (
          <div className="painel-artefato-escolha" role="tablist" aria-label="Cartões desta resposta">
            {cartoes.map((c) => (
              <button key={c.id} type="button" role="tab" aria-selected={c.id === cartao.id} className={c.id === cartao.id ? "ativo" : ""} onClick={() => aoEscolher(c.id)} title={c.titulo}>
                <Icone nome={ICONE_DO_TIPO[c.tipo] ?? "spark"} />
                <span>{c.titulo}</span>
              </button>
            ))}
          </div>
        ) : (
          <span className="painel-artefato-nome">Aberto pela Órbita</span>
        )}
        <button type="button" className="icon-button" onClick={() => setTelaCheia((v) => !v)} aria-label={telaCheia ? "Sair da tela cheia" : "Expandir para a tela inteira"} title={telaCheia ? "Sair da tela cheia (Esc)" : "Tela inteira"}>
          <Icone nome={telaCheia ? "collapse" : "expand"} />
        </button>
        <button type="button" className="icon-button" onClick={aoFechar} aria-label="Fechar o painel" title="Fechar (Esc)">
          <Icone nome="close" />
        </button>
      </div>
      <div className="painel-artefato-corpo">
        {/* o quadro abre DE VERDADE no painel (colunas e arrastar), não como lista;
            os outros cartões, como cartão. key: trocar de cartão recomeça a aba */}
        {cartao.id === "quadro:chamados" || cartao.id === "quadro:gestao" ? (
          <QuadroTela key={cartao.id} inicial={cartao.id === "quadro:gestao" ? "gestao" : "chamados"} noPainel />
        ) : (
          <CartaoDaTelaView key={cartao.id} cartao={cartao} />
        )}
      </div>
    </aside>
  );
}

/** O atalho dentro da mensagem: ícone, título e resumo; o clique abre o painel. */
export function CartaoAtalho({ cartao, aberto, aoAbrir }: { cartao: CartaoDaTela; aberto: boolean; aoAbrir: () => void }) {
  return (
    <button type="button" className={`cartao-atalho${aberto ? " aberto" : ""}`} onClick={aoAbrir} aria-pressed={aberto} title={`Abrir ${cartao.titulo}`}>
      <span className="cartao-icone" aria-hidden="true">
        <Icone nome={ICONE_DO_TIPO[cartao.tipo] ?? "spark"} />
      </span>
      <span className="cartao-titulos">
        <strong>{cartao.titulo}</strong>
        {cartao.resumo ? <small>{cartao.resumo}</small> : cartao.destaque ? <small>{[cartao.destaque.valor, cartao.destaque.rotulo].filter(Boolean).join(" ")}</small> : null}
      </span>
      <Icone nome="arrow-right" />
    </button>
  );
}
