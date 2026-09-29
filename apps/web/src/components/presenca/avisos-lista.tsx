"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { definirDado, invalidar, useRecurso } from "@/lib/dados/recurso";
import { Icone } from "./icones";

export interface Aviso {
  id: string;
  title?: string;
  content?: string;
  /** Para onde o aviso leva, quando leva a algum lugar. */
  destino?: string | null;
  createdAt?: string;
  read?: boolean;
}
interface Pagina {
  notifications: Aviso[];
  unread?: number;
  temMais?: boolean;
}

const quando = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

/**
 * A lista de avisos do sino e da tela de Rotinas.
 *
 * Antes o texto saía cru e cortado: o briefing da manhã, que é markdown com
 * lista e negrito, virava três linhas de asteriscos sem fim. Agora cada aviso
 * mostra o começo e abre inteiro no clique, em markdown. Abrir é o que marca
 * como lido; IR ao lugar do aviso virou botão próprio, porque um clique que
 * navegava não deixava ler o aviso que levava a algum lugar.
 *
 * `de`: "todos" é o sino; "pedidos" é o que o dono pediu (rotinas e regras dele).
 */
export function AvisosLista({ de, ativo = true, aoNavegar }: { de: "todos" | "pedidos"; ativo?: boolean; aoNavegar?: () => void }) {
  const router = useRouter();
  const [soNaoLidas, setSoNaoLidas] = useState(false);
  const chave = `/api/notifications?de=${de}${soNaoLidas ? "&naoLidas=1" : ""}`;
  const { dado, carregando } = useRecurso<Pagina>(chave, { ativo });
  // páginas além da primeira ficam aqui: o cache guarda a primeira, que é a que
  // se atualiza sozinha; "carregar mais" é da visita, não da tela
  const [mais, setMais] = useState<Aviso[]>([]);
  const [temMaisExtra, setTemMaisExtra] = useState<boolean | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    setMais([]);
    setTemMaisExtra(null);
  }, [chave]);

  const primeira = dado?.notifications ?? [];
  const vistos = new Set(primeira.map((a) => a.id));
  const avisos = [...primeira, ...mais.filter((a) => !vistos.has(a.id))];
  const temMais = temMaisExtra ?? dado?.temMais ?? false;
  const naoLidas = dado?.unread ?? avisos.filter((a) => !a.read).length;

  function riscar(ids: Set<string> | "todos") {
    const lido = (a: Aviso) => (ids === "todos" || ids.has(a.id) ? { ...a, read: true } : a);
    definirDado<Pagina>(chave, (atual) => ({
      ...(atual ?? { notifications: [] }),
      notifications: (atual?.notifications ?? []).map(lido),
      unread: ids === "todos" ? 0 : Math.max(0, (atual?.unread ?? 0) - 1),
    }));
    setMais((m) => m.map(lido));
  }

  async function marcarLida(a: Aviso) {
    if (a.read) return;
    riscar(new Set([a.id]));
    await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: a.id }) }).catch(() => {});
    // o sino e a tela de Rotinas leem chaves diferentes: o prefixo pega as duas
    invalidar("/api/notifications");
  }

  async function marcarTodas() {
    riscar("todos");
    await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
    invalidar("/api/notifications");
  }

  async function carregarMais() {
    const ultimo = avisos.at(-1)?.createdAt;
    if (!ultimo || buscando) return;
    setBuscando(true);
    try {
      const r = await fetch(`${chave}&antes=${encodeURIComponent(new Date(ultimo).toISOString())}`);
      if (!r.ok) return;
      const p = (await r.json()) as Pagina;
      setMais((m) => [...m, ...p.notifications]);
      setTemMaisExtra(!!p.temMais);
    } finally {
      setBuscando(false);
    }
  }

  function alternar(a: Aviso) {
    setAberto((atual) => (atual === a.id ? null : a.id));
    void marcarLida(a);
  }

  function ir(a: Aviso) {
    if (!a.destino) return;
    void marcarLida(a);
    aoNavegar?.();
    router.push(a.destino);
  }

  return (
    <div className="avisos">
      <div className="avisos-barra">
        <div className="avisos-filtro" role="group" aria-label="Filtrar avisos">
          <button type="button" className={!soNaoLidas ? "ativo" : ""} onClick={() => setSoNaoLidas(false)} aria-pressed={!soNaoLidas}>
            Todos
          </button>
          <button type="button" className={soNaoLidas ? "ativo" : ""} onClick={() => setSoNaoLidas(true)} aria-pressed={soNaoLidas}>
            Não lidos{naoLidas > 0 ? ` (${naoLidas})` : ""}
          </button>
        </div>
        {naoLidas > 0 && (
          <button type="button" className="text-button" onClick={() => void marcarTodas()}>
            Marcar todos como lidos
          </button>
        )}
      </div>

      {carregando && !dado ? (
        <div className="empty-state">Carregando…</div>
      ) : avisos.length === 0 ? (
        <div className="empty-state">
          {soNaoLidas ? "Tudo lido." : de === "pedidos" ? "Suas rotinas ainda não trouxeram nada." : "Nada por aqui ainda. É bom sinal."}
        </div>
      ) : (
        <ul className="avisos-itens">
          {avisos.map((a) => {
            const expandido = aberto === a.id;
            return (
              <li key={a.id} className={`aviso-item ${a.read ? "lido" : ""} ${expandido ? "aberto" : ""}`}>
                <button type="button" className="aviso-cabeca" onClick={() => alternar(a)} aria-expanded={expandido}>
                  <span className="aviso-ponto" aria-hidden />
                  <span className="aviso-titulo">
                    <strong>{a.title || "Aviso"}</strong>
                    <small>{quando(a.createdAt)}</small>
                  </span>
                  <Icone nome="arrow-right" />
                </button>
                {a.content && (
                  <div className={`aviso-corpo ${expandido ? "" : "resumido"}`} onClick={() => !expandido && alternar(a)}>
                    <Markdown>{a.content}</Markdown>
                  </div>
                )}
                {expandido && a.destino && (
                  <div className="aviso-acoes">
                    <button type="button" className="button secondary compacto" onClick={() => ir(a)}>
                      <Icone nome="arrow-up-right" />
                      Abrir onde isso se resolve
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {temMais && (
        <button type="button" className="button secondary compacto avisos-mais" onClick={() => void carregarMais()} disabled={buscando}>
          {buscando ? "Carregando…" : "Carregar mais"}
        </button>
      )}
    </div>
  );
}
