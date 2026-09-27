"use client";

import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { brl, dataCurta, mesCurto } from "@orbita/core/finance/formato";
import { Icone } from "@/components/presenca/icones";
import { centavosDoTexto, textoDoCampo, valorEmLista, type Tom } from "@/lib/financas/dinheiro";
import { juntarOnde } from "@/lib/financas/apresentacao";
import type { TomDaBarra } from "@/lib/financas/apresentacao";
import type { CartaoCadastro, Categoria, ContaCarteira, LinhaDeLancamento } from "@/lib/financas/tipos";

/**
 * As peças das finanças, desenhadas na linguagem da Órbita (Presença). Os
 * nomes das classes começam com `fin-` e moram em `presenca-app.css`.
 */

// ── folha (formulário) ─────────────────────────────────────────────────────

/**
 * Folha: sobe de baixo no celular, janela no computador (PRD §6.0.6). Vai por
 * portal para o <body> porque a aba das finanças fica dentro de um painel com
 * animação de entrada, e um `transform` no ancestral prenderia o `fixed` dentro
 * dele em vez da tela.
 */
export function Folha({ titulo, aoFechar, children }: { titulo: string; aoFechar: () => void; children: ReactNode }) {
  const id = useId();
  const caixa = useRef<HTMLDivElement>(null);
  const fechar = useRef(aoFechar);
  fechar.current = aoFechar;

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        fechar.current();
      }
    };
    document.addEventListener("keydown", aoTeclar, true);
    // a página de trás não rola junto com a folha
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // quem abriu a folha sem campo com foco automático (confirmações, listas)
    // ainda precisa que o leitor de tela entre nela
    if (!caixa.current?.contains(document.activeElement)) caixa.current?.focus();
    return () => {
      document.removeEventListener("keydown", aoTeclar, true);
      document.body.style.overflow = antes;
    };
  }, []);

  return createPortal(
    <div className="fin-veu" onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar(); }}>
      <div ref={caixa} className="fin-folha" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
        <header className="fin-folha-topo">
          <h2 id={id}>{titulo}</h2>
          <button type="button" className="icon-button" aria-label="Fechar" onClick={aoFechar}>
            <Icone nome="close" />
          </button>
        </header>
        <div className="fin-folha-corpo">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** Botão principal da folha: largo, na cor de ação. */
export function BotaoPrincipal({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="button primary full-width fin-principal" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function BotaoApagar({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="button full-width fin-apagar" onClick={onClick}>
      {children}
    </button>
  );
}

export function Texto({ children }: { children: ReactNode }) {
  return <p className="fin-texto">{children}</p>;
}

// ── campos ─────────────────────────────────────────────────────────────────

export function Campo({ rotulo, children, dica }: { rotulo: string; children: ReactNode; dica?: ReactNode }) {
  return (
    <label className="field fin-campo">
      <span className="fin-rotulo">{rotulo}</span>
      {children}
      {dica ? <small className="fin-dica">{dica}</small> : null}
    </label>
  );
}

export function Duas({ children }: { children: ReactNode }) {
  return <div className="fin-duas">{children}</div>;
}

/**
 * Campo de dinheiro com máscara de caixa registradora (§5.19): a pessoa só
 * digita números, que entram como centavos. O cursor volta sempre ao fim,
 * porque o número cresce pela direita e um cursor no meio faria o dígito
 * entrar no lugar errado.
 */
export function CampoDinheiro({
  rotulo, valor, aoMudar, grande, autoFocus, dica, entrada,
}: {
  rotulo: string;
  valor: number;
  aoMudar: (c: number) => void;
  grande?: boolean;
  autoFocus?: boolean;
  dica?: ReactNode;
  entrada?: React.Ref<HTMLInputElement>;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const texto = textoDoCampo(valor);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && document.activeElement === el) el.setSelectionRange(texto.length, texto.length);
  }, [texto]);
  return (
    <Campo rotulo={rotulo} dica={dica}>
      <input
        ref={(el) => {
          ref.current = el;
          if (typeof entrada === "function") entrada(el);
          else if (entrada) (entrada as React.MutableRefObject<HTMLInputElement | null>).current = el;
        }}
        className={`fin-dinheiro ${grande ? "grande" : ""}`}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="0,00"
        autoFocus={autoFocus}
        value={texto}
        onChange={(e) => aoMudar(centavosDoTexto(e.target.value))}
      />
    </Campo>
  );
}

export interface Opcao<T extends string> {
  id: T;
  rotulo: string;
  /** cor quando ativo: saída vermelha, entrada verde (§11.4) */
  tom?: "saida" | "entrada";
}

