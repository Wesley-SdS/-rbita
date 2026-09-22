import { generateText, stepCountIs, type ToolSet } from "ai";
import { buildModelChain, recordProviderResult, resolveModel, statusDoErro, fallbackModelKey } from "@orbita/llm";
import { log } from "../observability/logger";
import { registrarUso } from "../usage/registrar";

/**
 * Pedir texto a um modelo, com a política da casa e a conta registrada.
 *
 * Existe porque a Órbita tinha DUAS realidades. O chat montava cadeia de
 * candidatos, trocava de provedor quando um falhava e gravava o consumo.
 * Todo o resto — rotina, regra, resumo de reunião, comprovante, extrato,
 * compromissos, entidades da casa — chamava `resolveModel(fallbackModelKey())`:
 * uma chave só, sem alternativa e sem registro.
 *
 * O efeito prático disso foi medido em 22/09/2026. O "modelo reserva" nasce
 * vazio, e vazio significa `local/qwen2.5:7b`; com o Ollama desligado, resumir
 * reunião e ler comprovante batiam em `Cannot connect to API` e desistiam, sem
 * tentar nenhum dos provedores de nuvem que a casa tinha configurados.
 *
 * Agora a escolha do dono (`llm.failoverOrder`: assinatura, local, nuvem paga)
 * vale para a plataforma inteira, e não só para o chat. Um fluxo que queira
 * outro modelo continua podendo pedir (`modeloPreferido`), e aí ele entra como
 * primeiro da cadeia — preferência, não exclusividade: se ele falhar, os
 * outros ainda atendem.
 */
export interface PedidoDeTexto {
  userId: string;
  /** para a conta: "rotina", "resumo_reuniao", "ocr"… (ver FLUXO) */
  fluxo: string;
  referencia?: string | null;
  system?: string;
  prompt: string;
  tools?: ToolSet;
  maxSteps?: number;
  /** modelo que este fluxo prefere; vazio usa a política da casa */
  modeloPreferido?: string;
}

export interface TextoGerado {
  texto: string;
  /** qual modelo de fato respondeu (pode não ser o preferido, se ele falhou) */
  modelKey: string;
}

/**
 * Tenta os candidatos em ordem até um responder. Cada tentativa, mesmo a que
 * falha, alimenta o disjuntor — é assim que uma conta no limite deixa de ser
 * tentada nas chamadas seguintes.
 */
export async function gerarTexto(p: PedidoDeTexto): Promise<TextoGerado> {
  const preferido = p.modeloPreferido?.trim() || (await fallbackModelKey());
  const candidatos = buildModelChain(preferido);
  if (!candidatos.length) throw new Error("Nenhum modelo disponível para atender este pedido.");

  let ultimoErro: unknown = null;
  for (const modelKey of candidatos) {
    const comecou = Date.now();
    try {
      const r = await generateText({
        model: resolveModel(modelKey),
        ...(p.system ? { system: p.system } : {}),
        prompt: p.prompt,
        ...(p.tools ? { tools: p.tools } : {}),
        ...(p.maxSteps ? { stopWhen: stepCountIs(p.maxSteps) } : {}),
      });
      recordProviderResult(modelKey, true);
      registrarUso({
        userId: p.userId,
        fluxo: p.fluxo,
        referencia: p.referencia,
        modelKey,
        consumo: {
          unidade: "tokens",
          entrada: r.usage?.inputTokens ?? 0,
          saida: r.usage?.outputTokens ?? 0,
          // o `usage` do SDK não traz cache; quem informa é o metadado do
          // provedor, e cada um usa um nome diferente
          entradaCache: Number((r.providerMetadata?.anthropic as { cacheReadInputTokens?: number } | undefined)?.cacheReadInputTokens ?? 0),
        },
        duracaoMs: Date.now() - comecou,
      });
      return { texto: r.text?.trim() || "", modelKey };
    } catch (e) {
      ultimoErro = e;
      const status = statusDoErro(e);
      recordProviderResult(modelKey, false, status);
      // a tentativa que falhou também vai para a conta: às vezes ela custou
      // (erro depois do primeiro token), e sempre custou TEMPO
      registrarUso({
        userId: p.userId,
        fluxo: p.fluxo,
        referencia: p.referencia,
        modelKey,
        consumo: { unidade: "tokens", entrada: 0, saida: 0 },
        duracaoMs: Date.now() - comecou,
        erro: (status ? `${status}: ` : "") + (e instanceof Error ? e.message : String(e)).slice(0, 200),
      });
      log.warn("gerar.tentativa_falhou", { fluxo: p.fluxo, modelKey, status });
    }
  }
  throw ultimoErro instanceof Error ? ultimoErro : new Error("Todos os modelos falharam.");
}

