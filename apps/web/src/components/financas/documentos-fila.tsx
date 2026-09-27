"use client";

import { useRef, useState } from "react";
import { brl } from "@orbita/core/finance/formato";
import { Icone } from "@/components/presenca/icones";
import { JobProgress } from "@/components/job-progress";
import { enfileirar, isJobTerminal, type JobView } from "@/lib/jobs";
import { invalidarFinancas } from "@/lib/financas/api";
import { useFinancas } from "./contexto";

/**
 * "Ler comprovante (foto)" e "Importar extrato em PDF": as duas funções da
 * tela antiga que não podiam sumir. Ler foto e PDF é OCR mais um modelo
 * estruturando os campos, o que passa fácil de dez segundos, então é trabalho
 * de fila (CLAUDE.md §6): a tela enfileira, acompanha o progresso e, ao fim,
 * marca as vistas das finanças como velhas para o lançamento novo aparecer.
 */
export function DocumentosDaFila() {
  const f = useFinancas();
  const [ocupado, setOcupado] = useState(false);
  const [trabalhoExtrato, setTrabalhoExtrato] = useState<JobView | null>(null);
  const [trabalhoComprovante, setTrabalhoComprovante] = useState<JobView | null>(null);
  const imagemRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);

  async function enviar(arquivo: File, rota: string, guardar: (j: JobView | null) => void) {
    setOcupado(true);
    // limpa o trabalho anterior: sem isto a barra do envio passado reaparece
    // por um instante antes de o novo chegar
    guardar(null);
    try {
      const fd = new FormData();
      fd.append("file", arquivo);
      const r = await fetch(rota, { method: "POST", body: fd });
      guardar(await enfileirar(r));
    } catch (e) {
      setOcupado(false);
      f.avisar(e instanceof Error ? e.message : "Não foi possível enviar o arquivo.");
    }
  }

  function aoMudarExtrato(j: JobView) {
    setTrabalhoExtrato(j);
    if (!isJobTerminal(j.status)) return;
    setOcupado(false);
    if (j.status === "feito") {
      const d = j.resultado as { importados?: number } | null;
      const n = d?.importados ?? 0;
      f.avisar(`${n} ${n === 1 ? "lançamento importado" : "lançamentos importados"} do extrato.`);
      invalidarFinancas();
    } else if (j.status === "falhou") {
      f.avisar(j.erro?.mensagem ?? "Não consegui ler esse extrato.");
    } else {
      f.avisar("Importação cancelada.");
    }
  }

  function aoMudarComprovante(j: JobView) {
    setTrabalhoComprovante(j);
    if (!isJobTerminal(j.status)) return;
    setOcupado(false);
    if (j.status === "feito") {
      // o valor do comprovante vem em reais (é o que o modelo leu no papel)
      const d = j.resultado as { lancamento?: { descricao?: string; valor?: number } } | null;
      const l = d?.lancamento;
      f.avisar(l ? `${l.descricao ?? "Comprovante"} · ${brl(Math.round((l.valor ?? 0) * 100))}` : "Comprovante lido.");
      invalidarFinancas();
    } else if (j.status === "falhou") {
      f.avisar(j.erro?.mensagem ?? "Não consegui ler esse comprovante.");
    } else {
      f.avisar("Leitura cancelada.");
    }
  }

  return (
    <div className="fin-fila">
      <input
        ref={imagemRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const arq = e.target.files?.[0];
          if (arq) void enviar(arq, "/api/finance/receipt", setTrabalhoComprovante);
          e.target.value = "";
        }}
      />
      <input
        ref={pdfRef}
        type="file"
        accept=".pdf,application/pdf"
        hidden
        onChange={(e) => {
          const arq = e.target.files?.[0];
          if (arq) void enviar(arq, "/api/finance/statement", setTrabalhoExtrato);
          e.target.value = "";
        }}
      />
      <p className="fin-nota">Uma foto do comprovante ou o PDF do extrato já bastam. A leitura leva alguns segundos e roda em segundo plano.</p>
      <div className="fin-botoes">
        <button type="button" className="button secondary compacto" onClick={() => imagemRef.current?.click()} disabled={ocupado}>
          <Icone nome="file" />
          Ler comprovante (foto)
        </button>
        <button type="button" className="button secondary compacto" onClick={() => pdfRef.current?.click()} disabled={ocupado}>
          <Icone nome="download" />
          Importar extrato em PDF
        </button>
      </div>
      {trabalhoExtrato && !isJobTerminal(trabalhoExtrato.status) && <JobProgress job={trabalhoExtrato} onChange={aoMudarExtrato} />}
      {trabalhoComprovante && !isJobTerminal(trabalhoComprovante.status) && <JobProgress job={trabalhoComprovante} onChange={aoMudarComprovante} />}
    </div>
  );
}
