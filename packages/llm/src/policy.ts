/**
 * POLÍTICA DE MODELOS: o que o dono decide pela tela e o packages/llm precisa
 * respeitar sem depender do core (o core depende daqui, não o contrário).
 *
 * O core registra FONTES (getters que leem a tabela `setting`); `readPolicy()`
 * resolve todas e guarda o último valor bom. Quem é síncrono (a cadeia de
 * failover) usa `policySnapshot()`, que o chat atualiza no início de cada turno
 * via `applyLlmSettings()`. Sem fonte registrada (testes, script avulso), valem
 * os defaults abaixo, que são os mesmos declarados em settings/defs.ts.
 */

/**
 * Ordem do failover quando o modelo pedido falha antes do primeiro token.
 * Preço desconhecido nunca conta como custo zero (era o bug do RV.2: a nuvem
 * sem preço passava na frente do modelo local).
 *
 * O padrão foi "assinatura → local → paga" (decisão de 17/09) e virou
 * "assinatura → paga → local" em 27/09 (PRD-SEM-OLLAMA): sem GPU, o local é
 * inviável (chat de 186 s), e na nuvem ele nem existe. Com o local no fim, a
 * descoberta em `auto` nem pergunta ao Ollama.
 */
// "paga_primeiro" existe porque as outras três todas começam por assinatura
// ou por local. Numa casa com a assinatura no limite e sem GPU, isso obrigava
// a Órbita a tentar dois caminhos ruins antes de chegar no que funciona.
export const FAILOVER_ORDERS = ["assinatura_local_paga", "assinatura_paga_local", "paga_primeiro", "local_primeiro"] as const;
export type FailoverOrder = (typeof FAILOVER_ORDERS)[number];

/** Modelo pré-selecionado na UI: nuvem responde rápido; local mantém tudo em casa. */
export type DefaultPreference = "nuvem" | "local";

/** Procurar modelos no Ollama: `auto` só quando o local pode ser escolhido. */
export type DescobrirLocal = "auto" | "sempre" | "nunca";
/** Existe Ollama alcançável daqui? `auto` deduz do ambiente. */
export type LocalDisponivel = "auto" | "sim" | "nao";

export interface ModelPolicy {
  failoverOrder: FailoverOrder;
  defaultPreference: DefaultPreference;
  /** Chave fixada pelo dono para quando nada foi descoberto. Vazio = a ordem do dono decide. */
  fallbackModel: string;
  discoveryTtlMs: number;
  discoveryTimeoutMs: number;
  descobrirLocal: DescobrirLocal;
  localDisponivel: LocalDisponivel;
  /**
   * O modelo que o dono QUER de cada provedor (ex.: `claude/claude-sonnet-5`).
   * Sem isto a cadeia pega o mais forte de cada um, e na assinatura isso é o
   * Opus: mais lento e gasta a cota bem mais depressa. Vazio = o mais forte.
   */
  modelosPreferidos: string[];
  /**
   * Modelo do "auto" para pedido COMPLEXO (código, análise, texto longo). Vazio:
   * o complexo vai para o preferido como qualquer outro pedido.
   */
  modeloComplexo: string;
}

/**
 * Chave fixada por env para quando NADA foi descoberto. Vazia por padrão.
 *
 * Foi `local/qwen2.5:7b` até 27/09/2026, e era um último recurso que não
 * existia: sem Ollama (e na Render nunca há), a cadeia vazia ganhava uma chave
 * quebrada e o erro virava "Cannot connect to API" em vez de dizer o que
 * fazer. Vazio, quem chama recebe cadeia vazia e explica (`SEM_MODELO`).
 */
export const BOOTSTRAP_MODEL_KEY = process.env.ORBITA_FALLBACK_MODEL ?? "";

/** O que dizer quando não há modelo nenhum: o dono precisa saber o que fazer, não ler um erro de rede. */
export const SEM_MODELO = "Nenhum modelo disponível: configure uma chave em Ajustes, Modelos, ou suba o Ollama.";

/** Ambientes gerenciados onde `localhost` é o próprio contêiner, sem Ollama nenhum. */
const AMBIENTE_GERENCIADO = ["VERCEL", "RENDER", "FLY_APP_NAME", "K_SERVICE"] as const;

/**
 * Existe Ollama alcançável daqui? Puro, para teste.
 *
 * A pergunta já foi "estou na Vercel?", e só a Vercel era protegida: na
 * Render, um modelo local descoberto ou fixado entrava na cadeia apontando
 * para um localhost vazio. Ollama REMOTO (URL que não é localhost) continua
 * valendo em qualquer ambiente, e o dono pode forçar a resposta pela tela.
 */
