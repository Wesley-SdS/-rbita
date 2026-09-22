"use client";

import { useEffect, useRef } from "react";
import type { OrbMode } from "@/components/console/types";

/**
 * O núcleo da Órbita: geometria 3D em WebGL, com o renderizador Canvas 2D como
 * plano B. O desenho em si vive em `lib/presenca/motor-*.js`, portado do
 * protótipo sem alterações de arte.
 *
 * O motor cuida do próprio laço: pausa fora da tela e com a aba oculta, limita
 * a densidade de pixels e respeita movimento reduzido. Aqui só cuidamos de
 * montar, desmontar e repassar o estado.
 */

export type EstadoNucleo =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "searching"
  | "connecting"
  | "executing"
  | "success"
  | "attention"
  | "error";

/**
 * Como o estado do console vira estado visual do núcleo.
 *
 * Mora aqui, junto do tipo, porque agora são DUAS telas desenhando a mesma
 * Órbita (a Conversa e o Modo foco): com uma cópia em cada uma, elas
 * divergiriam no primeiro estado novo.
 */
export const ESTADO_DO_MODO: Record<OrbMode, EstadoNucleo> = {
  standby: "idle",
  listening: "listening",
  speaking: "speaking",
  searching: "searching",
  studying: "thinking",
  connecting: "connecting",
};

interface Motor {
  setState(modo: string): void;
  setReduced(reduzido: boolean): void;
  resize(): void;
  destruir(): void;
  intensity: number;
}

export function Nucleo({
  estado = "idle",
  reduzido = false,
  intensidade = 85,
  className = "",
}: {
  estado?: EstadoNucleo;
  reduzido?: boolean;
  /** Em PORCENTAGEM (15 a 100), como na tela de Preferências. */
  intensidade?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const motorRef = useRef<Motor | null>(null);
  // O efeito de montagem não deve depender destes, senão remonta o WebGL a cada
  // mudança de estado (recompilar shader por token de resposta seria absurdo).
  const inicial = useRef({ estado, reduzido, intensidade });

  useEffect(() => {
    let vivo = true;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Import dinâmico: são ~40 KB de shader e malha que não fazem falta no
    // primeiro paint, e o módulo só funciona no navegador.
    void import("@/lib/presenca/motor-webgl.js").then((mod) => {
      if (!vivo) return;
      const motor = new mod.Nucleo(canvas) as Motor;
      motorRef.current = motor;
      // O motor trabalha de 0 a 1; a configuração é em por cento, como o
      // controle que o dono vê. Passar 85 em vez de 0,85 dá cem vezes mais
      // energia: o núcleo vira um emaranhado denso em vez de vidro translúcido.
      motor.intensity = inicial.current.intensidade / 100;
      motor.setReduced(inicial.current.reduzido);
      motor.setState(inicial.current.estado);
    });

    return () => {
      vivo = false;
      motorRef.current?.destruir();
      motorRef.current = null;
    };
  }, []);

  useEffect(() => {
    motorRef.current?.setState(estado);
  }, [estado]);

  useEffect(() => {
    motorRef.current?.setReduced(reduzido);
  }, [reduzido]);

  useEffect(() => {
    if (motorRef.current) motorRef.current.intensity = intensidade / 100;
  }, [intensidade]);

  return (
    <canvas
      ref={canvasRef}
      id="orb-canvas"
      className={className}
      role="img"
      aria-label="Núcleo da Órbita"
    />
  );
}