/** Alternador de segmentos (tipo de lançamento, sub-abas). */
export function Alternador<T extends string>({ opcoes, valor, aoMudar, rotulo }: { opcoes: Opcao<T>[]; valor: T; aoMudar: (v: T) => void; rotulo: string }) {
  return (
    <div className="fin-alternador" role="group" aria-label={rotulo}>
      {opcoes.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={o.id === valor}
          className={o.id === valor && o.tom ? `fin-alt-${o.tom}` : ""}
          onClick={() => aoMudar(o.id)}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

/** Seletor de conta ou cartão, agrupado como o PRD pede (§7). */
export function SeletorOnde({
  rotulo, valor, aoMudar, contas, cartoes, soContas, vazio,
}: {
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
  contas: ContaCarteira[];
  cartoes: CartaoCadastro[];
  soContas?: boolean;
  vazio?: string;
}) {
  return (
    <Campo rotulo={rotulo}>
      <select value={valor} onChange={(e) => aoMudar(e.target.value)}>
        {vazio !== undefined && <option value="">{vazio}</option>}
        {soContas ? (
          contas.map((c) => <option key={c.id} value={juntarOnde(c.id, null)}>{c.nome}</option>)
        ) : (
          <>
            <optgroup label="Contas">
              {contas.map((c) => <option key={c.id} value={juntarOnde(c.id, null)}>{c.nome}</option>)}
            </optgroup>
            {cartoes.length > 0 && (
              <optgroup label="Cartões de crédito">
                {cartoes.map((c) => <option key={c.id} value={juntarOnde(null, c.id)}>{c.nome}</option>)}
              </optgroup>
            )}
          </>
        )}
      </select>
    </Campo>
  );
}

export function SeletorCategoria({
  rotulo = "Categoria", valor, aoMudar, categorias, natureza, marcarEntrada,
}: {
  rotulo?: string;
  valor: string;
  aoMudar: (v: string) => void;
  categorias: Categoria[];
  natureza?: "despesa" | "receita";
  /** lista todas, com " (entrada)" nas de entrada (regras, §7.16) */
  marcarEntrada?: boolean;
}) {
  const lista = natureza ? categorias.filter((c) => c.natureza === natureza) : categorias;
  return (
    <Campo rotulo={rotulo}>
      <select value={valor} onChange={(e) => aoMudar(e.target.value)}>
        {/* o que já existe sem categoria continua sem: escolher a primeira
            da lista por conta própria gravaria uma categoria que ninguém deu */}
        {valor === "" && <option value="">Sem categoria</option>}
        {lista.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nome}
            {marcarEntrada && c.natureza === "receita" ? " (entrada)" : ""}
          </option>
        ))}
      </select>
    </Campo>
  );
}

/** Primeira categoria de uma natureza (o padrão ao trocar o tipo, §7.1). */
export const primeiraCategoria = (cats: Categoria[] | undefined, natureza: "despesa" | "receita") =>
  cats?.find((c) => c.natureza === natureza)?.id ?? "";

export function Caixa({ rotulo, marcado, aoMudar }: { rotulo: string; marcado: boolean; aoMudar: (v: boolean) => void }) {
  return (
    <label className="fin-caixa">
      <input type="checkbox" checked={marcado} onChange={(e) => aoMudar(e.target.checked)} />
      <span>{rotulo}</span>
    </label>
  );
}

/** Os 12 quadradinhos da paleta (§7.11). A cor é DADO do dono, então fica fixa entre temas. */
export function Paleta({ cores, valor, aoMudar }: { cores: readonly string[]; valor: string; aoMudar: (c: string) => void }) {
  return (
    <div className="field fin-campo">
      <span className="fin-rotulo">Cor</span>
      <div className="fin-paleta" role="radiogroup" aria-label="Cor">
        {cores.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={c.toLowerCase() === valor.toLowerCase()}
            aria-label={c}
            style={{ background: c }}
            onClick={() => aoMudar(c)}
          />
        ))}
      </div>
    </div>
  );
}

// ── exibição ───────────────────────────────────────────────────────────────

export function Pastilha({ texto, cor, foto, quadrada }: { texto: string; cor?: string | null; foto?: string | null; quadrada?: boolean }) {
  if (foto) return <img className="fin-pastilha foto" src={foto} alt="" />;
  return (
    <span className={`fin-pastilha ${quadrada ? "quadrada" : ""}`} style={{ "--cor": cor ?? "var(--color-ink-dim)" } as React.CSSProperties} aria-hidden="true">
      {texto}
    </span>
  );
}

