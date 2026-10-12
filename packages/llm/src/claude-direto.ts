/**
 * CLAUDE DIRETO PELA ASSINATURA (PRD-COMPUTADOR-E-NAVEGADOR §5.6, A8 e B3).
 *
 * O `@ai-sdk/anthropic@4.0.16` não conhece os toolsets novos de computer use
 * (`computer_toolset_20260801`, `browser_toolset_20260801`): o tipo some no
 * caminho do SDK e os modelos 5.5 recusam a versão antiga com 400. Os laços
 * delegados (computador e Chrome) chamam a Messages API direto, com os MESMOS
 * cabeçalhos OAuth que `resolveModel` usa para a família `claude`:
 *   - Bearer do `CLAUDE_CODE_OAUTH_TOKEN` (nunca `x-api-key`);
 *   - `anthropic-beta: oauth-2025-04-20` (e os betas extras pedidos, depois dele);
 *   - o 1º bloco de system EXATAMENTE a identidade do Claude Code, senão a API
 *     OAuth rejeita com um 429 mascarado.
 *
 * Compartilhado pelas frentes A e B: a assinatura é esta e não muda sem as duas.
 */

export const IDENTIDADE_CLAUDE_CODE = "You are Claude Code, Anthropic's official CLI for Claude.";

const URL_MENSAGENS = "https://api.anthropic.com/v1/messages";

export type BlocoClaude = Record<string, unknown> & { type: string };

export interface MensagemClaude {
  role: "user" | "assistant";
  content: string | BlocoClaude[];
}

export interface PedidoClaudeDireto {
  /** "claude/claude-sonnet-5-5" ou só o id ("claude-sonnet-5-5") */
  modelo: string;
  /** o system da tarefa; a identidade do Claude Code entra antes dele sozinha */
  system: string;
  mensagens: MensagemClaude[];
  tools?: Record<string, unknown>[];
  maxTokens: number;
  /** betas além do OAuth, acrescentados DEPOIS dele no cabeçalho */
  betas?: string[];
  /**
   * Marca o último bloco de system com `cache_control`: o prefixo estável
   * (definição do toolset + system) é lido do cache nas rodadas seguintes. O
   * ganho aparece em `cache_read_input_tokens` do `usage`.
   */
  cachearPrefixo?: boolean;
  /** corta a chamada (o "parar" do dono) */
  signal?: AbortSignal;
  /**
   * Teto da chamada, em ms. Sem ele uma resposta que nunca chega prendia o
   * laço delegado para sempre (só o `signal` do dono a soltava). Estourou,
   * lança `ErroClaudeDireto` com status 0 e o motivo.
   */
  timeoutMs?: number;
  /** só para testes */
  fetchImpl?: typeof fetch;
}

export interface RespostaClaudeDireto {
  content: BlocoClaude[];
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

export class ErroClaudeDireto extends Error {
  constructor(
    public readonly status: number,
    public readonly corpo: string,
  ) {
    super(`Claude respondeu ${status}: ${corpo.slice(0, 300)}`);
    this.name = "ErroClaudeDireto";
  }
}

/** "claude/claude-sonnet-5-5" → "claude-sonnet-5-5". Puro. */
export function idDoModeloClaude(modelo: string): string {
  const m = modelo.trim();
  return m.startsWith("claude/") ? m.slice("claude/".length) : m;
}

/** O corpo que vai para a API, com a identidade como 1º bloco de system. Puro. */
export function corpoClaudeDireto(p: Omit<PedidoClaudeDireto, "signal" | "fetchImpl" | "timeoutMs">): Record<string, unknown> {
  const system: BlocoClaude[] = [{ type: "text", text: IDENTIDADE_CLAUDE_CODE }];
  const resto = p.system.startsWith(IDENTIDADE_CLAUDE_CODE) ? p.system.slice(IDENTIDADE_CLAUDE_CODE.length).trim() : p.system.trim();
  if (resto) system.push({ type: "text", text: resto });
  if (p.cachearPrefixo) system[system.length - 1] = { ...system[system.length - 1]!, cache_control: { type: "ephemeral" } };
  const corpo: Record<string, unknown> = { model: idDoModeloClaude(p.modelo), max_tokens: p.maxTokens, system, messages: p.mensagens };
  if (p.tools?.length) corpo.tools = p.tools;
  return corpo;
}

export function claudeDiretoDisponivel(): boolean {
  return Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN);
}

export async function chamarClaudeDireto(p: PedidoClaudeDireto): Promise<RespostaClaudeDireto> {
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!token) throw new Error("CLAUDE_CODE_OAUTH_TOKEN não configurado");
  const betas = ["oauth-2025-04-20", ...(p.betas ?? []).filter((b) => b && b !== "oauth-2025-04-20")];
  // o teto da chamada junto com o "parar" do dono: o que vier primeiro corta (o corpo inteiro, não só os cabeçalhos)
  const prazo = p.timeoutMs && p.timeoutMs > 0 ? AbortSignal.timeout(p.timeoutMs) : null;
  const signal = prazo && p.signal ? AbortSignal.any([p.signal, prazo]) : (prazo ?? p.signal);
  const estourou = (e: unknown) => {
    if (prazo?.aborted && !p.signal?.aborted) throw new ErroClaudeDireto(0, `sem resposta em ${Math.round(p.timeoutMs! / 1000)} s`);
    throw e;
  };
  const r = await (p.fetchImpl ?? fetch)(URL_MENSAGENS, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "anthropic-beta": betas.join(","),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(corpoClaudeDireto(p)),
    signal,
  }).catch(estourou);
  const texto = await r.text().catch(estourou);
  if (!r.ok) throw new ErroClaudeDireto(r.status, texto);
  const j = JSON.parse(texto) as Partial<RespostaClaudeDireto>;
  return {
    content: Array.isArray(j.content) ? j.content : [],
    stop_reason: j.stop_reason ?? null,
    usage: { input_tokens: j.usage?.input_tokens ?? 0, output_tokens: j.usage?.output_tokens ?? 0, cache_read_input_tokens: j.usage?.cache_read_input_tokens, cache_creation_input_tokens: j.usage?.cache_creation_input_tokens },
  };
}
