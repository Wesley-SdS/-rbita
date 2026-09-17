import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Permissão por pessoa e por cômodo aplicada a QUEM PEDE (Onda 9). A regra pura
 * está em `permission.test.ts`; aqui o que se prova é o encadeamento:
 *
 *   - dono e pedido sem identidade não restringem nada (comportamento de antes,
 *     e sem nenhuma leitura de acesso);
 *   - `allowedRooms` filtra em lote com UMA leitura só, e não com uma por cômodo;
 *   - entidade DESCONHECIDA nega para quem não é dono: "não sei onde isso fica"
 *     não pode virar permissão.
 *
 * Banco dublado (cadeia Drizzle): a decisão é o que importa, não o SQL.
 */

const fake = vi.hoisted(() => {
  type Consulta = { op: string; tabela: unknown; calls: Record<string, unknown[]> };
  const consultas: Consulta[] = [];
  const fila: { tabela: unknown; rows: unknown[] }[] = [];

  function cadeia() {
    const q: Consulta = { op: "select", tabela: undefined, calls: {} };
    consultas.push(q);
    const p: Record<string, unknown> = {
      then: (ok: (v: unknown[]) => void) => {
        const i = fila.findIndex((f) => f.tabela === q.tabela);
        ok(i >= 0 ? fila.splice(i, 1)[0]!.rows : []);
      },
    };
    for (const m of ["from", "where", "limit", "innerJoin", "leftJoin", "orderBy"]) {
      p[m] = (...args: unknown[]) => {
        q.calls[m] = args;
        if (m === "from") q.tabela = args[0];
        return p;
      };
    }
    return p;
  }

  return {
    db: { select: () => cadeia() },
    consultas,
    fila,
    reset() {
      consultas.length = 0;
      fila.length = 0;
    },
    responder(tabela: unknown, rows: unknown[]) {
      fila.push({ tabela, rows });
    },
    lidas(tabela: unknown) {
      return consultas.filter((q) => q.tabela === tabela);
    },
  };
});

vi.mock("@orbita/db", () => ({ db: fake.db }));

import { haEntity, personRoomAccess } from "@orbita/db/home-schema";
import type { Requester } from "../tools/registry";
import { allowedRooms, authorizeEntityForRequester, authorizeRoomForRequester } from "./room-permission";

const DONO_CONTA = "dono-1";
const quemPede = (over: Partial<Requester> = {}): Requester => ({ personId: "p1", name: "Anna", role: "morador", via: "conta", ...over });
const dono = quemPede({ role: "dono", personId: "p0", name: "Wesley" });
const visitante = quemPede({ role: "visitante", personId: "p9", name: "Cliente" });

const QUARTO = "quarto-1";
const SALA = "sala-1";

beforeEach(() => fake.reset());

describe("olhar um cômodo é tão restrito quanto acender a luz dele", () => {
  it("dono não é restringido, e nem custa uma leitura de acesso", async () => {
    expect(await authorizeRoomForRequester(QUARTO, dono, "ver a câmera")).toBeNull();
    expect(fake.consultas).toHaveLength(0);
  });

  it("sem saber quem pediu, segue como era antes (não restringe)", async () => {
    expect(await authorizeRoomForRequester(QUARTO, null, "ver a câmera")).toBeNull();
    expect(fake.consultas).toHaveLength(0);
  });

  it("morador passa por padrão; negação explícita do dono vence", async () => {
    expect(await authorizeRoomForRequester(QUARTO, quemPede(), "ver a câmera")).toBeNull();

    fake.reset();
    fake.responder(personRoomAccess, [{ roomId: QUARTO, allowed: false }]);
    const recusa = await authorizeRoomForRequester(QUARTO, quemPede(), "ver a câmera");
    expect(recusa).toBe("Quem pediu não tem permissão para ver a câmera neste cômodo.");
    // a recusa volta ao modelo (que pode ser de nuvem): sem o nome de quem pediu
    expect(recusa).not.toContain("Anna");
  });

  it("visitante começa restrito e só entra no cômodo liberado", async () => {
    expect(await authorizeRoomForRequester(QUARTO, visitante, "ver a câmera")).toMatch(/não tem permissão/);

    fake.reset();
    fake.responder(personRoomAccess, [{ roomId: SALA, allowed: true }]);
    expect(await authorizeRoomForRequester(SALA, visitante, "ver a câmera")).toBeNull();
  });

  it("quem pede sem pessoa cadastrada não consulta acesso nenhum", async () => {
    expect(await authorizeRoomForRequester(QUARTO, quemPede({ personId: null }), "ver a câmera")).toBeNull();
    expect(await authorizeRoomForRequester(QUARTO, quemPede({ personId: null, role: "visitante" }), "ver a câmera")).toMatch(/não tem permissão/);
    expect(fake.lidas(personRoomAccess)).toHaveLength(0);
  });
});

