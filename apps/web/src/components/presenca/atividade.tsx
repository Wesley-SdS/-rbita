"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icone } from "./icones";

const ActionsPanel = dynamic(() => import("@/components/actions-panel").then((m) => m.ActionsPanel), { ssr: false });

interface Notificacao {
  id: string;
  title?: string;
  content?: string;
  /** Para onde o aviso leva, quando leva a algum lugar. */
  destino?: string | null;
  createdAt?: string;
  read?: boolean;
}

/**
 * Gaveta de atividade: o que está esperando você e o que já aconteceu.
 *
 * O topo é a fila de aprovações, que é a defesa do §5.1: a Órbita nunca envia
 * e-mail nem cria evento sozinha, só enfileira a proposta. Por isso ela abre
 * primeiro, antes do histórico.
 */
export function Atividade({ aberta, aoFechar }: { aberta: boolean; aoFechar: () => void }) {
  const router = useRouter();
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (!aberta) return;
    setCarregando(true);
    fetch("/api/notifications")
      .then((r) => (r.ok ? r.json() : { notifications: [] }))
      .then((d: { notifications?: Notificacao[] }) => setNotificacoes(d.notifications ?? []))
      .catch(() => setNotificacoes([]))
      .finally(() => setCarregando(false));
  }, [aberta]);

  async function marcarLida(id: string) {
    setNotificacoes((lista) => lista.map((n) => (n.id === id ? { ...n, read: true } : n)));
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  }

  async function marcarTodasLidas() {
    setNotificacoes((lista) => lista.map((n) => ({ ...n, read: true })));
    await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
  }

  /* Abrir um aviso faz as duas coisas de uma vez: marca como lido e leva ao
     lugar onde aquilo se resolve. Um aviso que não leva a lugar nenhum obriga a
     pessoa a refazer sozinha o caminho que o aviso já conhecia. */
  function abrir(n: Notificacao) {
    void marcarLida(n.id);
    if (!n.destino) return;
    aoFechar();
    router.push(n.destino);
  }

  const naoLidas = notificacoes.filter((n) => !n.read).length;

  if (!aberta) return null;

  return (
    <div className="gaveta-fundo" onClick={aoFechar} role="presentation">
      <aside
        className="drawer aberta"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Atividade e aprovações"
      >
        <div className="drawer-head">
          <div>
            <span className="eyebrow">TRANSPARÊNCIA, SEM RUÍDO</span>
            <h2>O que está acontecendo.</h2>
          </div>
          <button className="icon-button" onClick={aoFechar} aria-label="Fechar atividade">
            <Icone nome="close" />
          </button>
        </div>

        <p className="drawer-intro">
          Um lugar para entender os passos da Órbita e escolher o que pode acontecer depois.
        </p>

        <ActionsPanel />

        <div className="section-heading" style={{ marginTop: 26, marginBottom: 12 }}>
          <div className="panel-label" style={{ marginBottom: 0 }}>
            TRILHA DE ATIVIDADE
          </div>
          {naoLidas > 0 && (
            <button className="text-button" onClick={marcarTodasLidas}>
              Marcar todas como lidas
            </button>
          )}
        </div>

        {carregando ? (
          <div className="empty-state">Carregando…</div>
        ) : notificacoes.length === 0 ? (
          <div className="empty-state">Nada por aqui ainda. É bom sinal.</div>
        ) : (
          notificacoes.map((n) => (
            <button
              key={n.id}
              className={`activity-item aviso ${n.read ? "lido" : ""} ${n.destino ? "navega" : ""}`}
              onClick={() => abrir(n)}
              title={n.destino ? "Abrir onde isso se resolve" : "Marcar como lido"}
            >
              <span>
                <Icone nome={n.read ? "check" : "spark"} />
              </span>
              <div>
                <strong>{n.title || "Aviso"}</strong>
                {n.content && <p>{n.content}</p>}
                <small>
                  {n.createdAt
                    ? new Date(n.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                    : ""}
                </small>
              </div>
              {n.destino && <Icone nome="arrow-up-right" />}
            </button>
          ))
        )}
      </aside>
    </div>
  );
}
