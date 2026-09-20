"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icone } from "./icones";
import { Nucleo } from "./nucleo";
import { ESTADOS_NUCLEO } from "./estados";

const formatar = (segundos: number) =>
  `${String(Math.floor(segundos / 60)).padStart(2, "0")}:${String(segundos % 60).padStart(2, "0")}`;

/**
 * Modo foco: um bloco de tempo, uma coisa de cada vez.
 *
 * A contagem é feita por PRAZO (`Date.now()` de destino) e não decrementando um
 * contador: o navegador estrangula `setInterval` em aba oculta, e um contador
 * decrescente atrasaria minutos enquanto a pessoa está justamente fora da aba,
 * que é o que o modo foco quer que aconteça.
 */
export function ModoFoco({
  aberto,
  aoFechar,
  minutos,
  intensidade,
  reduzido,
}: {
  aberto: boolean;
  aoFechar: () => void;
  minutos: number;
  intensidade: number;
  reduzido: boolean;
}) {
  const router = useRouter();
  const total = minutos * 60;
  const [restante, setRestante] = useState(total);
  const [rodando, setRodando] = useState(false);
  const prazo = useRef(0);

  // Trocar a duração nas Preferências precisa valer no próximo bloco, mas não
  // pode encurtar um foco que já está correndo.
  useEffect(() => {
    if (!rodando) setRestante(total);
  }, [total, rodando]);

  useEffect(() => {
    if (!rodando) return;
    const id = setInterval(() => {
      const falta = Math.max(0, Math.ceil((prazo.current - Date.now()) / 1000));
      setRestante(falta);
      if (falta === 0) setRodando(false);
    }, 250);
    return () => clearInterval(id);
  }, [rodando]);

  // Sem isto a página de trás rola junto e a tela ganha duas barras de rolagem.
  useEffect(() => {
    if (!aberto) return;
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = antes;
    };
  }, [aberto]);

  const alternar = useCallback(() => {
    setRodando((estava) => {
      if (estava) return false;
      prazo.current = Date.now() + (restante || total) * 1000;
      if (!restante) setRestante(total);
      return true;
    });
  }, [restante, total]);

  if (!aberto) return null;

  const terminou = restante === 0;

  return (
    <div className="focus-overlay" role="dialog" aria-modal="true" aria-label="Modo foco">
      <header>
        <span className="brand">
          <span className="brand-symbol" aria-hidden="true" />
          <span>
            órbita<span className="brand-period">.</span>
          </span>
        </span>
        <span className="focus-eyebrow">SÓ VOCÊ. UMA COISA DE CADA VEZ.</span>
        <button className="icon-button" onClick={aoFechar} aria-label="Sair do modo foco">
          <Icone nome="close" />
        </button>
      </header>

      <div id="focus-stage-slot">
        <div className="orb-stage">
          <Nucleo estado={rodando ? "thinking" : terminou ? "success" : "idle"} intensidade={intensidade} reduzido={reduzido} />
        </div>
      </div>

      <div className="focus-copy">
        <span className="eyebrow">{(rodando ? ESTADOS_NUCLEO.thinking.status : terminou ? ESTADOS_NUCLEO.success.status : ESTADOS_NUCLEO.idle.status).toUpperCase()}</span>
        <h2>{terminou ? "Que bom. Você esteve presente." : "Espaço para estar presente."}</h2>
        <p aria-live="polite">{formatar(restante)}</p>
        <div className="focus-buttons">
          <button className="button primary" onClick={alternar}>
            <Icone nome={rodando ? "pause" : "play"} />
            {rodando ? "Pausar meu momento" : terminou ? "Mais um momento" : restante === total ? "Começar meu momento" : "Retomar meu momento"}
          </button>
          <button
            className="button secondary"
            onClick={() => {
              aoFechar();
              router.push("/app/conversa?voz=1");
            }}
          >
            <Icone nome="mic" />
            Conversar
          </button>
        </div>
        <button
          className="text-button"
          onClick={() => {
            setRodando(false);
            setRestante(total);
          }}
        >
          Recomeçar o tempo
        </button>
      </div>

      <footer>Sem notificações. Sem pressa. No seu ritmo.</footer>
    </div>
  );
}
