"use client";

import { useEffect, useRef, useState } from "react";
import { invalidar } from "@/lib/dados/recurso";
import { Icone } from "@/components/presenca/icones";
import { CameraDoAparelho, cameraAutorizada, definirAutorizacao, nomeDaCameraDoAparelho } from "@/lib/camera/aparelho";

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

/**
 * Por que a câmera não abriu.
 *
 * O navegador distingue três casos bem diferentes e a primeira versão dizia a
 * mesma frase para todos ("libere o acesso"), o que não ajuda quem tem a
 * câmera ocupada por outro programa nem quem não tem câmera.
 */
function motivoDaCamera(e: unknown): string {
  const nome = e instanceof DOMException ? e.name : "";
  if (nome === "NotAllowedError" || nome === "SecurityError") {
    return "O navegador bloqueou o acesso à câmera. Clique no cadeado ao lado do endereço e permita a câmera para este site.";
  }
  if (nome === "NotFoundError" || nome === "OverconstrainedError") {
    return "Não encontrei nenhuma câmera neste aparelho.";
  }
  if (nome === "NotReadableError" || nome === "AbortError") {
    return "A câmera existe, mas outro programa está usando ela agora (Teams, Meet, Zoom). Feche o outro e tente de novo.";
  }
  return "Não consegui abrir a câmera deste aparelho.";
}

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
  const [autorizada, setAutorizada] = useState(false);
  const capturaRef = useRef<CameraDoAparelho | null>(null);
  const previaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const guardada = localStorage.getItem(CHAVE);
      if (guardada) setEscolhida(guardada);
      setAutorizada(cameraAutorizada());
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

  /**
   * Cadastra a câmera deste aparelho, quando ainda não existe nenhuma.
   *
   * A primeira versão exigia cadastrar antes e escolher depois, como se faz
   * com uma câmera do Frigate. Para a webcam do próprio aparelho isso é
   * burocracia sem motivo: resultado medido, ninguém cadastrou nada e a
   * Órbita seguiu dizendo (corretamente) que não tinha câmera.
   */
  async function garantirCamera(): Promise<string | null> {
    if (cam) return cam.id;
    const nome = nomeDaCameraDoAparelho();
    const r = await fetch("/api/cameras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nome }),
    }).catch(() => null);
    const d = (await r?.json().catch(() => ({}))) as { id?: string; error?: string } | undefined;
    if (!r?.ok || !d?.id) {
      setRecado({ texto: d?.error ?? "Não consegui cadastrar a câmera deste aparelho.", atencao: true });
      return null;
    }
    escolher(d.id);
    // criar a câmera do próprio aparelho JÁ é o consentimento; obrigar a um
    // segundo interruptor depois disso é burocracia sem ganho de privacidade
    definirAutorizacao(true);
    setAutorizada(true);
    invalidar("/api/cameras");
    return d.id;
  }

  async function alternar() {
    if (capturaRef.current?.ativa) {
      capturaRef.current.parar();
      capturaRef.current = null;
      setLigada(false);
      setRecado(null);
      return;
    }
    const cameraId = await garantirCamera();
    if (!cameraId) return;

    const captura = new CameraDoAparelho(cameraId, {
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
    } catch (e) {
      setRecado({ texto: motivoDaCamera(e), atencao: true });
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

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button className={`button ${ligada ? "secondary" : "primary"} compacto`} onClick={() => void alternar()} disabled={!ligada && cam ? !cam.enabled : false}>
          <Icone nome={ligada ? "stop" : "play"} />
          {ligada ? "Parar de enviar" : cam ? "Começar a enviar" : "Ligar a câmera deste aparelho"}
        </button>
        {cameras.length > 1 && (
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
        )}
        {ligada && (
          <span className="text-[13px]" style={{ color: "var(--color-ink-dim)" }}>
            {enviados} quadro(s) enviado(s)
          </span>
        )}
      </div>

      {cam && !cam.enabled && !ligada && (
        <p className="mt-2 text-[13px]" style={{ color: "var(--color-ink-dim)" }}>
          Essa câmera está desligada. Ligue na lista abaixo para poder enviar.
        </p>
      )}
      {/* Isto dispensa o botão no meio da conversa. A câmera NÃO fica ligada e
          NÃO tira foto a cada mensagem: ela abre só quando o pedido exigiu ver
          ("o que estou segurando?"), por uma fração de segundo. */}
      {cam && (
        <label className="switch-row" style={{ marginTop: 12 }}>
          <input
            type="checkbox"
            checked={autorizada}
            onChange={(e) => {
              definirAutorizacao(e.target.checked);
              setAutorizada(e.target.checked);
            }}
          />
          <span>
            <Icone nome="spark" />
            Abrir a câmera quando eu pedir algo que precise dela
          </span>
        </label>
      )}
      {autorizada && (
        <p className="mt-1 text-[13px]" style={{ color: "var(--color-ink-dim)" }}>
          A câmera abre só no momento em que a Órbita precisa ver, e fecha em seguida. Sem isso, ela pergunta antes e você clica.
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
