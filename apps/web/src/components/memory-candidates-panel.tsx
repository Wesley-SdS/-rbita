"use client";

import { useState } from "react";
import { Card, Button, Input } from "@/components/ui";
import { useAtualizacaoPeriodica, useVisivel } from "@/lib/use-visible";
import { mutarRecurso, useRecurso } from "@/lib/dados/recurso";

/**
 * MEMÓRIAS A CONFIRMAR (B4.1).
 *
 * A Órbita propõe, o dono decide: confirmar, corrigir o texto antes de
 * confirmar, ou descartar. Cada cartão mostra de onde o fato saiu (a frase da
 * conversa) e por que parou aqui, porque sem isso não dá para julgar.
 */

interface Candidato {
  id: string;
  fato: string;
  evidencia: string | null;
  categoria: string;
  confianca: number;
  motivo: string;
  parecidaCom: { id: string; fato: string } | null;
}

const MOTIVO: Record<string, string> = {
  confianca_media: "não tenho certeza",
  confianca_baixa: "não tenho certeza",
  assunto_sensivel: "assunto delicado, prefiro perguntar",
  salvo_automatico: "guardei sozinha",
};

export function MemoryCandidatesPanel({ visivel = true }: { visivel?: boolean }) {
  // `visivel` é a prop da aba; `useVisivel` acrescenta "e a aba do navegador
  // está à frente". Antes era um `setInterval` cru, que continuava consultando
  // o servidor com o app esquecido aberto num monitor.
  const naTela = useVisivel() && visivel;
  const { dado, recarregar } = useRecurso<{ candidatos: Candidato[] }>("/api/memory/candidatos", { ativo: naTela });
  const candidatos = dado?.candidatos ?? [];
  const [editando, setEditando] = useState<{ id: string; texto: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useAtualizacaoPeriodica(recarregar, 30_000, naTela);

  async function decidir(id: string, decisao: "confirmar" | "descartar", fato?: string) {
    setBusy(id);
    try {
      // O cartão sai da tela na hora: decidir sobre uma memória é um gesto
      // rápido e em sequência, e esperar a volta a cada um trava o ritmo.
      await mutarRecurso<{ candidatos: Candidato[] }>({
        chave: "/api/memory/candidatos",
        otimista: (atual) => ({ candidatos: (atual?.candidatos ?? []).filter((x) => x.id !== id) }),
        executar: () =>
          fetch("/api/memory/candidatos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, decisao, ...(fato ? { fato } : {}) }),
          }),
        // confirmar vira memória de verdade: a contagem do acervo mudou
        invalida: decisao === "confirmar" ? ["/api/knowledge", "/api/memory"] : [],
      });
      setEditando(null);
    } finally {
      setBusy(null);
    }
  }

  if (!candidatos.length) return null;

  return (
    <Card>
      <div className="section-heading">
        <h2>Memórias a confirmar</h2>
        <span className="tag">{candidatos.length}</span>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {candidatos.map((c) => (
          <div key={c.id} className="rounded border p-2" style={{ borderColor: "var(--color-line)" }}>
            {editando?.id === c.id ? (
              <Input value={editando.texto} onChange={(e) => setEditando({ id: c.id, texto: e.target.value })} className="w-full" />
            ) : (
              <div className="text-[15px]">{c.fato}</div>
            )}

            <div className="mt-1 flex flex-wrap gap-2 text-[13px]" style={{ color: "var(--color-ink-dim)" }}>
              <span>{c.categoria}</span>
              <span>·</span>
              <span>{MOTIVO[c.motivo] ?? c.motivo}</span>
              <span>·</span>
              <span>confiança {Math.round(c.confianca * 100)}%</span>
            </div>

            {c.evidencia && (
              <div className="mt-1 text-[13px] italic" style={{ color: "var(--color-ink-dim)" }}>
                “{c.evidencia}”
              </div>
            )}

            {c.parecidaCom && (
              <div className="mt-1 text-[13px]" style={{ color: "var(--color-ink-dim)" }}>
                Atualiza o que eu já sabia: “{c.parecidaCom.fato}”
              </div>
            )}

            <div className="mt-2 flex gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={busy === c.id}
                onClick={() => decidir(c.id, "confirmar", editando?.id === c.id ? editando.texto : undefined)}
              >
                {editando?.id === c.id ? "Salvar corrigido" : "Confirmar"}
              </Button>
              {editando?.id !== c.id && (
                <Button variant="outline" size="sm" disabled={busy === c.id} onClick={() => setEditando({ id: c.id, texto: c.fato })}>
                  Corrigir
                </Button>
              )}
              <Button variant="outline" size="sm" disabled={busy === c.id} onClick={() => decidir(c.id, "descartar")}>
                Descartar
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