export function ollamaAlcancavel(escolha: LocalDisponivel, env: Record<string, string | undefined>): boolean {
  if (escolha === "sim") return true;
  if (escolha === "nao") return false;
  const base = env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
  const apontaParaCasa = /localhost|127\.0\.0\.1|host\.docker\.internal/.test(base);
  return !(apontaParaCasa && AMBIENTE_GERENCIADO.some((k) => env[k]));
}

/**
 * Vale a pena perguntar ao Ollama quais modelos ele tem? Puro, para teste.
 *
 * Em `auto`, só quando o local pode de fato ser escolhido: preferido pelo dono
 * ou posto antes de alguma nuvem na ordem. Antes a descoberta perguntava
 * sempre, e com o Ollama desligado cada renovação pagava o timeout inteiro
 * para achar um modelo que a ordem do dono nunca usaria.
 */
export function deveDescobrirLocal(p: Pick<ModelPolicy, "descobrirLocal" | "failoverOrder" | "defaultPreference" | "localDisponivel">, env: Record<string, string | undefined>): boolean {
  if (!ollamaAlcancavel(p.localDisponivel, env)) return false;
  if (p.descobrirLocal === "sempre") return true;
  if (p.descobrirLocal === "nunca") return false;
  return p.defaultPreference === "local" || p.failoverOrder === "local_primeiro" || p.failoverOrder === "assinatura_local_paga";
}

type Source<T> = () => T | Promise<T>;
type PolicySources = { [K in keyof ModelPolicy]?: Source<ModelPolicy[K]> };

const current: ModelPolicy = {
  failoverOrder: "assinatura_paga_local",
  defaultPreference: "nuvem",
  fallbackModel: "",
  discoveryTtlMs: Number(process.env.MODEL_DISCOVERY_TTL_MS ?? 5 * 60_000),
  discoveryTimeoutMs: 4000,
  descobrirLocal: "auto",
  localDisponivel: "auto",
  modelosPreferidos: [],
  modeloComplexo: "",
};
let sources: PolicySources = {};

/** Registra de onde vem cada valor (chamado uma vez pelo core, no import das settings). */
export function configureModelPolicy(p: PolicySources): void {
  sources = { ...sources, ...p };
}

/** Resolve as fontes; uma fonte que falha mantém o último valor bom (fail-soft). */
export async function readPolicy(): Promise<ModelPolicy> {
  const keys = Object.keys(sources) as (keyof ModelPolicy)[];
  await Promise.all(
    keys.map(async (k) => {
      try {
        const v = await sources[k]!();
        if (v !== undefined && v !== null) (current as unknown as Record<string, unknown>)[k] = v;
      } catch {
        // banco fora: fica o último valor conhecido
      }
    }),
  );
  return { ...current };
}

/** Valor atual sem ir ao banco (para código síncrono). */
export function policySnapshot(): ModelPolicy {
  return { ...current };
}

/** O Ollama é alcançável daqui, pela política atual (síncrono, sem rede). */
export function localAvailable(): boolean {
  return ollamaAlcancavel(current.localDisponivel, process.env);
}

/**
 * Modelo reserva efetivo: o da config, ou o de bootstrap. Pode ser VAZIO, e
 * vazio quer dizer "a ordem do dono decide": ninguém fixou um reserva.
 *
 * ATENÇÃO ao que isto NÃO é: não é "o modelo que resumo, memória e rotinas
 * devem usar". Ele é o ÚLTIMO recurso, e usá-lo como primeira escolha foi um
 * bug real: o bootstrap é `local/qwen2.5:7b`, então toda tarefa da casa ia
 * para o modelo local mesmo com a ordem do dono em "assinatura primeiro".
 * Medido em 27/09/2026: resumo de reunião em 123 s e extração de memória em
 * 87 s na CPU, afogando a máquina. Quem escolhe o modelo da casa é
 * `modeloDaCasa`, pela ordem da política. Ver `llm/gerar.ts`.
 */
export async function fallbackModelKey(): Promise<string> {
  const p = await readPolicy();
  return p.fallbackModel.trim() || BOOTSTRAP_MODEL_KEY;
}

/** Só para testes: volta aos defaults e esquece as fontes. */
export function resetModelPolicyForTests(over: Partial<ModelPolicy> = {}): void {
  sources = {};
  Object.assign(current, {
    failoverOrder: "assinatura_paga_local",
    defaultPreference: "nuvem",
    fallbackModel: "",
    discoveryTtlMs: 5 * 60_000,
    discoveryTimeoutMs: 4000,
    descobrirLocal: "auto",
    localDisponivel: "auto",
    modelosPreferidos: [],
    modeloComplexo: "",
    ...over,
  });
}
