"use client";

import { useState } from "react";
import { Input, Button } from "@/components/ui";

/**
 * Busca no acervo, pela tela (R2).
 *
 * É a mesma busca do chat, mostrada crua: de qual documento veio, de qual
 * página, e por qual caminho (significado, palavra exata ou os dois). Serve
 * para o dono conferir o que a Órbita encontra, e para abrir a citação no
 * contexto em volta em vez de acreditar no trecho solto.
 */

interface Resultado {
  trechoId: string | null;
  documentId: string | null;
  fonte: string;
  paginaInicio: number | null;
  paginaFim: number | null;
  via: "vetor" | "texto" | "ambos" | null;
  score: number;
  trecho: string;
}

interface Contexto {
  titulo: string;
  paginaInicio: number | null;
  paginaFim: number | null;
  paginas: number | null;
  trecho: string;
  contexto: string;
  antes: number;
  depois: number;
}

const VIA_LABEL: Record<string, string> = { vetor: "significado", texto: "palavra exata", ambos: "os dois" };

export function paginaLabel(ini: number | null, fim: number | null): string {
  if (ini == null) return "";
  return fim && fim !== ini ? `páginas ${ini} a ${fim}` : `página ${ini}`;
}

export function KnowledgeSearch() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultados, setResultados] = useState<Resultado[] | null>(null);
  const [aberto, setAberto] = useState<{ id: string; ctx: Contexto } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function buscar() {
    if (!q.trim() || busy) return;
    setBusy(true);
    setErro(null);
    setAberto(null);
    try {
      const r = await fetch(`/api/knowledge/busca?q=${encodeURIComponent(q)}&k=8`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "falha na busca");
      setResultados((await r.json()).resultados ?? []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "erro");
      setResultados(null);
    } finally {
      setBusy(false);
    }
  }

  async function abrir(trechoId: string | null) {
    if (!trechoId) return;
    if (aberto?.id === trechoId) {
      setAberto(null);
      return;
    }
    try {
      const r = await fetch(`/api/knowledge/busca?trecho=${trechoId}`);
      if (!r.ok) throw new Error("não consegui abrir o trecho");
      setAberto({ id: trechoId, ctx: await r.json() });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "erro");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && buscar()}
          placeholder="Buscar nos seus documentos…"
          className="flex-1"
        />
        <Button variant="outline" size="md" onClick={buscar} disabled={busy}>
          {busy ? "…" : "Buscar"}
        </Button>
      </div>

      {erro && <div className="text-[13px]" style={{ color: "var(--color-danger)" }}>✗ {erro}</div>}

      {resultados?.length === 0 && (
        <div className="text-[14px]" style={{ color: "var(--color-ink-dim)" }}>
          Nada encontrado no acervo para isso.
        </div>
      )}

      {resultados?.map((r, i) => (
        <div key={r.trechoId ?? i} className="rounded border p-2 text-[14px]" style={{ borderColor: "var(--color-line)" }}>
          <div className="flex items-baseline gap-2">
            <span style={{ color: "var(--color-gold)" }}>{r.fonte}</span>
            {r.paginaInicio != null && (
              <span style={{ color: "var(--color-ink-dim)" }}>{paginaLabel(r.paginaInicio, r.paginaFim)}</span>
            )}
            {r.via && (
              <span className="ml-auto text-[13px]" style={{ color: "var(--color-ink-dim)" }}>
                achado por {VIA_LABEL[r.via] ?? r.via}
              </span>
            )}
          </div>
          <div className="mt-1" style={{ color: "var(--color-ink-dim)" }}>
            {aberto?.id === r.trechoId ? (
              <>
                <span>{aberto.ctx.contexto.slice(0, aberto.ctx.antes)}</span>
                <mark style={{ background: "transparent", color: "var(--color-ink)" }}>
                  {aberto.ctx.contexto.slice(aberto.ctx.antes, aberto.ctx.contexto.length - aberto.ctx.depois)}
                </mark>
                <span>{aberto.ctx.contexto.slice(aberto.ctx.contexto.length - aberto.ctx.depois)}</span>
              </>
            ) : (
              r.trecho
            )}
          </div>
          {r.trechoId && (
            <button className="mt-1 text-[13px] underline" style={{ color: "var(--color-ink-dim)" }} onClick={() => abrir(r.trechoId)}>
              {aberto?.id === r.trechoId ? "fechar" : "abrir no documento"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
