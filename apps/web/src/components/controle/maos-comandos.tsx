"use client";

import { useState } from "react";
import { invalidar, useRecurso } from "@/lib/dados/recurso";
import { Button, ErrorRetry, Input } from "@/components/ui";
import { ListaDeAjuste } from "./lista-de-ajuste";

/**
 * Bloco "comandos" (frente A): a lista que LIBERA comando sem aprovação, e um
 * teste que mostra como o classificador veria um comando, sem rodar nada.
 * A lista é a única coisa que libera: nenhuma lista de proibidos a substitui
 * (PRD A3).
 */

interface Comandos {
  comandos: string[];
  shellPadrao: string;
  shells: string[];
}
interface Classificacao {
  risco: "leitura" | "escrita" | "efeito_externo" | "perigoso";
  motivos: string[];
  shell: string;
}

const URL = "/api/maos/comandos";
const dim = { color: "var(--color-ink-dim)" } as const;
const RISCO: Record<Classificacao["risco"], string> = {
  leitura: "roda na hora (só leitura)",
  escrita: "roda na hora",
  efeito_externo: "pede a sua aprovação",
  perigoso: "perigoso: só se aprova pela tela",
};

export function MaosComandos() {
  const { dado, erro, recarregar } = useRecurso<Comandos>(URL);
  const [teste, setTeste] = useState("");
  const [resultado, setResultado] = useState<Classificacao | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  if (erro && !dado) return <ErrorRetry message={erro} onRetry={recarregar} />;
  if (!dado) return <p className="text-[14px]" style={dim}>Carregando…</p>;

  async function classificar() {
    setAviso(null);
    setResultado(null);
    try {
      const r = await fetch("/api/maos/classificar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comando: teste }) });
      const d = (await r.json().catch(() => ({}))) as Classificacao & { error?: string };
      if (!r.ok) setAviso(d.error ?? "Não consegui classificar.");
      else setResultado(d);
    } catch {
      setAviso("Sem conexão com a Órbita.");
    }
  }

  return (
    <div className="flex flex-col gap-3 text-[15px]">
      <p className="text-[14px]" style={dim}>
        Só roda sem aprovação o comando feito INTEIRO destes, sem redirecionamento nem comando dentro de comando. Terminal padrão: {dado.shellPadrao}; instalados: {dado.shells.join(", ") || "o serviço do Windows está desligado"}.
      </p>
      <ListaDeAjuste chave="terminal.comandosDeLeitura" itens={dado.comandos} placeholder="pnpm test" aoMudar={() => invalidar(URL)} />
      <div className="border-t pt-3" style={{ borderColor: "var(--color-line)" }}>
        <p className="mb-2 font-semibold">Testar um comando (não roda)</p>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (teste.trim()) void classificar();
          }}
        >
          <Input value={teste} onChange={(e) => setTeste(e.target.value)} placeholder="git status; Remove-Item x" aria-label="Comando para testar" maxLength={4000} />
          <Button size="sm" type="submit" disabled={!teste.trim()}>
            Testar
          </Button>
        </form>
        {resultado ? (
          <p className="mt-2">
            <b>{RISCO[resultado.risco] ?? resultado.risco}</b>
            {resultado.motivos.length ? <span style={dim}> · {resultado.motivos.join("; ")}</span> : null}
          </p>
        ) : null}
        {aviso ? <p className="notice">{aviso}</p> : null}
      </div>
    </div>
  );
}
