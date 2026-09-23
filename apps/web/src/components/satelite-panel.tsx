"use client";

import { useEffect, useRef, useState } from "react";
import { useRecurso, invalidar } from "@/lib/dados/recurso";
import { Icone } from "@/components/presenca/icones";
import { diagnosticarVoz, type JanelaSuficiente } from "@/lib/voice/contexto-seguro";
import { TelaAcesa } from "@/lib/voice/tela-acesa";
import { DEVICE_ID_STORAGE_KEY, getOwnDeviceId } from "@/lib/device-id";

/**
 * MODO SATÉLITE: o celular velho vira o ouvido de um cômodo.
 *
 * É o satélite de graça, antes de comprar hardware: um aparelho no
 * carregador, com esta tela aberta, escutando "Ei Órbita". O que ele precisa,
 * e que uma tela comum não dá:
 *
 *   1. a tela não pode dormir, senão o navegador suspende o áudio e ele
 *      emudece sem avisar (ver `tela-acesa.ts`);
 *   2. a tela não pode iluminar a cozinha a noite toda, então o repouso é
 *      quase preto e só acende quando ele ouve;
 *   3. ele precisa saber em que cômodo está, senão "apaga a luz daqui" não
 *      tem "aqui".
 *
 * Isto NÃO substitui o hardware dedicado: o navegador escuta pior e o aparelho
 * fica preso nesta tela. Serve para descobrir se voz por cômodo é mesmo o que
 * o dono quer, sem gastar nada.
 */

interface Comodo {
  id: string;
  nome?: string;
  name?: string;
}
interface Aparelho {
  id: string;
  name: string;
  kind: string;
  roomId: string | null;
}

export function SatelitePanel() {
  const [diag] = useState(() =>
    typeof window === "undefined" ? null : diagnosticarVoz(window as unknown as JanelaSuficiente),
  );
  const { dado: dadosAparelhos } = useRecurso<{ devices: Aparelho[] }>("/api/devices");
  const { dado: dadosComodos } = useRecurso<{ rooms?: Comodo[]; comodos?: Comodo[] }>("/api/home/rooms");
  const comodos = dadosComodos?.rooms ?? dadosComodos?.comodos ?? [];

  const [ativo, setAtivo] = useState(false);
  const [telaSegura, setTelaSegura] = useState<boolean | null>(null);
  const [ouvindo, setOuvindo] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);
  const [agora, setAgora] = useState(() => new Date());
  const telaRef = useRef<TelaAcesa | null>(null);

  const meuId = typeof window === "undefined" ? null : getOwnDeviceId();
  const meuAparelho = dadosAparelhos?.devices.find((d) => d.id === meuId) ?? null;
  const comodoAtual = comodos.find((c) => c.id === meuAparelho?.roomId);
  const nomeDoComodo = comodoAtual?.nome ?? comodoAtual?.name ?? null;

  // relógio: com a tela quase apagada, é o único sinal de que está vivo
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 20_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    return () => void telaRef.current?.desligar();
  }, []);

  async function ligar() {
    setRecado(null);
    telaRef.current ??= new TelaAcesa();
    const ok = await telaRef.current.ligar();
    setTelaSegura(ok);
    setAtivo(true);
    if (!ok) setRecado("Este navegador não segura a tela acesa. Deixe o aparelho com o bloqueio automático desligado.");
  }

  async function desligar() {
    await telaRef.current?.desligar();
    setAtivo(false);
    setTelaSegura(null);
  }

  /** Cadastra este aparelho como satélite de um cômodo. */
  async function fixarComodo(roomId: string) {
    const nome = nomeSugerido(comodos.find((c) => c.id === roomId));
    try {
      if (meuAparelho) {
        await fetch("/api/devices", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: meuAparelho.id, roomId, kind: "satelite" }),
        });
      } else {
        const r = await fetch("/api/devices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: nome, kind: "satelite", roomId }),
        });
        const novo = (await r.json()) as { id?: string };
        // o id fica no aparelho: é ele que o chat manda para saber onde é "aqui"
        if (novo.id) localStorage.setItem(DEVICE_ID_STORAGE_KEY, novo.id);
      }
      invalidar("/api/devices");
    } catch {
      setRecado("Não consegui guardar o cômodo deste aparelho.");
    }
  }

  if (diag && !diag.podeGravar) {
    return (
      <article className="panel">
        <h2>O modo satélite não funciona neste endereço</h2>
        <p className="description">{diag.motivo}</p>
        {diag.sugestao && (
          <p className="description">
            No computador, abra <strong>{diag.sugestao}</strong>. Para usar o celular, a Órbita precisa ser servida por HTTPS.
          </p>
        )}
        <div className="notice">
          É a mesma razão pela qual criar conta pelo iPhone falha: sem HTTPS o navegador não guarda a sessão nem libera o microfone.
        </div>
      </article>
    );
  }

  if (ativo) {
    return (
      <div className="satelite-repouso" onClick={() => void desligar()} role="button" tabIndex={0} aria-label="Sair do modo satélite">
        <div className="satelite-orbe" data-ouvindo={ouvindo ? "sim" : "nao"} />
        <p className="satelite-hora">{agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
        <p className="satelite-local">{nomeDoComodo ? `ouvindo na ${nomeDoComodo}` : "ouvindo"}</p>
        {telaSegura === false && <p className="satelite-aviso">a tela pode apagar sozinha</p>}
        <p className="satelite-sair">toque para sair</p>
      </div>
    );
  }

  return (
    <article className="panel">
      <h2>Modo satélite</h2>
      <p className="description">
        Deixe este aparelho no carregador, num cômodo, com esta tela aberta. Ele fica escutando “Ei Órbita” e responde pelo
        próprio alto-falante. A tela fica quase apagada para não iluminar o ambiente.
      </p>

      <p className="panel-label" style={{ marginTop: 20 }}>
        EM QUE CÔMODO ESTE APARELHO ESTÁ
      </p>
      {comodos.length === 0 ? (
        <div className="notice">
          Nenhum cômodo cadastrado ainda. Sem isso a Órbita ainda escuta, mas “apaga a luz daqui” não sabe onde é aqui.
        </div>
      ) : (
        <div className="mapa-filtros" style={{ marginTop: 0 }}>
          {comodos.map((c) => {
            const id = c.id;
            const nome = c.nome ?? c.name ?? "Cômodo";
            return (
              <button
                key={id}
                className={`filter-chip ${meuAparelho?.roomId === id ? "active" : ""}`}
                onClick={() => void fixarComodo(id)}
              >
                {nome}
              </button>
            );
          })}
        </div>
      )}

      {recado && <div className="notice">{recado}</div>}

      <div className="conta-botoes">
        <button className="button primary" onClick={() => void ligar()}>
          <Icone nome="wave" />
          Entrar no modo satélite
        </button>
      </div>

      <div className="notice" style={{ marginTop: 18 }}>
        O navegador escuta pior que um aparelho dedicado, e este fica preso nesta tela. Serve para você descobrir se voz por
        cômodo é o que quer, antes de comprar hardware.
      </div>
    </article>
  );
}

function nomeSugerido(c: Comodo | undefined): string {
  const nome = c?.nome ?? c?.name;
  return nome ? `Satélite da ${nome}` : "Satélite";
}
