/**
 * Quem atende a conversa por voz em tempo real.
 *
 * Existem dois caminhos, e eles NÃO são equivalentes em preço. Medido em
 * 21/09/2026 sobre os preços públicos: o `gpt-realtime` da OpenAI sai entre
 * US$ 0,06 e 0,11 por minuto de conversa; o Gemini Live fica perto de
 * US$ 0,01 no mesmo uso. Em meia hora por dia a diferença é a conta do mês
 * inteiro (≈ US$ 60-99 contra ≈ US$ 10), e foi por isso que o segundo
 * provedor entrou.
 *
 * Por isso o "auto" prefere o Gemini: numa casa que já tem a chave do Google
 * configurada (e tem, porque é a mesma chave dos embeddings), ligar a voz não
 * deve criar uma conta nova nem multiplicar o custo por cinco. Quem quiser o
 * outro escolhe na tela — a preferência é config, não constante (§5.6).
 */
export type RealtimePreference = "auto" | "openai" | "gemini";
export type RealtimeProvider = "openai" | "gemini";

export interface ChavesRealtime {
  openai: boolean;
  gemini: boolean;
}

/**
 * Provedor efetivo, dada a preferência do dono e as chaves que existem.
 * `null` significa "modo tempo real indisponível" — a UI esconde o botão.
 *
 * Preferência explícita SEM a chave correspondente devolve `null` em vez de
 * cair no outro: se o dono escolheu Gemini para não gastar, cair calado na
 * OpenAI seria justamente a surpresa na fatura que esta função evita.
 */
export function escolherProvedorRealtime(pref: RealtimePreference, chaves: ChavesRealtime): RealtimeProvider | null {
  if (pref !== "auto") return chaves[pref] ? pref : null;
  if (chaves.gemini) return "gemini";
  if (chaves.openai) return "openai";
  return null;
}
