"use client";

import { useEffect, useRef, useState } from "react";
import { invalidar } from "@/lib/dados/recurso";
import { Icone } from "@/components/presenca/icones";
import { CameraDoAparelho } from "@/lib/camera/aparelho";

/**
 * Transforma a webcam deste aparelho numa câmera da casa.
 *
 * A escolha de qual câmera este aparelho alimenta fica no `localStorage`
 * porque é preferência DO APARELHO, não da conta: o mesmo dono num notebook e
 * num tablet alimenta câmeras diferentes. É um id, não um segredo — o token do
 * webhook continua sem nunca chegar ao navegador.
 *
 * Nada começa sozinho. A captura só roda com a aba aberta e depois de um
 * clique, e some quando a tela é fechada.
 */
const CHAVE = "orbita.cameraDoAparelho";

interface CameraRow {
  id: string;
  name: string;
  enabled: boolean;
  identifyFaces: boolean;
}

export function CameraDesteAparelho({ cameras }: { cameras: CameraRow[] }) {
  const [escolhida, setEscolhida] = useState("");
  const [ligada, setLigada] = useState(false);
  const [recado, setRecado] = useState<{ texto: string; atencao?: boolean } | null>(null);
  const [enviados, setEnviados] = useState(0);
  const capturaRef = useRef<CameraDoAparelho | null>(null);
  const previaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const guardada = localStorage.getItem(CHAVE);
      if (guardada) setEscolhida(guardada);
    } catch {
      /* navegador sem storage: só não lembra da escolha */
    }
  }, []);

  // parar ao desmontar não é opcional: sem isto a webcam fica acesa depois de
  // trocar de tela, com a luz ligada e ninguém olhando
  useEffect(() => {
    return () => {
      capturaRef.current?.parar();
      capturaRef.current = null;
    };
  }, []);

  const cam = cameras.find((c) => c.id === escolhida) ?? null;

  function escolher(id: string) {
    setEscolhida(id);
    try {
      if (id) localStorage.setItem(CHAVE, id);
      else localStorage.removeItem(CHAVE);
    } catch {
      /* segue sem lembrar */
    }
  }

  async function alternar() {
    if (capturaRef.current?.ativa) {
      capturaRef.current.parar();
      capturaRef.current = null;
      setLigada(false);
      setRecado(null);
      return;
    }
    if (!cam) return;

    const captura = new CameraDoAparelho(cam.id, {
      aoEnviar: (kb) => {
        setEnviados((n) => n + 1);
        setRecado({ texto: `Último quadro enviado com ${kb} KB.` });
      },
      aoFalhar: (texto) => setRecado({ texto, atencao: true }),
    });
    try {
      await captura.iniciar();
      capturaRef.current = captura;
      setLigada(true);
      setEnviados(0);
      // a prévia é o mesmo <video> que está sendo capturado: mostrar outro
      // seria mostrar uma coisa e enviar outra
      const v = captura.previa;
      if (v && previaRef.current) {
        v.className = "camera-previa";
        previaRef.current.replaceChildren(v);
      }
      // a Órbita passa a ter uma câmera: a lista e o histórico mudam
      invalidar("/api/cameras", "/api/cameras/events");
    } catch {
      setRecado({ texto: "Preciso da câmera para isso. Libere o acesso no navegador e tente de novo.", atencao: true });
    }
  }

  return (
    <div className="rounded-lg border p-2" style={{ borderColor: "var(--color-line)" }}>
      <p className="flex items-center gap-2">
        <Icone nome="expand" />
        <b>A câmera deste aparelho</b>
      </p>
      <p className="mt-1 text-[14px]" style={{ color: "var(--color-ink-dim)" }}>
        Enquanto esta aba estiver aberta, o aparelho manda um quadro de vez em quando para a câmera escolhida. É o que
        faz a Órbita enxergar aqui sem precisar de um Frigate.
      </p>

      {cameras.length === 0 ? (
        <p className="mt-2 text-[14px]" style={{ color: "var(--color-ink-dim)" }}>
          Cadastre uma câmera abaixo primeiro (pode chamar de “Notebook”), e depois escolha ela aqui.
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            className="inline-input compacto"
            value={escolhida}
            onChange={(e) => escolher(e.target.value)}
            disabled={ligada}
            aria-label="Câmera que este aparelho alimenta"
          >
            <option value="">Escolha a câmera…</option>
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.enabled ? "" : " (desligada)"}
              </option>
            ))}
          </select>
          <button className={`button ${ligada ? "secondary" : "primary"} compacto`} onClick={() => void alternar()} disabled={!cam || (!ligada && !cam.enabled)}>
            <Icone nome={ligada ? "stop" : "play"} />
            {ligada ? "Parar de enviar" : "Começar a enviar"}
          </button>
          {ligada && (
            <span className="text-[13px]" style={{ color: "var(--color-ink-dim)" }}>
              {enviados} quadro(s) enviado(s)
            </span>
          )}
        </div>
      )}

      {cam && !cam.enabled && !ligada && (
        <p className="mt-2 text-[13px]" style={{ color: "var(--color-ink-dim)" }}>
          Essa câmera está desligada. Ligue na lista abaixo para poder enviar.
        </p>
      )}
      {cam?.identifyFaces && (
        <p className="mt-2 text-[13px]" style={{ color: "var(--color-ink-dim)" }}>
          Essa câmera identifica quem aparece, então a narração dela usa só modelo local e nada vai para a nuvem.
        </p>
      )}

      <div ref={previaRef} className="camera-previa-caixa" />

      {recado && (
        <div className={`aviso-ameno ${recado.atencao ? "atencao" : ""}`} style={{ marginTop: 10 }}>
          <span>{recado.texto}</span>
        </div>
      )}
    </div>
  );
}
