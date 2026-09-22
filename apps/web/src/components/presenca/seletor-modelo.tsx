"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icone } from "./icones";
import { filtrarModelos, ultimosDeCadaFamilia } from "@orbita/llm";

/** O mínimo que o seletor precisa saber de um modelo. Propositalmente menor
 *  que o `ModelInfo` do catálogo: a tela não usa preço nem janela de contexto. */
export interface ModeloDoSeletor {
  key: string;
  label: string;
  provider: string;
}

/**
 * Escolher qual modelo responde.
 *
 * Era um `<select>` nativo. Funcionava com meia dúzia de modelos; com a chave
 * do gateway ligada, a descoberta passou a trazer 378, e abrir a lista nativa
 * travava a tela. A saída NÃO é uma lista fixa de "modelos bons" no código
 * (isso é o hardcode que o projeto proíbe), é uma regra sobre o que a
 * descoberta trouxer: por padrão mostra só o ÚLTIMO de cada família, e quem
 * quiser o catálogo inteiro pede.
 *
 * A busca existe porque mesmo 15 linhas ficam lentas de percorrer quando se
 * sabe o nome do que se procura.
 */
const GRUPOS: { p: string; label: string }[] = [
  { p: "local", label: "Local (grátis)" },
  { p: "claude", label: "Claude (assinatura)" },
  { p: "groq", label: "Groq" },
  { p: "google", label: "Google Gemini" },
  { p: "openai", label: "OpenAI" },
  { p: "cohere", label: "Cohere" },
  { p: "gateway", label: "Gateway (pago)" },
];

export function SeletorDeModelo({
  modelos,
  valor,
  aoEscolher,
  desabilitado = false,
}: {
  modelos: ModeloDoSeletor[];
  valor: string;
  aoEscolher: (key: string) => void;
  desabilitado?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [tudo, setTudo] = useState(false);
  const caixaRef = useRef<HTMLDivElement>(null);
  const buscaRef = useRef<HTMLInputElement>(null);

  const escolhido = modelos.find((m) => m.key === valor) ?? null;

  // A lista só é recalculada quando algo dela muda: filtrar 378 itens a cada
  // tecla, numa máquina já ocupada, é o que fazia a busca parecer travada.
  const visiveis = useMemo(() => {
    // buscar olha o catálogo INTEIRO: quem digita "codex" quer o codex, mesmo
    // que ele não seja o último da família dele
    const base = tudo || busca.trim() ? modelos : ultimosDeCadaFamilia(modelos);
    return filtrarModelos(base, busca);
  }, [modelos, busca, tudo]);

  const porGrupo = useMemo(() => {
    const mapa = new Map<string, ModeloDoSeletor[]>();
    for (const m of visiveis) {
      const lista = mapa.get(m.provider) ?? [];
      lista.push(m);
      mapa.set(m.provider, lista);
    }
    return mapa;
  }, [visiveis]);

  useEffect(() => {
    if (!aberto) return;
    buscaRef.current?.focus();
    const fora = (e: MouseEvent) => {
      if (caixaRef.current && !caixaRef.current.contains(e.target as Node)) setAberto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto]);

  function escolher(key: string) {
    aoEscolher(key);
    setAberto(false);
    setBusca("");
  }

  return (
    <div className="seletor-modelo" ref={caixaRef}>
      <button
        type="button"
        className="seletor-gatilho"
        onClick={() => setAberto((v) => !v)}
        disabled={desabilitado}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        title="Qual modelo responde"
      >
        <span className="seletor-nome">{escolhido?.label ?? "Escolher modelo"}</span>
        <Icone nome="chevrons" />
      </button>

      {aberto && (
        <div className="seletor-popover" role="listbox">
          <div className="seletor-busca">
            <Icone nome="search" />
            <input
              ref={buscaRef}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar modelo…"
              aria-label="Buscar modelo"
            />
          </div>

          <div className="seletor-lista">
            {visiveis.length === 0 && <p className="seletor-vazio">Nenhum modelo com esse nome.</p>}
            {GRUPOS.map((g) => {
              const itens = porGrupo.get(g.p) ?? [];
              if (!itens.length) return null;
              return (
                <div key={g.p} className="seletor-grupo">
                  <div className="seletor-grupo-titulo">{g.label}</div>
                  {itens.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      role="option"
                      aria-selected={m.key === valor}
                      className={`seletor-item ${m.key === valor ? "ativo" : ""}`}
                      onClick={() => escolher(m.key)}
                    >
                      <span className="seletor-item-nome">{m.label}</span>
                      {m.key === valor && <Icone nome="check" />}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>

          {!busca.trim() && (
            <button type="button" className="seletor-tudo" onClick={() => setTudo((v) => !v)}>
              {tudo ? `Mostrar só o mais recente de cada família` : `Ver todos os ${modelos.length} modelos`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
