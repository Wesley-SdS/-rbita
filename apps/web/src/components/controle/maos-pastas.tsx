"use client";

import { invalidar, useRecurso } from "@/lib/dados/recurso";
import { ErrorRetry } from "@/components/ui";
import { ListaDeAjuste } from "./lista-de-ajuste";

/**
 * Bloco "pastas" (frente A): onde o terminal roda comando e onde a Órbita lê
 * arquivos, com o caminho de verdade nesta máquina e se a pasta existe. Os
 * segredos (`.env`, chaves, `.ssh`, perfis do navegador) continuam negados
 * mesmo dentro destas pastas.
 */

interface Pasta {
  config: string;
  caminho: string;
  existe: boolean;
}
interface Pastas {
  terminal: Pasta[];
  arquivos: Pasta[];
  anexos: Pasta;
  shells: string[];
  maosLigadas: boolean;
}

const URL = "/api/maos/pastas";
const dim = { color: "var(--color-ink-dim)" } as const;

function rotulo(lista: Pasta[]) {
  return (item: string) => {
    const p = lista.find((x) => x.config === item);
    if (!p) return null;
    return `${p.caminho !== item ? `${p.caminho} · ` : ""}${p.existe ? "existe" : "não existe nesta máquina"}`;
  };
}

export function MaosPastas() {
  const { dado, erro, recarregar } = useRecurso<Pastas>(URL);
  if (erro && !dado) return <ErrorRetry message={erro} onRetry={recarregar} />;
  if (!dado) return <p className="text-[14px]" style={dim}>Carregando…</p>;
  const mudou = () => invalidar(URL);
  return (
    <div className="flex flex-col gap-4 text-[15px]">
      <div>
        <p className="mb-1 font-semibold">Onde o terminal roda comando</p>
        <p className="mb-2 text-[14px]" style={dim}>
          Comando em outra pasta só sai pela tela. Terminais encontrados: {dado.maosLigadas ? dado.shells.join(", ") || "nenhum" : "o serviço do Windows está desligado"}.
        </p>
        <ListaDeAjuste chave="terminal.pastas" itens={dado.terminal.map((p) => p.config)} placeholder="~/Documents/github" rotuloDoItem={rotulo(dado.terminal)} aoMudar={mudou} />
      </div>
      <div className="border-t pt-3" style={{ borderColor: "var(--color-line)" }}>
        <p className="mb-1 font-semibold">Onde a Órbita lê arquivos</p>
        <p className="mb-2 text-[14px]" style={dim}>
          Listar, ler e buscar valem só aqui dentro. Escrever e mandar para a Lixeira sempre pedem a sua aprovação; apagar de vez não existe.
        </p>
        <ListaDeAjuste chave="arquivos.pastas" itens={dado.arquivos.map((p) => p.config)} placeholder="~/Downloads" rotuloDoItem={rotulo(dado.arquivos)} aoMudar={mudou} />
      </div>
      <p className="text-[14px]" style={dim}>
        Anexo baixado vai para <code>{dado.anexos.caminho}</code> {dado.anexos.existe ? "" : "(a pasta nasce no primeiro download)"}. Muda em &quot;Onde salvar anexos&quot;, logo abaixo.
      </p>
    </div>
  );
}
