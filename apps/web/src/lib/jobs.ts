/**
 * Fila de trabalho pesado (CLAUDE.md): os oito pontos do chat que antes
 * bloqueavam a requisição agora ENFILEIRAM e devolvem 202/200 com o recurso
 * de status no próprio corpo. Este módulo é o único lugar que sabe ler esse
 * contrato, para não espalhar `Retry-After` e o formato de erro pelos
 * painéis (lógica no backend/lib, não no componente, CLAUDE.md §6).
 */

export type JobStatus = "pendente" | "rodando" | "feito" | "falhou" | "cancelado";

export interface JobView {
  id: string;
  tipo: string;
  titulo: string;
  status: JobStatus;
  progresso: { feito: number; total: number | null; passo: string | null };
  tentativas: number;
  maxTentativas: number;
  proximaTentativaEm: string | null;
  erro: { mensagem: string; permanente: boolean } | null;
  resultado: Record<string, unknown> | null;
  cancelamentoPedido: boolean;
  criadoEm: string;
  atualizadoEm: string;
  iniciadoEm: string | null;
  finalizadoEm: string | null;
  /** só vem na resposta do enfileiramento: true quando o mesmo trabalho já estava na fila */
  jaExistia?: boolean;
}

export function isJobTerminal(status: JobStatus): boolean {
  return status === "feito" || status === "falhou" || status === "cancelado";
}

/**
 * Lê a resposta de um endpoint que passou a enfileirar (202 Accepted, ou 200
 * quando o mesmo trabalho já existia): o corpo já é o `JobView`. Lança com
 * `d.error` quando a validação falhou na hora (400/413, não enfileira).
 */
export async function enfileirar(resp: Response): Promise<JobView> {
  const d = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((d as { error?: string }).error ?? "Não foi possível enfileirar o trabalho.");
  return d as JobView;
}

/** Espera `ms` milissegundos, ou até o `signal` abortar (o que vier primeiro). */
function esperar(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return; }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

/**
 * Acompanha um trabalho por polling em `GET /api/jobs/:id`, respeitando o
 * `Retry-After` de CADA resposta (nunca um intervalo fixo escolhido aqui,
 * CLAUDE.md §5.6: quem manda no ritmo é o servidor). Piso de 1s se o header
 * faltar. Para quando o status vira terminal ou o `signal` aborta; abortar
 * só encerra o ACOMPANHAMENTO, o trabalho continua rodando no apps/api.
 */
export async function acompanharJob(inicial: JobView, onUpdate: (j: JobView) => void, signal?: AbortSignal, maxFalhasSeguidas = 5): Promise<JobView> {
  let atual = inicial;
  let esperaSegundos = 1; // antes do primeiro GET de status não há Retry-After nenhum para copiar
  let falhas = 0;
  while (!isJobTerminal(atual.status)) {
    await esperar(esperaSegundos * 1000, signal);
    if (signal?.aborted) return atual;

    let resp: Response | null = null;
    try {
      resp = await fetch(`/api/jobs/${atual.id}`, { signal });
    } catch {
      if (signal?.aborted) return atual;
    }
    // falha passageira (o api reiniciando no `tsx watch`, rede caindo, 5xx):
    // o TRABALHO continua no servidor, então desistir de acompanhar na primeira
    // falha deixaria a tela mentindo. Insiste com espera crescente, e só então
    // desiste. 4xx é definitivo (trabalho não existe ou não é seu).
    if (!resp || resp.status >= 500) {
      falhas++;
      if (falhas >= maxFalhasSeguidas) throw new Error("Perdi o contato com o servidor. O trabalho pode ter continuado: confira em Trabalhos em segundo plano.");
      esperaSegundos = Math.min(30, esperaSegundos * 2);
      continue;
    }
    if (!resp.ok) {
      const d = await resp.json().catch(() => ({}));
      throw new Error((d as { error?: string }).error ?? "Não foi possível acompanhar o trabalho.");
    }
    falhas = 0;
    const retryAfter = Number(resp.headers.get("Retry-After"));
    esperaSegundos = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 1;
    atual = (await resp.json()) as JobView;
    onUpdate(atual);
  }
  return atual;
}
