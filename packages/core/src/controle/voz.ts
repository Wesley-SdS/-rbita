import { z } from "zod";
import { effectiveRisk, executarPeloRegistro, getTool, loadToolOverrides, needsApproval, selectRelevant, sensiveisDaVoz, type ToolContext } from "../tools/index";
import { ehToolSensivel } from "./dominios";
import { semImagem } from "./imagem";

/**
 * As tools do controle do PC (controle, terminal, arquivos, computador,
 * navegador) na VOZ em tempo real.
 *
 * A voz declara todas as tools nativas de uma vez (decisão do dono,
 * 27/09/2026), e o catálogo passou do teto da OpenAI Realtime (128 funções).
 * As do controle do PC são as que melhor saem da lista: só valem com o
 * controle ligado, o dono as pede com um assunto claro ("abre o site",
 * "o que tem na aba") e cada uma já é compacta (`acao` em enum). Por isso a
 * voz ganha DUAS funções no lugar delas, no mesmo desenho do MCP
 * (`mcp/voz.ts`): uma acha pelo assunto, a outra usa a escolhida.
 *
 * Nada muda na segurança: `usar_ferramenta_do_pc` só aceita tool de domínio
 * sensível e executa SEMPRE por `executarPeloRegistro` com canal "voz", o
 * mesmo caminho do resto da voz (disponibilidade, controle ligado e canal
 * liberado, só o dono, `authorize`, risco efetivo, fila, trilha, sessão e
 * crítico). Nunca chama `def.run`. A proposta nasce no canal "voz", para o
 * "manda" falado achá-la, e a `perigoso` continua saindo só pela tela.
 */

export const BUSCAR_NO_PC = "buscar_ferramenta_do_pc";
export const USAR_NO_PC = "usar_ferramenta_do_pc";

const EntradaBuscar = z.object({
  busca: z.string().min(1).max(300).describe("O assunto, com as palavras do dono: \"abrir um site\", \"ler a aba\", \"parar o controle\"."),
});
const EntradaUsar = z.object({
  ferramenta: z.string().min(1).max(120).describe("O `nome` exato devolvido por buscar_ferramenta_do_pc."),
  argumentos_json: z
    .string()
    .max(20_000)
    .optional()
    .describe("Os argumentos da ferramenta, como um objeto JSON em texto (ex.: {\"acao\":\"abas\"}). Vazio quando ela não pede nenhum."),
});

export interface FuncaoDoPcDeVoz {
  name: string;
  description: string;
  inputSchema: z.ZodType;
}

/** As duas funções, só quando alguma tool do controle do PC vale na voz agora. */
export async function funcoesDoPcDeVoz(userId: string): Promise<FuncaoDoPcDeVoz[]> {
  const defs = await sensiveisDaVoz(userId).catch(() => []);
  if (!defs.length) return [];
  return [
    {
      name: BUSCAR_NO_PC,
      description: "Acha as ferramentas de mexer no computador do dono (Chrome, abas, sites, sessão de controle) pelo assunto. Use ANTES de usar_ferramenta_do_pc sempre que o pedido for sobre o computador ou o navegador. Devolve nome, descrição e parâmetros de cada uma.",
      inputSchema: EntradaBuscar,
    },
    {
      name: USAR_NO_PC,
      description: "Usa uma ferramenta achada por buscar_ferramenta_do_pc. Leitura responde na hora; o que altera algo pode virar proposta para o dono aprovar (diga \"deixei pronto para você aprovar\", nunca \"fiz\").",
      inputSchema: EntradaUsar,
    },
  ];
}

export function ehFuncaoDoPcDeVoz(nome: string): boolean {
  return nome === BUSCAR_NO_PC || nome === USAR_NO_PC;
}

/** O JSON Schema da entrada, sem o cabeçalho `$schema`, que só gasta contexto da fala. */
function parametrosDe(schema: z.ZodType): Record<string, unknown> {
  try {
    const { $schema: _fora, ...resto } = z.toJSONSchema(schema) as Record<string, unknown>;
    return resto;
  } catch {
    return { type: "object", properties: {} };
  }
}

export async function executarFuncaoDoPcDeVoz(
  userId: string,
  nome: string,
  entrada: unknown,
  requester?: ToolContext["requester"],
  origin?: ToolContext["origin"],
): Promise<unknown> {
  if (nome === BUSCAR_NO_PC) {
    const p = EntradaBuscar.safeParse(entrada ?? {});
    if (!p.success) return { erro: "Diga o assunto da busca." };
    const [defs, overrides] = await Promise.all([sensiveisDaVoz(userId), loadToolOverrides()]);
    if (!defs.length) return { erro: "O controle do computador não está disponível pela voz agora." };
    return {
      ferramentas: selectRelevant(defs, p.data.busca, 8, true).map((d) => ({
        nome: d.name,
        descricao: d.description,
        parametros: parametrosDe(d.inputSchema),
        // o declarado e o da tela; o alvo ainda pode subir o risco na hora de usar
        pede_aprovacao: needsApproval(effectiveRisk(d, overrides)),
      })),
    };
  }

  const p = EntradaUsar.safeParse(entrada ?? {});
  if (!p.success) return { erro: "Informe a ferramenta." };
  // só domínio sensível: esta porta não pode virar um atalho para as outras
  // tools, que a voz já tem declaradas e chegam por `runRealtimeTool`
  const def = getTool(p.data.ferramenta);
  if (!def || !ehToolSensivel(def)) return { erro: `Ferramenta "${p.data.ferramenta}" não existe. Chame buscar_ferramenta_do_pc primeiro.` };
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
  // Sem `pedido` DE PROPÓSITO (M14 da auditoria): a voz não tem a fala literal do
  // dono na hora da chamada. No Gemini a transcrição do pedido só chega no fim do
  // turno, DEPOIS da function call (medido, ver `use-voice.ts`), e usar a fala
  // anterior seria atribuir ao dono o pedido errado. Sem ele, `controle_iniciar`
  // grava `pedidoLiteral: false` e o texto do modelo, o resumo da fila diz "como
  // a Órbita entendeu" e o crítico é avisado de que o pedido não é literal.
  // a imagem (captura) não vai para a voz, como em `runRealtimeTool`
  const r = semImagem(await executarPeloRegistro(userId, def.name, args, { canal: "voz", requester, origin }));
  // o resultado vem ESPALHADO, não embrulhado: a tela da voz acha a proposta
  // (`proposta_enfileirada`, `id`) e a sessão de controle (`controle`) no
  // primeiro nível, como numa tool declarada
  return r && typeof r === "object" && !Array.isArray(r) ? { ferramenta: def.name, ...(r as Record<string, unknown>) } : { ferramenta: def.name, resultado: r };
}
