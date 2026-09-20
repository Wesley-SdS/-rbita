"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icone } from "./icones";
import { TELAS } from "./navegacao";

interface Achado {
  id: string;
  titulo: string;
  detalhe: string;
  icone: string;
  href: string;
}

/**
 * Busca do ⌘K: telas e memória, no mesmo lugar.
 *
 * As telas resolvem na hora, no cliente, porque são nove e ninguém deve esperar
 * a rede para trocar de página. A memória vai ao servidor, com um respiro de
 * 220 ms entre teclas para não abrir uma requisição por letra digitada.
 */
export function Busca({ aberta, aoFechar }: { aberta: boolean; aoFechar: () => void }) {
  const router = useRouter();
  const entradaRef = useRef<HTMLInputElement>(null);
  const [termo, setTermo] = useState("");
  const [memorias, setMemorias] = useState<Achado[]>([]);
  const [selecionado, setSelecionado] = useState(0);

  useEffect(() => {
    if (aberta) {
      setTermo("");
      setMemorias([]);
      setSelecionado(0);
      entradaRef.current?.focus();
    }
  }, [aberta]);

  useEffect(() => {
    const busca = termo.trim();
    if (!aberta || busca.length < 2) {
      setMemorias([]);
      return;
    }
    const cancelar = new AbortController();
    const id = setTimeout(() => {
      fetch(`/api/knowledge/busca?q=${encodeURIComponent(busca)}&k=6`, { signal: cancelar.signal })
        .then((r) => (r.ok ? r.json() : { resultados: [] }))
        .then((d: { resultados?: { trechoId?: string; fonte?: string; trecho?: string }[] }) =>
          setMemorias(
            (d.resultados ?? []).map((r, i) => ({
              id: r.trechoId ?? `trecho-${i}`,
              // A fonte é o que orienta: saber de qual documento veio importa
              // mais do que o trecho em si na hora de escolher um resultado.
              titulo: r.fonte || "Trecho guardado",
              detalhe: (r.trecho ?? "").replace(/\s+/g, " ").slice(0, 92),
              icone: "network",
              href: "/app/memoria",
            })),
          ),
        )
        // Busca que falha não pode derrubar a navegação por telas, que é o uso
        // mais comum do ⌘K.
        .catch(() => setMemorias([]));
    }, 220);
    return () => {
      clearTimeout(id);
      cancelar.abort();
    };
  }, [termo, aberta]);

  const normalizar = (t: string) =>
    t.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{Diacritic}/gu, "");

  const buscando = termo.trim().length > 0;
  const telas: Achado[] = TELAS.filter((t) => !buscando || normalizar(t.titulo).includes(normalizar(termo))).map((t) => ({
    id: t.slug,
    titulo: t.titulo,
    // Sem busca, a lista é um lançador e o subtítulo repetido nove vezes vira
    // ruído. Com busca, ele diz por que aquela linha apareceu.
    detalhe: buscando ? "Tela" : "",
    icone: t.icone,
    href: t.href,
  }));

  const achados = [...telas, ...memorias];
  const grupos: { rotulo: string; itens: Achado[] }[] = [
    { rotulo: buscando ? "Telas" : "Ir para", itens: telas },
    { rotulo: "No seu acervo", itens: memorias },
  ].filter((g) => g.itens.length > 0);

  const abrir = useCallback(
    (achado: Achado) => {
      aoFechar();
      router.push(achado.href);
    },
    [aoFechar, router],
  );

  function aoTeclar(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelecionado((i) => Math.min(i + 1, achados.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelecionado((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const alvo = achados[selecionado];
      if (alvo) abrir(alvo);
    }
  }

  if (!aberta) return null;

  return (
    <div className="busca-fundo" onClick={aoFechar} role="presentation">
      <div className="search-dialog aberta" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Buscar no seu universo">
        <div className="search-input-wrap">
          <Icone nome="search" />
          <input
            ref={entradaRef}
            type="search"
            value={termo}
            onChange={(e) => {
              setTermo(e.target.value);
              setSelecionado(0);
            }}
            onKeyDown={aoTeclar}
            placeholder="O que você quer encontrar?"
            aria-label="Buscar"
          />
          <button className="key-button" onClick={aoFechar}>
            Esc
          </button>
        </div>

        <div className="busca-lista">
          {achados.length === 0 ? (
            <div className="empty-state">
              {buscando ? `Nada encontrado para “${termo.trim()}”.` : "Comece a escrever para buscar no seu acervo."}
            </div>
          ) : (
            grupos.map((g) => (
              <div key={g.rotulo} className="busca-grupo">
                <div className="panel-label">{g.rotulo.toUpperCase()}</div>
                {g.itens.map((a) => {
                  const i = achados.indexOf(a);
                  return (
                    <button
                      key={`${a.id}-${i}`}
                      className={`search-result ${i === selecionado ? "ativo" : ""}`}
                      onMouseEnter={() => setSelecionado(i)}
                      onClick={() => abrir(a)}
                    >
                      <Icone nome={a.icone} />
                      <span>
                        <strong>{a.titulo}</strong>
                        {a.detalhe && <small>{a.detalhe}</small>}
                      </span>
                      {i === selecionado && <kbd>↵</kbd>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
          {buscando && termo.trim().length < 2 && (
            <div className="busca-dica">Escreva ao menos duas letras para buscar no acervo.</div>
          )}
        </div>

        <div className="search-footer">
          <span>Telas e o que você guardou</span>
          <kbd>↑ ↓ navegar · ↵ abrir · esc fechar</kbd>
        </div>
      </div>
    </div>
  );
}
