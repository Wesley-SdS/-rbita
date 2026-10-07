"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { mesa, vazia, type NaMesa } from "@/lib/mesa/mesa";
import { CartaoDaTelaView, ICONE_DO_TIPO } from "./cartao-da-tela";
import { Icone } from "./icones";

/**
 * A mesa: os cartões que a Órbita abriu falando, soltos por cima da tela.
 *
 * Montada uma vez na casca, então sobrevive à troca de rota e aparece por
 * cima do Modo foco. Na Conversa ela some: ali os cartões já estão dentro das
 * mensagens, e janelas por cima do chat cobririam o que se está lendo.
 *
 * No computador cada cartão é uma janela (arrasta pelo cabeçalho, ou pelas
 * setas com o cabeçalho em foco). No celular não há onde soltar uma janela:
 * os cartões viram uma pilha no rodapé, que rola por dentro.
 */

const ESTREITA = "(max-width: 700px)";
const SEM_ESTADO = vazia();

function useEstreita() {
  const [estreita, setEstreita] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(ESTREITA);
    const atualizar = () => setEstreita(mq.matches);
    atualizar();
    mq.addEventListener("change", atualizar);
    return () => mq.removeEventListener("change", atualizar);
  }, []);
  return estreita;
}

function Minimizar() {
  // traço único, no mesmo peso dos ícones do Presença
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 12h12" />
    </svg>
  );
}

function Janela({ item, maxAbertos, solta }: { item: NaMesa; maxAbertos: number; solta: boolean }) {
  const { cartao } = item;
  const arraste = useRef<{ dx: number; dy: number; id: number } | null>(null);

  const cabecaProps: React.HTMLAttributes<HTMLElement> = solta
    ? {
        tabIndex: 0,
        role: "group",
        "aria-roledescription": "cartão arrastável",
        title: "Arraste para mover. Com o cabeçalho em foco, as setas também movem.",
        onPointerDown: (e) => {
          // os botões do canto não começam arraste
          if ((e.target as HTMLElement).closest("button, a") || e.button !== 0) return;
          mesa.paraFrente(cartao.id);
          arraste.current = { dx: e.clientX - item.x, dy: e.clientY - item.y, id: e.pointerId };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          e.preventDefault();
        },
        onPointerMove: (e) => {
          const a = arraste.current;
          if (!a || a.id !== e.pointerId) return;
          mesa.mover(cartao.id, e.clientX - a.dx, e.clientY - a.dy);
        },
        onPointerUp: (e) => {
          if (!arraste.current) return;
          arraste.current = null;
          (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
          mesa.soltar(cartao.id);
        },
        onKeyDown: (e) => {
          const passo = e.shiftKey ? 64 : 24;
          const d = { ArrowLeft: [-passo, 0], ArrowRight: [passo, 0], ArrowUp: [0, -passo], ArrowDown: [0, passo] }[e.key];
          if (!d) return;
          e.preventDefault();
          mesa.mover(cartao.id, item.x + d[0]!, item.y + d[1]!);
          mesa.soltar(cartao.id);
        },
      }
    : {};

  return (
    <div
      className="mesa-cartao"
      style={solta ? { left: item.x, top: item.y, zIndex: item.z } : undefined}
      onPointerDownCapture={() => solta && mesa.paraFrente(cartao.id)}
    >
      <CartaoDaTelaView
        cartao={cartao}
        cabecaProps={cabecaProps}
        acoes={
          <>
            <button type="button" className="icon-button" aria-label={`Minimizar ${cartao.titulo}`} title="Minimizar" onClick={() => mesa.alternarMinimizado(cartao.id, maxAbertos)}>
              <Minimizar />
            </button>
            <button type="button" className="icon-button" aria-label={`Fechar ${cartao.titulo}`} title="Fechar" onClick={() => mesa.fechar(cartao.id)}>
              <Icone nome="close" />
            </button>
          </>
        }
      />
    </div>
  );
}

export function MesaDeCartoes({ maxAbertos }: { maxAbertos: number }) {
  const estado = useSyncExternalStore(mesa.ouvir, mesa.ler, () => SEM_ESTADO);
  const caminho = usePathname() ?? "";
  const estreita = useEstreita();

  if (!estado.cartoes.length || caminho.startsWith("/app/conversa")) return null;
  const abertos = estado.cartoes.filter((c) => !c.minimizado);
  const minimizados = estado.cartoes.filter((c) => c.minimizado);

  return (
    <div className={`mesa${estreita ? " estreita" : ""}`} aria-label="Cartões que a Órbita abriu">
      {estreita ? (
        abertos.length ? (
          <div className="mesa-pilha">
            {[...abertos].sort((a, b) => b.z - a.z).map((c) => (
              <Janela key={c.cartao.id} item={c} maxAbertos={maxAbertos} solta={false} />
            ))}
          </div>
        ) : null
      ) : (
        abertos.map((c) => <Janela key={c.cartao.id} item={c} maxAbertos={maxAbertos} solta />)
      )}
      <div className="mesa-bandeja" role="toolbar" aria-label="Bandeja de cartões">
        {minimizados.map((c) => (
          <button key={c.cartao.id} type="button" className="mesa-ficha" onClick={() => mesa.alternarMinimizado(c.cartao.id, maxAbertos)} title={`Abrir ${c.cartao.titulo}`}>
            <Icone nome={ICONE_DO_TIPO[c.cartao.tipo] ?? "spark"} />
            <span>{c.cartao.titulo}</span>
          </button>
        ))}
        <button type="button" className="mesa-ficha limpar" onClick={() => mesa.limpar()} title="Fechar todos os cartões">
          <Icone nome="close" />
          <span>Limpar a mesa</span>
        </button>
      </div>
    </div>
  );
}
