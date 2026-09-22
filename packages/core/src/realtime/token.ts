/**
 * Token efêmero do Gemini, o segredo de vida curta que o navegador recebe no
 * lugar da chave da casa.
 *
 * Mora num arquivo próprio porque agora são DOIS usos com propósitos
 * diferentes: a conversa por voz e a transcrição ao vivo da reunião. O corpo
 * é mínimo de propósito — `liveConnectConstraints`, que travaria modelo e
 * config do lado do servidor, é recusado com "Cannot find field" nesta versão
 * da API (v1beta e v1alpha, conferido em 22/09/2026).
 */
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/auth_tokens";

/** Quanto tempo o token vale. Curto: ele serve para abrir UMA sessão e nada mais. */
const VALIDADE_MS = 10 * 60_000;

export async function criarTokenEfemeroGemini(apiKey: string, agora = Date.now()): Promise<string> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ uses: 1, expireTime: new Date(agora + VALIDADE_MS).toISOString() }),
  });
  if (!res.ok) {
    const detalhe = await res.text().catch(() => "");
    throw new Error(`gemini_token_${res.status}: ${detalhe.slice(0, 200)}`);
  }
  const data = (await res.json()) as { name?: string };
  if (!data.name) throw new Error("gemini_token_sem_nome");
  return data.name;
}
