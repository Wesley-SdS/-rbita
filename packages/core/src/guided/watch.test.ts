import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O laço que olha a câmera e avança o passo. O que importa aqui é o que ele
 * NÃO faz: não avança na dúvida, não avança sem imagem, não manda snapshot
 * para a nuvem numa câmera que identifica pessoas, e não deixa a tarefa presa
 * quando o modelo falha.
 */

let cam: { id: string; enabled: boolean; identifyFaces: boolean } | null = null;
let evento: { id: string; snapshot: string | null } | null = null;
let resposta = "SIM, terminou.";
const narracoes: { pergunta: string; localOnly: boolean | undefined }[] = [];
const atualizados: Record<string, unknown>[] = [];
const avisos: { titulo: string; corpo: string; personId: string | null }[] = [];
const encerradas: string[] = [];
const emitidos: string[] = [];

vi.mock("@orbita/db", () => {
  const cadeia = (): Record<string, unknown> => {
    const p: Record<string, unknown> = {};
    for (const k of ["select", "from", "where", "limit", "update", "set", "orderBy", "returning"]) {
      p[k] = (...args: unknown[]) => {
        if (k === "set") atualizados.push(args[0] as Record<string, unknown>);
        return k === "limit" ? (cam ? [cam] : []) : p;
      };
    }
    p.then = (ok: (v: unknown) => void) => ok([]);
    return p;
  };
  return { db: cadeia() };
});
vi.mock("../cameras/query", () => ({ latestEventWithSnapshot: async () => evento }));
vi.mock("../cameras/narrate", () => ({
  narrateSnapshot: async (_s: string, pergunta: string, opts?: { localOnly?: boolean }) => {
    narracoes.push({ pergunta, localOnly: opts?.localOnly });
    return resposta;
  },
}));
vi.mock("../settings", () => ({
  settings: { getMany: async () => ({ "guided.question": "Terminou {passo}? ({tarefa})" }) },
}));
vi.mock("../events/index", () => ({ events: { emit: async (t: string) => void emitidos.push(t) } }));
vi.mock("../routines/run", () => ({
  notifyUser: async (_u: string, titulo: string, corpo: string, _r: unknown, opts: { personId?: string | null }) => {
    avisos.push({ titulo, corpo, personId: opts?.personId ?? null });
  },
}));
vi.mock("./task", () => ({
  activeGuidedTasks: async () => [],
  expireGuidedTasks: async () => 0,
  stopGuidedTask: async (_u: string, id: string) => void encerradas.push(id),
}));

import { olharTarefa } from "./watch";

const tarefa = {
  id: "t1",
  userId: "dono",
  personId: "p-wesley",
  title: "bolo",
  steps: ["bater a massa", "untar a forma", "levar ao forno"],
  currentStep: 0,
  cameraId: "cam1",
  roomId: "cozinha",
  status: "ativa",
  intervalSeconds: 45,
  lastLookAt: null,
  lastObservation: null,
  expiresAt: new Date(Date.now() + 3_600_000),
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  cam = { id: "cam1", enabled: true, identifyFaces: false };
  evento = { id: "e1", snapshot: "data:image/jpeg;base64,AAA" };
  resposta = "SIM, terminou.";
  narracoes.length = 0;
  atualizados.length = 0;
  avisos.length = 0;
  encerradas.length = 0;
  emitidos.length = 0;
});

describe("uma olhada na tarefa", () => {
  it("terminou: avança o passo e avisa quem está fazendo", async () => {
    expect(await olharTarefa(tarefa)).toBe("terminou");
    expect(atualizados.some((u) => u.currentStep === 1)).toBe(true);
    expect(avisos[0]).toMatchObject({ titulo: "bolo", personId: "p-wesley" });
    expect(avisos[0]!.corpo).toContain("untar a forma");
  });

  it("no último passo, conclui e encerra a tarefa", async () => {
    expect(await olharTarefa({ ...tarefa, currentStep: 2 })).toBe("terminou");
    expect(encerradas).toEqual(["t1"]);
    expect(avisos[0]!.corpo).toMatch(/conclu/i);
  });

  it("na dúvida não avança nem avisa, só guarda o que viu", async () => {
    resposta = "Não dá para saber, a imagem está escura.";
    expect(await olharTarefa(tarefa)).toBe("nao_da_para_saber");
    expect(atualizados.some((u) => u.currentStep !== undefined)).toBe(false);
    expect(avisos).toEqual([]);
    expect(atualizados.some((u) => typeof u.lastObservation === "string")).toBe(true);
  });

  it("ainda não terminou: espera a próxima olhada", async () => {
    resposta = "NÃO, ainda está batendo a massa.";
    expect(await olharTarefa(tarefa)).toBe("ainda_nao");
    expect(avisos).toEqual([]);
  });

  it("sem imagem recente não chama o modelo", async () => {
    evento = null;
    expect(await olharTarefa(tarefa)).toBe("sem_imagem");
    expect(narracoes).toEqual([]);
  });

  it("câmera desligada ou apagada não é olhada", async () => {
    cam = { id: "cam1", enabled: false, identifyFaces: false };
    expect(await olharTarefa(tarefa)).toBe("sem_camera");
    expect(narracoes).toEqual([]);
  });

  it("câmera que identifica pessoas só usa modelo local (decisão 9.6)", async () => {
    cam = { id: "cam1", enabled: true, identifyFaces: true };
    await olharTarefa(tarefa);
    expect(narracoes[0]!.localOnly).toBe(true);
  });

  it("a pergunta leva o passo atual e o nome da tarefa", async () => {
    await olharTarefa({ ...tarefa, currentStep: 1 });
    expect(narracoes[0]!.pergunta).toBe("Terminou untar a forma? (bolo)");
  });
});