describe("filtro em lote de cômodos (varredura da casa)", () => {
  it("dono vê tudo, inclusive o que não tem cômodo definido", async () => {
    expect(await allowedRooms([QUARTO, SALA, null], dono)).toEqual(new Set([QUARTO, SALA, null]));
    expect(fake.consultas).toHaveLength(0);
  });

  it("quem pede desconhecido não restringe (mesmo comportamento de antes)", async () => {
    expect(await allowedRooms([QUARTO, null], null)).toEqual(new Set([QUARTO, null]));
  });

  it("morador perde só o cômodo negado, numa leitura de acesso só", async () => {
    fake.responder(personRoomAccess, [{ roomId: QUARTO, allowed: false }]);

    const vistos = await allowedRooms([QUARTO, SALA, QUARTO, null], quemPede());

    expect(vistos).toEqual(new Set([SALA, null]));
    // o ponto de existir uma função em lote: uma leitura, não uma por cômodo
    expect(fake.lidas(personRoomAccess)).toHaveLength(1);
  });

  it("visitante só vê o que foi liberado, e não o cômodo indefinido", async () => {
    fake.responder(personRoomAccess, [{ roomId: SALA, allowed: true }]);

    expect(await allowedRooms([QUARTO, SALA, null], visitante)).toEqual(new Set([SALA]));
  });

  it("lista vazia não vira leitura de acesso desnecessária", async () => {
    expect(await allowedRooms([], quemPede())).toEqual(new Set());
  });
});

describe("acionar dispositivo: quem pede precisa do cômodo dele", () => {
  it("entidade desconhecida NEGA para quem não é dono (não sei não é permissão)", async () => {
    const recusa = await authorizeEntityForRequester(DONO_CONTA, "light.que_nao_sincronizou", quemPede());

    expect(recusa).toBe("Quem pediu não tem permissão para acionar esse dispositivo.");
    expect(fake.lidas(haEntity)).toHaveLength(1);
  });

  it("entidade desconhecida não incomoda o dono (nem chega a consultar)", async () => {
    expect(await authorizeEntityForRequester(DONO_CONTA, "light.que_nao_sincronizou", dono)).toBeNull();
    expect(fake.consultas).toHaveLength(0);
  });

  it("entidade no cômodo permitido passa", async () => {
    fake.responder(haEntity, [{ roomId: SALA, nome: "Luz da sala" }]);
    fake.responder(personRoomAccess, [{ roomId: SALA, allowed: true }]);

    expect(await authorizeEntityForRequester(DONO_CONTA, "light.sala", visitante)).toBeNull();
  });

  it("entidade no cômodo negado recusa nomeando o dispositivo, não quem pediu", async () => {
    fake.responder(haEntity, [{ roomId: QUARTO, nome: "Luz do quarto" }]);
    fake.responder(personRoomAccess, [{ roomId: QUARTO, allowed: false }]);

    const recusa = await authorizeEntityForRequester(DONO_CONTA, "light.quarto", quemPede());
    expect(recusa).toBe("Quem pediu não tem permissão para acionar Luz do quarto neste cômodo.");
    expect(recusa).not.toContain("Anna");
  });

  it("entidade ainda sem cômodo: morador aciona, visitante não", async () => {
    fake.responder(haEntity, [{ roomId: null, nome: "Luz nova" }]);
    expect(await authorizeEntityForRequester(DONO_CONTA, "light.nova", quemPede())).toBeNull();

    fake.reset();
    fake.responder(haEntity, [{ roomId: null, nome: "Luz nova" }]);
    expect(await authorizeEntityForRequester(DONO_CONTA, "light.nova", visitante)).toMatch(/não tem permissão/);
  });
});
