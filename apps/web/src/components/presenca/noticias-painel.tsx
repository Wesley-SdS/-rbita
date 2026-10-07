"use client";

import { useEffect, useRef, useState } from "react";
import { Icone } from "./icones";
import { invalidar, useRecurso } from "@/lib/dados/recurso";

/**
 * NOTÍCIAS DO SEU INTERESSE, na tela inicial.
 *
 * O dono escolhe os temas aqui mesmo (não numa tela de ajuste escondida: "em
 * algum lugar eu configuro um tema"), e todo dia a Órbita percorre a web e
 * traz o que saiu de novo. A busca é trabalho de fila no servidor; a tela só
 * pede, mostra e recarrega algumas vezes enquanto as notícias chegam.
 *
 * O link de cada notícia abre em aba nova e sem `opener`: a página da matéria
 * não ganha acesso à Órbita.
 */

interface Noticia {
  id: string;
  titulo: string;
  url: string;
  site: string;
  resumo: string | null;
  encontradaEm: string;
  lida: boolean;
}
interface Tema {
  id: string;
  tema: string;
  ultimaBuscaEm: string | null;
  noticias: Noticia[];
}

const CHAVE = "/api/noticias";

/** "há 3 h", "ontem": quando a Órbita encontrou a notícia. */
function quando(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 2) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ontem" : `há ${d} dias`;
}

export function NoticiasPainel() {
  const { dado, erro } = useRecurso<{ temas: Tema[] }>(CHAVE);
  const temas = dado?.temas ?? [];
  const [ativo, setAtivo] = useState<string | null>(null);
  const [novo, setNovo] = useState("");
  const [recado, setRecado] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const recargas = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => recargas.current.forEach(clearTimeout), []);

  // a busca roda na fila: recarrega algumas vezes enquanto ela termina
  function aguardarBusca() {
    recargas.current.forEach(clearTimeout);
    recargas.current = [4_000, 10_000, 20_000, 40_000, 75_000].map((ms) => setTimeout(() => invalidar(CHAVE), ms));
  }

  function avisar(t: string) {
    setRecado(t);
    setTimeout(() => setRecado(null), 6000);
  }

  async function seguir(ev: React.FormEvent) {
    ev.preventDefault();
    const tema = novo.trim();
    if (tema.length < 2 || ocupado) return;
    setOcupado(true);
    try {
      const r = await fetch("/api/noticias/temas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tema }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return avisar(d.error ?? "Não consegui seguir esse tema.");
      setNovo("");
      setAtivo(d.tema?.id ?? null);
      invalidar(CHAVE);
      aguardarBusca();
      avisar(`Buscando as primeiras notícias sobre "${tema}".`);
    } finally {
      setOcupado(false);
    }
  }

  async function deixar(t: Tema) {
    if (!window.confirm(`Parar de acompanhar "${t.tema}"? As notícias dele saem do painel.`)) return;
    const r = await fetch(`/api/noticias/temas?id=${t.id}`, { method: "DELETE" });
    if (!r.ok) return avisar("Não consegui tirar esse tema.");
    if (ativo === t.id) setAtivo(null);
    invalidar(CHAVE);
  }

  async function atualizar() {
    setOcupado(true);
    try {
      const r = await fetch("/api/noticias/atualizar", { method: "POST" });
      if (!r.ok && r.status !== 202) return avisar("Não consegui buscar agora.");
      aguardarBusca();
      avisar("Buscando as notícias dos seus temas. Elas aparecem aqui em instantes.");
    } finally {
      setOcupado(false);
    }
  }

  function abrir(n: Noticia) {
    if (n.lida) return;
    void fetch("/api/noticias/lida", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: n.id }) }).then(() => invalidar(CHAVE));
  }

  const visiveis = (ativo ? temas.filter((t) => t.id === ativo) : temas)
    .flatMap((t) => t.noticias.map((n) => ({ ...n, tema: t.tema })))
    .sort((a, b) => (a.encontradaEm < b.encontradaEm ? 1 : -1))
    .slice(0, ativo ? 12 : 9);

  return (
    <div className="noticias">
      <div className="noticias-barra">
        <div className="noticias-temas" role="tablist" aria-label="Temas que você acompanha">
          {temas.length > 1 && (
            <button type="button" role="tab" aria-selected={!ativo} className={`noticias-tema${!ativo ? " ativo" : ""}`} onClick={() => setAtivo(null)}>
              Todos
            </button>
          )}
          {temas.map((t) => (
            <span key={t.id} className={`noticias-tema${ativo === t.id ? " ativo" : ""}`}>
              <button type="button" role="tab" aria-selected={ativo === t.id} onClick={() => setAtivo(ativo === t.id ? null : t.id)}>
                {t.tema}
              </button>
              <button type="button" className="noticias-tema-tirar" aria-label={`Parar de acompanhar ${t.tema}`} onClick={() => void deixar(t)}>
                <Icone nome="close" />
              </button>
            </span>
          ))}
          <form className="noticias-novo" onSubmit={(ev) => void seguir(ev)}>
            <input
              className="inline-input"
              value={novo}
              onChange={(ev) => setNovo(ev.target.value)}
              placeholder={temas.length ? "Outro tema" : "Um tema, por exemplo: IA na saúde"}
              aria-label="Novo tema para acompanhar"
              maxLength={80}
            />
            <button type="submit" className="button secondary compacto" disabled={ocupado || novo.trim().length < 2}>
              <Icone nome="plus" />
              Seguir
            </button>
          </form>
        </div>
        {temas.length > 0 && (
          <button type="button" className="text-button" onClick={() => void atualizar()} disabled={ocupado}>
            Atualizar agora
          </button>
        )}
      </div>

      {recado && <p className="noticias-recado" role="status">{recado}</p>}

      {erro && !dado ? (
        <div className="panel empty-state">Não consegui carregar as notícias agora.</div>
      ) : !temas.length ? (
        <div className="panel empty-state noticias-vazio">
          <strong>Escolha um tema e a Órbita traz as notícias todo dia.</strong>
          <span>Pode ser um assunto do trabalho, um time, uma empresa ou um hobby. Dá para pedir falando também: "passa a acompanhar energia solar".</span>
        </div>
      ) : !visiveis.length ? (
        <div className="panel empty-state noticias-vazio">
          <strong>Ainda sem notícias por aqui.</strong>
          <span>A busca do dia já foi pedida. Se acabou de seguir o tema, elas chegam em instantes.</span>
        </div>
      ) : (
        <div className="noticias-grade">
          {visiveis.map((n) => (
            <a key={n.id} className={`noticia-card${n.lida ? " lida" : ""}`} href={n.url} target="_blank" rel="noopener noreferrer" onClick={() => abrir(n)}>
              <span className="noticia-site">
                <span className="noticia-inicial" aria-hidden="true">{n.site.charAt(0).toUpperCase()}</span>
                {n.site}
                <span className="noticia-quando">{quando(n.encontradaEm)}</span>
              </span>
              <strong className="noticia-titulo">{n.titulo}</strong>
              {n.resumo && <span className="noticia-resumo">{n.resumo}</span>}
              {!ativo && temas.length > 1 && <span className="noticia-tema">{n.tema}</span>}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
