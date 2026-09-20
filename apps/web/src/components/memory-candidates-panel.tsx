"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Button, Input } from "@/components/ui";

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
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [editando, setEditando] = useState<{ id: string; texto: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const carregar = useCallback(() => {
    fetch("/api/memory/candidatos")
      .then((r) => r.json())
      .then((d) => setCandidatos(d.candidatos ?? []))
      .catch(() => {});
  }, []);

  // painel só consulta o servidor enquanto está sendo visto
  useEffect(() => {
    if (!visivel) return;
    carregar();
    const t = setInterval(carregar, 30000);
    return () => clearInterval(t);
  }, [visivel, carregar]);

  async function decidir(id: string, decisao: "confirmar" | "descartar", fato?: string) {
    setBusy(id);
    try {
      await fetch("/api/memory/candidatos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decisao, ...(fato ? { fato } : {}) }),
      });
      setCandidatos((c) => c.filter((x) => x.id !== id));
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
