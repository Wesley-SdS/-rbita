"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { quandoLegivel, type CartaoDaTela, type ItemDeCartao, type TipoDeCartao } from "@orbita/core/chat/cartoes-da-tela";
import { Icone } from "./icones";

/**
 * UM cartão que a Órbita abriu: o mesmo desenho dentro da mensagem do chat e
 * solto na mesa da voz. Ele não sabe de onde veio; o formato é um só
 * (`chat/cartoes-da-tela.ts`). Na mesa, o cabeçalho é a alça de arrastar e
 * recebe os botões de minimizar e fechar por `acoes`.
 *
 * Link de item abre em aba nova e sem `opener`: a página do e-mail ou da
 * notícia não ganha acesso à Órbita.
 */

export const ICONE_DO_TIPO: Record<TipoDeCartao, string> = {
  emails: "mail",
  agenda: "calendar",
  tarefas: "check",
  jira: "check",
  noticias: "spark",
  clima: "sun",
  financas: "wallet",
  contas: "wallet",
  cotacao: "wallet",
  rota: "flow",
  aniversarios: "calendar",
  presenca: "home",
  trabalho: "flow",
  fontes: "search",
  externo: "flow",
};

function Item({ item }: { item: ItemDeCartao }) {
  const corpo = (
    <>
      <span className="cartao-item-linha">
        <strong className="cartao-item-titulo">{item.titulo}</strong>
        {item.valor ? <span className="cartao-item-valor">{item.valor}</span> : null}
      </span>
      {item.detalhe || item.quando ? (
        <span className="cartao-item-detalhe">
          {item.quando ? <span className={`cartao-quando${item.marca === "atrasado" ? " atrasado" : ""}`}>{quandoLegivel(item.quando)}</span> : null}
          {item.detalhe ? <span>{item.detalhe}</span> : null}
        </span>
      ) : null}
      {item.texto ? <span className="cartao-item-texto">{item.texto}</span> : null}
    </>
  );
  const classe = `cartao-item${item.marca ? ` ${item.marca}` : ""}`;
  return (
    <li className={classe}>
      {item.url ? (
        <a href={item.url} target="_blank" rel="noopener noreferrer">
          {corpo}
        </a>
      ) : (
        <div>{corpo}</div>
      )}
    </li>
  );
}

export function CartaoDaTelaView({
  cartao,
  acoes,
  cabecaProps,
  corpo = true,
}: {
  cartao: CartaoDaTela;
  /** os botões do canto (minimizar, fechar), só na mesa */
  acoes?: ReactNode;
  /** a alça de arrastar: na mesa, o cabeçalho recebe os eventos de ponteiro */
  cabecaProps?: React.HTMLAttributes<HTMLElement>;
  /** minimizado mostra só o cabeçalho */
  corpo?: boolean;
}) {
  const [aba, setAba] = useState(cartao.grupos?.find((g) => g.total > 0)?.id ?? cartao.grupos?.[0]?.id ?? null);
  const itens = cartao.grupos && aba ? cartao.itens.filter((i) => i.grupo === aba) : cartao.itens;
  return (
    <article className={`cartao-tela tipo-${cartao.tipo}`} aria-label={cartao.titulo}>
      <header className="cartao-cabeca" {...cabecaProps}>
        <span className="cartao-icone" aria-hidden="true">
          <Icone nome={ICONE_DO_TIPO[cartao.tipo] ?? "spark"} />
        </span>
        <span className="cartao-titulos">
          <strong>{cartao.titulo}</strong>
          {cartao.resumo ? <small>{cartao.resumo}</small> : null}
        </span>
        {acoes ? <span className="cartao-acoes">{acoes}</span> : null}
      </header>
      {corpo && cartao.grupos?.length ? (
        <div className="cartao-abas" role="tablist" aria-label={`Abas de ${cartao.titulo}`}>
          {cartao.grupos.map((g) => (
            <button key={g.id} type="button" role="tab" aria-selected={aba === g.id} className={aba === g.id ? "ativa" : ""} onClick={() => setAba(g.id)}>
              {g.rotulo}
              <span className="cartao-aba-total">{g.total}</span>
            </button>
          ))}
        </div>
      ) : null}
      {corpo ? (
        <div className="cartao-corpo">
          {cartao.destaque ? (
            <div className="cartao-destaque">
              <strong>{cartao.destaque.valor}</strong>
              {cartao.destaque.rotulo ? <span>{cartao.destaque.rotulo}</span> : null}
            </div>
          ) : null}
          {itens.length ? (
            <ul className="cartao-itens">
              {itens.map((it, i) => (
                <Item key={`${it.titulo}-${i}`} item={it} />
              ))}
            </ul>
          ) : !cartao.destaque && cartao.vazio ? (
            <p className="cartao-vazio">{cartao.vazio}</p>
          ) : null}
          {cartao.abrir ? (
            <Link className="text-button cartao-abrir" href={cartao.abrir}>
              Abrir na Órbita <Icone nome="arrow-right" />
            </Link>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