export function Etiqueta({ tom = "neutra", children }: { tom?: "neutra" | "alerta" | "saida" | "entrada"; children: ReactNode }) {
  return <span className={`fin-etiqueta fin-e-${tom}`}>{children}</span>;
}

export function Barra({ pct, tom = "ok", cor, rotulo }: { pct: number; tom?: TomDaBarra; cor?: string; rotulo?: string }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className="fin-barra" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)} aria-label={rotulo}>
      <i className={cor ? "" : tom} style={{ width: `${p}%`, ...(cor ? { background: cor } : {}) }} />
    </div>
  );
}

export function Vazio({ titulo, texto }: { titulo: string; texto?: string }) {
  return (
    <div className="fin-vazio">
      <strong>{titulo}</strong>
      {texto ? <p>{texto}</p> : null}
    </div>
  );
}

export function Faixa({ tom, icone, children, onClick }: { tom: "urgente" | "perto" | "calmo"; icone?: string; children: ReactNode; onClick?: () => void }) {
  const conteudo = (
    <>
      <span className="fin-faixa-icone" aria-hidden="true">
        {icone === "!" ? <b>!</b> : icone === "✓" ? <Icone nome="check" /> : <Icone nome={icone ?? "info"} />}
      </span>
      <span className="fin-faixa-texto">{children}</span>
    </>
  );
  return onClick ? (
    <button type="button" className={`fin-faixa ${tom}`} onClick={onClick}>{conteudo}</button>
  ) : (
    <div className={`fin-faixa ${tom}`}>{conteudo}</div>
  );
}

export function Indicador({ rotulo, valor, tom, prefixo }: { rotulo: string; valor: number; tom?: Tom | null; prefixo?: string }) {
  return (
    <div className="fin-ind">
      <span>{rotulo}</span>
      <strong className={tom ? `fin-tom-${tom}` : ""}>{prefixo}{brl(valor)}</strong>
    </div>
  );
}

export function Valor({ centavos, natureza, transferencia }: { centavos: number; natureza: "despesa" | "receita"; transferencia?: boolean }) {
  const v = valorEmLista(centavos, natureza, transferencia);
  return <span className={`fin-valor fin-tom-${v.tom}`}>{v.texto}</span>;
}

/** Bloco com título e, à direita, um link ou um número (§6). */
export function Bloco({ titulo, direita, children, className = "" }: { titulo?: ReactNode; direita?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel fin-bloco ${className}`}>
      {titulo || direita ? (
        <header className="fin-bloco-topo">
          {titulo ? <h3>{titulo}</h3> : <span />}
          {direita}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Link({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="fin-link" onClick={onClick}>
      {children}
    </button>
  );
}

/** Linha de lançamento (§6.1.9): pastilha, título, "DD/MM · Categoria · Onde" e o valor com sinal. */
export function LinhaLancamento({ l, onClick }: { l: LinhaDeLancamento; onClick: () => void }) {
  const sub = [dataCurta(l.data), l.categoria?.nome, l.onde].filter(Boolean).join(" · ");
  return (
    <button type="button" className="fin-linha" onClick={onClick}>
      <Pastilha texto={l.categoria?.iniciais ?? "?"} cor={l.categoria?.cor} />
      <span className="fin-linha-corpo">
        <strong>{l.titulo}</strong>
        <small>{sub}</small>
      </span>
      <Valor centavos={l.valor} natureza={l.natureza} transferencia={l.transferencia} />
    </button>
  );
}

// ── navegação ──────────────────────────────────────────────────────────────

export function NavegadorDeMes({ mes, atual, aoMudar }: { mes: string; atual: string; aoMudar: (delta: -1 | 0 | 1) => void }) {
  return (
    <div className="fin-mes" role="group" aria-label="Mês">
      <button type="button" aria-label="Mês anterior" onClick={() => aoMudar(-1)}>‹</button>
      <button type="button" className={`fin-mes-rotulo ${mes === atual ? "" : "outro"}`} title="Voltar para o mês atual" aria-label={`${mesCurto(mes)}. Voltar para o mês atual`} onClick={() => aoMudar(0)}>
        {mesCurto(mes)}
      </button>
      <button type="button" aria-label="Próximo mês" onClick={() => aoMudar(1)}>›</button>
    </div>
  );
}

export function Carregando() {
  return <div className="panel fin-bloco esqueleto fin-carregando" aria-busy="true">Carregando…</div>;
}
