import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * As duas tools de câmera da Onda 5, depois que a Fase 2 lhes deu as mesmas
 * defesas das irmãs de identidade (CLAUDE.md §5.7: tool sem teste de `execute`
 * não está pronta). `casa_ver_camera` é a que o modelo escolhe quando quer
 * "olhar a sala", então o que vale para `ver_camera` precisa valer aqui:
 *   - permissão por cômodo recusa ANTES de chamar o modelo de visão
 *   - câmera que identifica pessoas narra só com modelo local (decisão 9.6)
 * A execução passa pelo `toToolSet`, não pelo `run` direto, porque é o registro
 * que chama o `authorize`: testar só o `run` provaria menos que o caminho real.
 */

interface CamFalsa {
  id: string;
  name: string;
  roomId: string | null;
  enabled: boolean;
  identifyFaces: boolean;
}
let camera: CamFalsa | null = null;
let cameras: CamFalsa[] = [];
let recusaComodo: string | null = null;
let evento: { id: string; snapshot: string | null; createdAt: Date } | null = null;

const narradas: { pergunta: string | undefined; opts: { localOnly?: boolean } | undefined }[] = [];
const autorizacoes: { roomId: string | null; quem: unknown; oQue: string }[] = [];

vi.mock("../../cameras/query", () => ({
  findCamera: async () => camera,
  latestEventWithSnapshot: async () => evento,
  listCameras: async () => cameras,
}));
vi.mock("../../cameras/narrate", () => ({
  narrateSnapshot: async (_snapshot: string, pergunta?: string, opts?: { localOnly?: boolean }) => {
    narradas.push({ pergunta, opts });
    return "uma pessoa na cozinha";
  },
}));
vi.mock("../../home/room-permission", () => ({
  authorizeRoomForRequester: async (roomId: string | null, quem: unknown, oQue: string) => {
    autorizacoes.push({ roomId, quem, oQue });
    return recusaComodo;
  },
}));

import { toToolSet, type Requester, type ToolContext } from "../registry";
import { casa_listar_cameras, casa_ver_camera } from "./camera";

const exec = { toolCallId: "t", messages: [] };
const anna: Requester = { personId: "p-anna", name: "Anna", role: "morador", via: "voz", confidence: 0.9 };
const ctx: ToolContext = { userId: "dono", requester: async () => anna };

const set = () => toToolSet([casa_listar_cameras, casa_ver_camera], ctx, { enqueue: vi.fn() });

beforeEach(() => {
  narradas.length = 0;
  autorizacoes.length = 0;
  recusaComodo = null;
  camera = { id: "cam1", name: "Cozinha", roomId: "cozinha", enabled: true, identifyFaces: true };
  cameras = [camera];
  evento = { id: "e1", snapshot: "data:image/jpeg;base64,AAA", createdAt: new Date("2026-09-17T14:12:00Z") };
});

describe("casa_ver_camera: permissão por cômodo", () => {
  it("quem não pode ver o cômodo é recusado e o modelo de visão nem é chamado", async () => {
    recusaComodo = "Quem pediu não tem permissão para ver a câmera neste cômodo.";
    expect(await set().casa_ver_camera!.execute!({ local: "cozinha" }, exec)).toEqual({ permitido: false, erro: recusaComodo });
    expect(narradas).toEqual([]);
    // a recusa é sobre o cômodo da câmera encontrada, com quem pediu resolvido
    expect(autorizacoes).toEqual([{ roomId: "cozinha", quem: anna, oQue: "ver a câmera" }]);
  });

  it("com permissão, descreve a cena da câmera", async () => {
    const r = (await set().casa_ver_camera!.execute!({ local: "cozinha" }, exec)) as Record<string, unknown>;
    expect(r).toMatchObject({ camera: "Cozinha", descricao: "uma pessoa na cozinha" });
    expect(autorizacoes).toHaveLength(1);
  });

  it("câmera inexistente não vira recusa de permissão: a própria tool responde", async () => {
    camera = null;
    expect(await casa_ver_camera.authorize!({ local: "sótão" }, ctx)).toBeNull();
    const r = (await set().casa_ver_camera!.execute!({ local: "sótão" }, exec)) as { erro: string };
    expect(r.erro).toMatch(/Não achei/);
    expect(narradas).toEqual([]);
    // sem câmera não há cômodo para perguntar: nem chega ao permissionamento
    expect(autorizacoes).toEqual([]);
  });
});

describe("casa_ver_camera: nuvem barrada em câmera que identifica (decisão 9.6)", () => {
  it("câmera com identificação pede narração só local", async () => {
    await set().casa_ver_camera!.execute!({ local: "cozinha" }, exec);
    expect(narradas[0]!.opts).toEqual({ localOnly: true });
  });

  it("câmera sem identificação segue a configuração de visão de sempre", async () => {
    camera = { id: "cam2", name: "Garagem", roomId: "garagem", enabled: true, identifyFaces: false };
    await set().casa_ver_camera!.execute!({ local: "garagem" }, exec);
    expect(narradas[0]!.opts).toEqual({ localOnly: false });
  });

  it("câmera sem imagem recente não chama o modelo", async () => {
    evento = null;
    const r = (await set().casa_ver_camera!.execute!({ local: "cozinha" }, exec)) as { erro: string };
    expect(r.erro).toMatch(/nenhuma imagem recente/i);
    expect(narradas).toEqual([]);
  });
});

describe("casa_listar_cameras", () => {
  it("sem câmera nenhuma, avisa em vez de devolver lista vazia sem contexto", async () => {
    cameras = [];
    expect(await set().casa_listar_cameras!.execute!({}, exec)).toEqual({ cameras: [], aviso: "Nenhuma câmera cadastrada ainda." });
  });

  it("lista nome e se está ligada, sem devolver id interno ao modelo", async () => {
    cameras = [{ id: "cam1", name: "Cozinha", roomId: "cozinha", enabled: false, identifyFaces: true }];
    const r = (await set().casa_listar_cameras!.execute!({}, exec)) as { cameras: Record<string, unknown>[] };
    expect(r.cameras).toEqual([{ nome: "Cozinha", ligada: false }]);
    expect(JSON.stringify(r)).not.toMatch(/cam1/);
  });
});