/**
 * A mesma política e a mesma conta, para quem precisa de JSON em vez de texto.
 *
 * O `generateStructured` recebe o modelo já resolvido e faz até duas chamadas
 * (a segunda é o reparo, quando o modelo erra o formato). As DUAS entram na
 * conta: o reparo acontece justamente quando o modelo está indo mal, então é
 * o gasto que mais interessa enxergar.
 */
export async function gerarEstruturado<T>(
  p: Omit<PedidoDeTexto, "tools" | "maxSteps">,
  schema: import("zod").ZodType<T>,
): Promise<{ dados: T; modelKey: string }> {
  const { generateStructured } = await import("../meetings/structured");
  const preferido = p.modeloPreferido?.trim() || (await fallbackModelKey());
  const candidatos = buildModelChain(preferido);
  if (!candidatos.length) throw new Error("Nenhum modelo disponível para atender este pedido.");

  let ultimoErro: unknown = null;
  for (const modelKey of candidatos) {
    const comecou = Date.now();
    let entrada = 0;
    let saida = 0;
    let cache = 0;
    try {
      const dados = await generateStructured(resolveModel(modelKey), p.prompt, schema, (u) => {
        entrada += u.inputTokens ?? 0;
        saida += u.outputTokens ?? 0;

      });
      recordProviderResult(modelKey, true);
      registrarUso({
        userId: p.userId,
        fluxo: p.fluxo,
        referencia: p.referencia,
        modelKey,
        consumo: { unidade: "tokens", entrada, saida, entradaCache: cache },
        duracaoMs: Date.now() - comecou,
      });
      return { dados, modelKey };
    } catch (e) {
      ultimoErro = e;
      const status = statusDoErro(e);
      recordProviderResult(modelKey, false, status);
      registrarUso({
        userId: p.userId,
        fluxo: p.fluxo,
        referencia: p.referencia,
        modelKey,
        // o que já foi consumido antes de falhar continua sendo gasto
        consumo: { unidade: "tokens", entrada, saida, entradaCache: cache },
        duracaoMs: Date.now() - comecou,
        erro: (status ? `${status}: ` : "") + (e instanceof Error ? e.message : String(e)).slice(0, 200),
      });
      log.warn("gerar.estruturado_falhou", { fluxo: p.fluxo, modelKey, status });
    }
  }
  throw ultimoErro instanceof Error ? ultimoErro : new Error("Todos os modelos falharam.");
}

/**
 * O modelo que a casa usaria agora, já resolvido, para quem precisa passar um
 * `LanguageModel` adiante (o resumo de reunião faz dezenas de chamadas com o
 * mesmo modelo).
 *
 * Aqui não há failover por chamada: o que a cadeia dá é a POLÍTICA (ordem de
 * preferência do dono) e o disjuntor (provedor sabidamente fora do ar não é
 * escolhido). Quem puder usar `gerarTexto` tem os dois e deve preferi-lo.
 */
export async function modeloDaCasa(modeloPreferido?: string): Promise<{ model: ReturnType<typeof resolveModel>; modelKey: string }> {
  const preferido = modeloPreferido?.trim() || (await fallbackModelKey());
  const modelKey = buildModelChain(preferido)[0];
  if (!modelKey) throw new Error("Nenhum modelo disponível para atender este pedido.");
  return { model: resolveModel(modelKey), modelKey };
}
