"use client";

import { useRef, useState } from "react";
import { restaurarBackup } from "@/lib/financas/api";
import { useFinancas } from "../contexto";
import { BotaoPrincipal, Campo, Folha, Texto } from "../primitivos";

/**
 * Restaurar backup (PRD §9.4): colar o JSON ou enviar o arquivo. Substitui
 * TUDO, então pede confirmação; a validação do formato é do backend, aqui só
 * se recusa o que nem JSON é.
 */
export function FolhaRestaurar() {
  const f = useFinancas();
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);

  async function restaurar(conteudo: string) {
    let backup: unknown;
    try {
      backup = JSON.parse(conteudo);
    } catch {
      return f.avisar("Esse texto não é um backup válido.");
    }
    if (!backup || typeof backup !== "object") return f.avisar("Esse texto não é um backup válido.");
    if (!window.confirm("Substituir todos os dados atuais pelo backup?")) return;
    setOcupado(true);
    const r = await restaurarBackup(backup);
    setOcupado(false);
    if (!r.ok) return f.avisar(r.erro);
    f.fechar();
    f.avisar(r.dado.mensagem || "Backup restaurado.");
    f.irPara("painel", { mes: null });
  }

  function lerArquivo(arquivo: File) {
    const leitor = new FileReader();
    leitor.onload = () => {
      const conteudo = String(leitor.result ?? "");
      setTexto(conteudo);
      void restaurar(conteudo);
    };
    leitor.onerror = () => f.avisar("Não consegui ler esse arquivo.");
    leitor.readAsText(arquivo);
  }

  return (
    <Folha titulo="Restaurar backup" aoFechar={f.fechar}>
      <Texto>
        Cole aqui o conteúdo de um backup JSON, ou escolha o arquivo. <b>Isso substitui todos os dados atuais.</b>
      </Texto>
      <input
        ref={arquivoRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const arq = e.target.files?.[0];
          if (arq) lerArquivo(arq);
          e.target.value = "";
        }}
      />
      <button type="button" className="button secondary full-width" onClick={() => arquivoRef.current?.click()} disabled={ocupado}>
        Escolher arquivo de backup
      </button>
      <Campo rotulo="Conteúdo do backup">
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} spellCheck={false} />
      </Campo>
      <BotaoPrincipal onClick={() => void restaurar(texto)} disabled={ocupado}>Restaurar</BotaoPrincipal>
    </Folha>
  );
}
