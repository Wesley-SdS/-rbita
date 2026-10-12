import type { z } from "zod";
import { toolDefsForRealtime } from "../tools/index";
import { funcoesDoPcDeVoz } from "../controle/voz";
import { funcoesMcpDeVoz } from "../mcp/voz";
import { settings } from "../settings";
import { log } from "../observability/logger";

/** O que vira função declarada na sessão: tool nativa do registro ou função de despacho. */
export interface FuncaoDaVoz {
  name: string;
  description: string;
  inputSchema: z.ZodType;
}

/**
 * Corta a lista no teto (`realtime.toolsMax`). As de despacho (computador e
 * servidores externos) entram primeiro, porque cada uma abre dezenas de
 * ferramentas; as nativas preenchem o resto na ordem de registro. Sem isto, a
 * próxima tool fora dos domínios sensíveis fazia a OpenAI recusar a sessão
 * inteira e a voz caía (I14 da auditoria: 127 de 128, sem trava em produção).
 * Puro, a não ser pelo aviso no log.
 */
export function comTetoDaVoz(nativas: FuncaoDaVoz[], despacho: FuncaoDaVoz[], teto: number): FuncaoDaVoz[] {
  if (nativas.length + despacho.length <= teto) return [...nativas, ...despacho];
  const cabem = Math.max(0, teto - despacho.length);
  const fora = nativas.slice(cabem).map((f) => f.name);
  log.warn("realtime.teto_de_funcoes", { teto, nativas: nativas.length, despacho: despacho.length, cortadas: fora.length, nomes: fora.slice(0, 40) });
  return [...nativas.slice(0, cabem), ...despacho].slice(0, teto);
}

/**
 * A lista INTEIRA de funções que a sessão de voz em tempo real declara: as
 * nativas (sem as do controle do PC), as duas do controle do PC
 * (`controle/voz.ts`) e as duas dos servidores MCP (`mcp/voz.ts`), cortada no
 * teto. Mora num lugar só para a rota e o teste do teto medirem a mesma coisa.
 */
export async function funcoesDaVoz(userId: string): Promise<FuncaoDaVoz[]> {
  const [nativas, doPc, externas, teto] = await Promise.all([
    toolDefsForRealtime(userId),
    funcoesDoPcDeVoz(userId),
    funcoesMcpDeVoz(userId),
    settings.get("realtime.toolsMax").catch(() => 128),
  ]);
  return comTetoDaVoz(nativas, [...doPc, ...externas], teto);
}
