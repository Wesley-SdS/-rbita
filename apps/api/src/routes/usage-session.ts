import { z } from "zod";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { linhasDaSessao } from "@orbita/core/usage/sessao";
import { FLUXO, registrarUso } from "@orbita/core/usage/registrar";
import { log } from "@orbita/core/observability/logger";

/**
 * POST /api/uso/sessao — a conta da voz em tempo real.
 *
 * O áudio da sessão vai do navegador DIRETO ao provedor, por WebSocket ou
 * WebRTC: é o que mantém a latência baixa, e é também o motivo de o gasto mais
 * caro da casa ter ficado fora da tela de Gastos até aqui. O provedor devolve
 * `usageMetadata` a cada resposta; o cliente acumula e entrega por esta rota.
 *
 * Tudo que chega aqui é ENTRADA NÃO CONFIÁVEL (§5.6): são números do navegador
 * que viram dinheiro numa tela. Por isso o zod tem teto em cada campo, e o que
 * passar do teto é recusado em vez de truncado — um relato absurdo é sinal de
 * defeito no cliente, e engolir calado transformaria o defeito em conta errada.
 */

// 8 milhões de tokens é mais do que uma sessão de 8 horas produz em áudio
// (32 tokens/s dariam ~920 mil); serve de teto sem estorvar uso real.
const TOKENS = z.number().int().min(0).max(8_000_000).optional();

const Body = z.object({
  fluxo: z.enum([FLUXO.vozTempoReal, FLUXO.transcricaoViva]),
  provedor: z.enum(["gemini", "openai"]),
  modelo: z.string().min(1).max(80),
  audioEntrada: TOKENS,
  audioSaida: TOKENS,
  textoEntrada: TOKENS,
  textoSaida: TOKENS,
  videoEntrada: TOKENS,
  segundos: z.number().int().min(0).max(24 * 3600).optional(),
  duracaoMs: z.number().int().min(0).max(24 * 3600 * 1000).optional(),
});

export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });

  const { fluxo, duracaoMs, ...relato } = parsed.data;
  const linhas = linhasDaSessao(relato);
  for (const l of linhas) {
    registrarUso({ userId: session.user.id, fluxo, referencia: relato.modelo, servico: l.servico, consumo: l.consumo, duracaoMs });
  }

  // o log fecha o ciclo: se um dia a tela mostrar zero de voz, dá para saber
  // se foi o cliente que não relatou ou o registro que não gravou
  log.info("uso.sessao", { userId: session.user.id, fluxo, provedor: relato.provedor, linhas: linhas.length });
  return Response.json({ registradas: linhas.length });
}
