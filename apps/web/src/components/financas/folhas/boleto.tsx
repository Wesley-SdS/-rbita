"use client";

import { useRef, useState } from "react";
import { brl, dataCurta } from "@orbita/core/finance/formato";
import type { BoletoLido } from "@orbita/core/finance/entradas";
import { lerBoletoPelaLinha, lerBoletoPeloPdf, type Resposta } from "@/lib/financas/api";
import { useFinancas } from "../contexto";
import { BotaoPrincipal, Campo, Folha, Texto } from "../primitivos";

/** Arquivo como data URL: é o formato que a rota de entrada recebe. */
function lerComoDataUrl(arquivo: File): Promise<string> {
  return new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => falha(r.error);
    r.readAsDataURL(arquivo);
  });
}

/**
 * Ler boleto (PRD §8.2): pela linha digitável ou pelo PDF. O valor e o
 * vencimento saem dos números do código (no backend), e o resultado abre
 * "Nova conta" já preenchida para a pessoa conferir.
 */
export function FolhaBoleto() {
  const f = useFinancas();
  const [linha, setLinha] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const pdfRef = useRef<HTMLInputElement>(null);

  function usar(r: Resposta<BoletoLido>) {
    if (!r.ok) return setMsg(r.erro);
    const b = r.dado;
    f.abrir({
      tipo: "compromisso",
      preenchido: { direcao: "pagar", descricao: b.beneficiario || "Boleto", valor: b.valor, vencimento: b.vencimento ?? f.hoje, categoriaId: b.categoriaId },
    });
    f.avisar(b.vencimento ? `Boleto lido: ${brl(b.valor)}, vence ${dataCurta(b.vencimento)}.` : `Boleto lido: ${brl(b.valor)}.`);
  }

  async function lerPdf(arquivo: File) {
    setMsg("Lendo o PDF...");
    setOcupado(true);
    let dado: string;
    try {
      dado = await lerComoDataUrl(arquivo);
    } catch {
      setOcupado(false);
      return setMsg("Não consegui abrir o arquivo.");
    }
    const r = await lerBoletoPeloPdf(dado);
    setOcupado(false);
    usar(r);
  }

  async function lerLinha() {
    setOcupado(true);
    const r = await lerBoletoPelaLinha(linha);
    setOcupado(false);
    usar(r);
  }

  return (
    <Folha titulo="Ler boleto" aoFechar={f.fechar}>
      <Texto>Escolha o PDF do boleto, ou cole a linha digitável, aqueles 47 números. O valor e o vencimento saem exatos dos próprios números do código.</Texto>
      <input
        ref={pdfRef}
        type="file"
        accept=".pdf,application/pdf"
        hidden
        onChange={(e) => {
          const arq = e.target.files?.[0];
          if (arq) void lerPdf(arq);
          e.target.value = "";
        }}
      />
      <button type="button" className="button secondary full-width" onClick={() => pdfRef.current?.click()} disabled={ocupado}>
        Escolher PDF do boleto
      </button>
      <Campo rotulo="Linha digitável">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="00000.00000 00000.000000 00000.000000 0 00000000000000"
          value={linha}
          maxLength={200}
          onChange={(e) => setLinha(e.target.value)}
        />
      </Campo>
      {msg && <p className="fin-dica" role="status">{msg}</p>}
      <BotaoPrincipal onClick={() => void lerLinha()} disabled={ocupado}>Ler</BotaoPrincipal>
    </Folha>
  );
}
