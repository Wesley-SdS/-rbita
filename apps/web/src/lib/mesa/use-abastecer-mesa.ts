"use client";

import { useEffect, useRef } from "react";
import { cartaoDasFontes, type CartaoDaTela } from "@orbita/core/chat/cartoes-da-tela";
import type { Msg } from "@/components/console/types";
import { useCasca } from "@/components/presenca/contexto";
import { mesa } from "./mesa";

/**
 * Leva para a mesa o que a Órbita consultou numa tela de VOZ (Visão geral,
 * Modo foco), onde a conversa não aparece como chat e o cartão dentro da
 * mensagem ninguém veria.
 *
 * Cada cartão entra UMA vez, contado pelo próprio objeto: a mensagem é
 * recriada a cada pedaço do stream, mas o cartão é o mesmo. Sem isso, o
 * cartão que o dono fechou voltaria no pedaço seguinte.
 */
export function useAbastecerMesa(mensagens: Msg[]) {
  const { mesa: cfg } = useCasca();
  const vistos = useRef(new WeakSet<object>());

  useEffect(() => {
    if (!cfg.naVoz) return;
    for (const m of mensagens.slice(-3)) {
      const novos: CartaoDaTela[] = [];
      for (const c of m.cartoes ?? []) {
        if (vistos.current.has(c)) continue;
        vistos.current.add(c);
        novos.push(c);
      }
      // as notícias do tema já são cartão próprio; as fontes delas seriam o mesmo de novo
      if (m.fontes?.length && !vistos.current.has(m.fontes)) {
        vistos.current.add(m.fontes);
        const f = cartaoDasFontes(m.fontes);
        if (f && !m.cartoes?.some((c) => c.tipo === "noticias")) novos.push(f);
      }
      if (novos.length) mesa.abrir(novos, cfg.maxAbertos);
    }
  }, [mensagens, cfg]);
}
