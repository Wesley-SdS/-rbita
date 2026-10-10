import { z } from "zod";
import { needsApproval } from "../tools/registry";
import { escolherFerramentasMcp, executarFerramentaMcp, ferramentasMcpDoDono } from "./client";

/**
 * As ferramentas dos servidores MCP na VOZ em tempo real.
 *
 * A voz recebe todas as tools nativas de uma vez (decisão do dono, 27/09/2026),
 * porque a sessão abre antes de o dono falar e não há pedido para escolher.
 * Declarar também as 85 dos servidores da Adalink passaria do limite da OpenAI
 * (128) e pioraria a escolha do Gemini, que perde precisão bem antes do limite
 * dele. Por isso a voz ganha DUAS funções: uma acha as ferramentas pelo assunto,
 * a outra usa a escolhida. O risco e a aprovação são os mesmos do chat
 * (`executarFerramentaMcp`), e a proposta nasce no canal "voz", para o "manda"
 * falado achá-la.
 */

export const BUSCAR = "buscar_ferramenta_externa";
export const USAR = "usar_ferramenta_externa";

const EntradaBuscar = z.object({
  busca: z.string().min(1).max(300).describe("O assunto, com as palavras do dono: \"chamados abertos\", \"meu dia na gestão\", \"lançar horas\"."),
});
const EntradaUsar = z.object({
  ferramenta: z.string().min(1).max(120).describe("O `nome` exato devolvido por buscar_ferramenta_externa."),
  argumentos_json: z
    .string()
    .max(20_000)
    .optional()
    .describe("Os argumentos da ferramenta, como um objeto JSON em texto (ex.: {\"status\":\"open\"}). Vazio quando ela não pede nenhum."),
});

export interface FuncaoDeVoz {
  name: string;
  description: string;
  inputSchema: z.ZodType;
}

/** As duas funções, só quando o dono tem algum servidor ligado com ferramentas. */
export async function funcoesMcpDeVoz(userId: string): Promise<FuncaoDeVoz[]> {
  const fs = await ferramentasMcpDoDono(userId).catch(() => []);
  if (!fs.length) return [];
  const servidores = [...new Set(fs.map((f) => f.servidor))].join(", ");
  return [
    {
      name: BUSCAR,
      description: `Acha ferramentas de sistemas externos conectados (${servidores}) pelo assunto. Use ANTES de usar_ferramenta_externa sempre que o pedido for sobre esses sistemas (chamados, atividades, projetos, horas). Devolve nome, descrição e parâmetros de cada uma.`,
      inputSchema: EntradaBuscar,
    },
    {
      name: USAR,
      description: "Usa uma ferramenta achada por buscar_ferramenta_externa. Consulta responde na hora; o que altera algo vira proposta para o dono aprovar (diga \"deixei pronto para você aprovar\", nunca \"fiz\").",
      inputSchema: EntradaUsar,
    },
  ];
}

export function ehFuncaoMcpDeVoz(nome: string): boolean {
  return nome === BUSCAR || nome === USAR;
}

/** Texto do resultado MCP para o modelo ler, com teto: um JSON de 51 chamados não cabe numa fala. */
function paraOModelo(conteudo: unknown): unknown {
  if (!Array.isArray(conteudo)) return conteudo;
  const texto = conteudo
    .map((b) => (b && typeof b === "object" && (b as { type?: unknown }).type === "text" ? String((b as { text?: unknown }).text ?? "") : ""))
    .join("\n")
    .trim();
  return texto ? texto.slice(0, 12_000) : conteudo;
}

export async function executarFuncaoMcpDeVoz(userId: string, nome: string, entrada: unknown): Promise<unknown> {
  if (nome === BUSCAR) {
    const p = EntradaBuscar.safeParse(entrada ?? {});
    if (!p.success) return { erro: "Diga o assunto da busca." };
    const achadas = escolherFerramentasMcp(await ferramentasMcpDoDono(userId), p.data.busca, 8, true);
    return {
      ferramentas: achadas.map((f) => ({
        nome: f.chave,
        descricao: f.descricao,
        parametros: f.inputSchema ?? { type: "object", properties: {} },
        pede_aprovacao: needsApproval(f.risco),
      })),
    };
  }

  const p = EntradaUsar.safeParse(entrada ?? {});
  if (!p.success) return { erro: "Informe a ferramenta." };
  const f = (await ferramentasMcpDoDono(userId)).find((x) => x.chave === p.data.ferramenta);
  if (!f) return { erro: `Ferramenta "${p.data.ferramenta}" não existe. Chame buscar_ferramenta_externa primeiro.` };
  let args: Record<string, unknown> = {};
  if (p.data.argumentos_json?.trim()) {
    try {
      const o = JSON.parse(p.data.argumentos_json) as unknown;
      if (!o || typeof o !== "object" || Array.isArray(o)) return { erro: "argumentos_json precisa ser um objeto JSON." };
      args = o as Record<string, unknown>;
    } catch {
      return { erro: "argumentos_json não é um JSON válido." };
    }
  }
  const r = await executarFerramentaMcp(userId, f, args, "voz");
  // `ferramenta` e `descricao` voltam junto: é por elas que a tela sabe de que
  // cartão se trata e como chamá-lo
  return { ferramenta: f.chave, descricao: f.descricao, resultado: paraOModelo(r) };
}
