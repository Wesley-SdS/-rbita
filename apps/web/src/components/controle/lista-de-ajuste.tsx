"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";

/**
 * Uma LISTA de Ajustes (pastas, apps ocultos, comandos de leitura) editada no
 * próprio bloco da tela Controle do PC. Grava pela mesma rota da tela de
 * Ajustes (`PUT /api/settings`), com a mesma validação e o mesmo OwnerGuard:
 * aqui só se orquestra a lista, a regra é do servidor.
 */

const dim = { color: "var(--color-ink-dim)" } as const;

export async function salvarAjuste(chave: string, valor: unknown): Promise<string | null> {
  try {
    const r = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: chave, value: valor }) });
    if (r.ok) return null;
    const d = (await r.json().catch(() => ({}))) as { error?: string };
    return d.error ?? "Valor inválido.";
  } catch {
    return "Sem conexão com a Órbita.";
  }
}

export function ListaDeAjuste({
  chave,
  itens,
  placeholder,
  rotuloDoItem,
  aoMudar,
}: {
  chave: string;
  itens: string[];
  placeholder: string;
  /** o que aparece ao lado de cada item ("existe", "não existe") */
  rotuloDoItem?: (item: string) => React.ReactNode;
  aoMudar: () => void;
}) {
  const [novo, setNovo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function gravar(lista: string[]) {
    setOcupado(true);
    setErro(await salvarAjuste(chave, lista));
    setOcupado(false);
    aoMudar();
  }

  return (
    <div className="flex flex-col gap-2">
      {itens.length ? (
        <ul className="flex flex-col gap-1">
          {itens.map((it) => (
            <li key={it} className="flex items-baseline justify-between gap-2">
              <span className="break-all">
                <code>{it}</code> {rotuloDoItem ? <span style={dim}>{rotuloDoItem(it)}</span> : null}
              </span>
              <Button variant="subtle" size="sm" disabled={ocupado} onClick={() => void gravar(itens.filter((x) => x !== it))}>
                Tirar
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[14px]" style={dim}>Lista vazia.</p>
      )}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const v = novo.trim();
          if (!v || itens.includes(v)) return;
          await gravar([...itens, v]);
          setNovo("");
        }}
      >
        <Input value={novo} onChange={(e) => setNovo(e.target.value)} placeholder={placeholder} aria-label={placeholder} maxLength={400} />
        <Button size="sm" type="submit" disabled={!novo.trim() || ocupado}>
          Acrescentar
        </Button>
      </form>
      {erro ? <p className="notice">{erro}</p> : null}
    </div>
  );
}
