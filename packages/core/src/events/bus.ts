import { log } from "../observability/logger";

/**
 * EVENT BUS da Órbita: entrada única para tudo que pode disparar uma regra.
 *
 * Dois modos combinados:
 *   1. em processo: `emit()` acorda os handlers registrados aqui mesmo (rápido,
 *      é o caminho do apps/api, que é quem roda as regras);
 *   2. persistido (outbox): toda emissão grava em `event_log`. O apps/api lê o
 *      que outros processos gravaram (ex.: o Next aprovando uma ação) com
 *      `drainNew()` e despacha como se fosse local.
 *
 * Por que não um broker: um Postgres só, um dono só. A latência de polling
 * (segundos, configurável) é irrelevante para regras proativas; para o que
 * exige reação imediata (HA, câmeras) a fonte já chega no apps/api direto.
 */
export interface OrbitaEvent<P = Record<string, unknown>> {
  type: string;
  userId?: string | null;
  source: string;
  payload: P;
  /** presente quando o evento veio do banco (outbox) */
  id?: number;
  at: Date;
}

export type EventHandler = (ev: OrbitaEvent) => void | Promise<void>;

export interface EventBus {
  /** grava no outbox e despacha localmente (fail-soft nos dois) */
  emit(type: string, payload: Record<string, unknown>, opts?: { userId?: string | null; source?: string }): Promise<void>;
  /** `type` exato ou "*" para tudo */
  on(type: string, handler: EventHandler): () => void;
  /** despacha para os handlers locais sem gravar (usado pelo poller) */
  dispatch(ev: OrbitaEvent): Promise<void>;
}

export function createEventBus(opts: { source: string; persist?: (ev: OrbitaEvent) => Promise<number | undefined> }): EventBus {
  const handlers = new Map<string, Set<EventHandler>>();

  async function dispatch(ev: OrbitaEvent) {
    const targets = [...(handlers.get(ev.type) ?? []), ...(handlers.get("*") ?? [])];
    for (const h of targets) {
      try {
        await h(ev);
      } catch (e) {
        // um handler quebrado não impede os outros nem derruba o emissor
        log.error("events.handler_falhou", { type: ev.type, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  return {
    async emit(type, payload, o = {}) {
      const ev: OrbitaEvent = { type, payload, userId: o.userId ?? null, source: o.source ?? opts.source, at: new Date() };
      if (opts.persist) {
        try {
          ev.id = await opts.persist(ev);
        } catch (e) {
          log.warn("events.persist_falhou", { type, error: e instanceof Error ? e.message : String(e) });
        }
      }
      await dispatch(ev);
    },
    on(type, handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(handler);
      return () => handlers.get(type)?.delete(handler);
    },
    dispatch,
  };
}

/**
 * Separa pendentes em "despachar" e "só marcar": evento que ficou parado mais
 * que `maxAgeMs` (apps/api fora do ar por dias) não dispara aviso atrasado. Puro.
 */
export function partitionPending<T extends { at: Date }>(pendentes: T[], now: Date, maxAgeMs: number): { despachar: T[]; vencidos: T[] } {
  const despachar: T[] = [];
  const vencidos: T[] = [];
  for (const ev of pendentes) (now.getTime() - ev.at.getTime() > maxAgeMs ? vencidos : despachar).push(ev);
  return { despachar, vencidos };
}
