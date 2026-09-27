"use client";

import { useEffect, useRef, useState } from "react";
import { assistirPrevia, type PreviaDaCamera } from "@/lib/camera/aparelho";

/**
 * O QUADRADINHO NO CANTO: o que a Órbita está olhando, agora.
 *
 * Pedido do dono depois do primeiro teste com a câmera no modo de voz: a webcam
 * acendia, ele ouvia a descrição e não via nada. "Poderia abrir no canto
 * inferior direito o quadrado mostrando a imagem em tempo real do vídeo."
 *
 * Mostra dois momentos, e a diferença entre eles importa: com a câmera ABERTA é
 * vídeo ao vivo (o ponto vermelho pulsa), e depois de fechar fica a FOTO que de
 * fato subiu, com a luz da câmera já apagada. Ver a foto é o que responde "o que
 * ela olhou?"; ver o vídeo é o que responde "ela está olhando agora?".
 *
 * Mora na casca do app, e não na tela do chat, porque a câmera abre de três
 * lugares (chat, voz em tempo real, Presença) e o dono precisa ver em todos.
 */
export function PreviaDaCameraNoCanto() {
  const [previa, setPrevia] = useState<PreviaDaCamera>({ stream: null, foto: null });
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => assistirPrevia(setPrevia), []);

  // o `srcObject` é propriedade do elemento, não atributo: o React não sabe
  // escrevê-lo por JSX, e sem isto o vídeo ficaria preto
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.srcObject !== previa.stream) v.srcObject = previa.stream;
    if (previa.stream) void v.play().catch(() => undefined);
  }, [previa.stream]);

  const aoVivo = Boolean(previa.stream);
  if (!aoVivo && !previa.foto) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 overflow-hidden rounded-xl"
      style={{
        // ACIMA DE TUDO, e isto foi medido: com `z-50` a prévia existia e
        // ficava invisível no modo foco, porque `.focus-overlay` é
        // `z-index: 60`. As camadas deste app são 30 e 35 (topo e barra), 60
        // (modo foco), 79 e 80 (menu no celular) e 100 (aviso). A prévia é a
        // luz de "a câmera está aberta": ela não pode ser coberta por NENHUMA
        // delas, nem por um aviso passageiro.
        zIndex: 101,
        width: 184,
        background: "var(--color-surface, #111)",
        border: "1px solid var(--color-line, rgba(255,255,255,.14))",
        boxShadow: "0 10px 30px rgba(0,0,0,.35)",
      }}
    >
      <div className="relative" style={{ aspectRatio: "4 / 3", background: "#000" }}>
        {aoVivo ? (
          <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- data URL local, não passa pelo otimizador
          <img src={previa.foto ?? ""} alt="Último quadro que a Órbita olhou" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="flex items-center gap-2 px-2.5 py-1.5" style={{ fontSize: 11.5 }}>
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            background: aoVivo ? "#ef4444" : "var(--color-ink-dim, #9aa)",
            animation: aoVivo ? "orbita-previa-pulso 1.2s ease-in-out infinite" : undefined,
          }}
        />
        <span style={{ color: "var(--color-ink-dim, #9aa)" }}>{aoVivo ? "Órbita está olhando" : "Foi isto que ela olhou"}</span>
      </div>
      <style>{"@keyframes orbita-previa-pulso{0%,100%{opacity:1}50%{opacity:.25}}"}</style>
    </div>
  );
}
