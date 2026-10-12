import type { ControleSessao } from "@orbita/db/controle-schema";
import { sessaoAtual } from "./sessao";
import { ultimoPasso } from "./trilha";

/**
 * O estado da sessão em poucas linhas: é o que o `controle_status` devolve ao
 * modelo e o que vira o cartão "Órbita no controle" (`chat/cartoes-da-tela.ts`).
 * Toda tool de computador e navegador pode devolver `{ controle: ... }` junto
 * do próprio resultado, e o cartão da tela se atualiza sozinho.
 *
 * O último passo vai sem o resultado: o resultado pode ter texto da página, e
 * o modelo não precisa reler conteúdo de terceiro para saber em que passo está.
 */
export interface ResumoDoControle {
  sessaoId: string;
  objetivo: string;
  alvo: string;
  status: string;
  motivo: string | null;
  passosUsados: number;
  tetoPassos: number;
  /** ISO */
  expiraEm: string;
  apps: string[];
  sites: string[];
  ultimoPasso: { tool: string; acao: string | null; decisao: string; quando: string } | null;
  /** miniatura do último passo, quando o dono deixou guardar */
  miniatura?: string | null;
}

export function resumirSessao(s: ControleSessao, ultimo: { tool: string; acao: string | null; decisao: string; criadoEm: Date; miniatura?: string | null } | null): ResumoDoControle {
  return {
    sessaoId: s.id,
    objetivo: s.objetivo,
    alvo: s.alvo,
    status: s.status,
    motivo: s.motivo,
    passosUsados: s.passosUsados,
    tetoPassos: s.tetoPassos,
    expiraEm: s.expiraEm.toISOString(),
    apps: s.apps,
    sites: s.sites,
    ultimoPasso: ultimo ? { tool: ultimo.tool, acao: ultimo.acao, decisao: ultimo.decisao, quando: ultimo.criadoEm.toISOString() } : null,
    miniatura: ultimo?.miniatura ?? null,
  };
}

/** A sessão aberta agora (ativa ou pausada) com o último passo, ou null. */
export async function resumoDoControle(userId: string): Promise<ResumoDoControle | null> {
  const s = await sessaoAtual(userId, true);
  if (!s) return null;
  return resumirSessao(s, await ultimoPasso(userId, s.id));
}
