import { log } from "../observability/logger";

/**
 * ESPELHO DO ENVELOPE (PRD §5.1, F2): as mãos (o `apps/maos` no Windows e a
 * extensão no Chrome) guardam uma cópia da sessão ativa e RECUSAM alvo fora
 * dela, do lado delas. Se o api tiver um bug, as mãos continuam recusando.
 *
 * Quem implementa: o cliente do `apps/maos` (frente A) e o gateway da extensão
 * (frente B) registram um ouvinte no boot com `registrarEspelho`. O core avisa
 * TODOS a cada mudança: sessão ativada, pausada, encerrada, parada. Ouvinte
 * que falha ou demora não atrasa os outros nem a sessão (cada um tem prazo).
 *
 * Contrato para as mãos:
 *   - `envelope`: substitui o espelho inteiro por este (uma sessão por dono);
 *   - `fim`: a sessão saiu de ativa; daqui em diante, recusar toda ordem dela;
 *   - `parar`: o dono mandou parar TUDO. Matar a árvore de processos do
 *     terminal, soltar o `chrome.debugger`, tirar a borda. Não esperar o api
 *     para nada: o parar também nasce do lado das mãos (atalho global, mouse
 *     real, botão na aba) e, nesse caso, elas chamam `POST /api/controle/parar`
 *     DEPOIS de já terem parado.
 */

export interface EnvelopeEspelhado {
  sessaoId: string;
  alvo: "computador" | "navegador" | "ambos";
  objetivo: string;
  apps: string[];
  sites: string[];
  tetoPassos: number;
  passosUsados: number;
  /** ISO */
  expiraEm: string;
  maquina: string;
}

export type EventoDoEspelho =
  | { tipo: "envelope"; userId: string; envelope: EnvelopeEspelhado }
  | { tipo: "fim"; userId: string; sessaoId: string; status: "pausada" | "encerrada" | "parada"; motivo: string }
  | { tipo: "parar"; userId: string; origem: string };

export interface MaosEspelho {
  /** "maos", "extensao": aparece no log quando o aviso falha */
  nome: string;
  notificar(evento: EventoDoEspelho): Promise<void>;
}

const ouvintes = new Map<string, MaosEspelho>();

/** Registra (ou troca, pelo nome) um ouvinte. Devolve a função que o tira. */
export function registrarEspelho(m: MaosEspelho): () => void {
  ouvintes.set(m.nome, m);
  return () => {
    if (ouvintes.get(m.nome) === m) ouvintes.delete(m.nome);
  };
}

export function espelhosRegistrados(): string[] {
  return [...ouvintes.keys()];
}

/** Só para testes. */
export function _limparEspelhos(): void {
  ouvintes.clear();
}

export interface ResultadoDoEspelho {
  nome: string;
  ok: boolean;
  erro?: string;
}

/**
 * Avisa todos os ouvintes em paralelo, cada um com `prazoMs`. Nunca lança: a
 * sessão já mudou no banco, e quem não confirmou aparece no resultado e no log.
 */
export async function espelhar(evento: EventoDoEspelho, prazoMs: number): Promise<ResultadoDoEspelho[]> {
  const lista = [...ouvintes.values()];
  return Promise.all(
    lista.map(async (m): Promise<ResultadoDoEspelho> => {
      let relogio: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          m.notificar(evento),
          new Promise<never>((_, rej) => {
            relogio = setTimeout(() => rej(new Error(`sem resposta em ${prazoMs} ms`)), prazoMs);
          }),
        ]);
        return { nome: m.nome, ok: true };
      } catch (e) {
        const erro = e instanceof Error ? e.message : String(e);
        log.warn("controle.espelho_falhou", { ouvinte: m.nome, tipo: evento.tipo, erro });
        return { nome: m.nome, ok: false, erro };
      } finally {
        if (relogio) clearTimeout(relogio);
      }
    }),
  );
}
