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
/** o que `vision.identificacaoSoLocal` responderia */
let exigirLocal = false;
let cameras: CamFalsa[] = [];
let recusaComodo: string | null = null;
let evento: { id: string; label: string; snapshot: string | null; createdAt: Date } | null = null;

const narradas: { pergunta: string | undefined; opts: { localOnly?: boolean } | undefined }[] = [];
const autorizacoes: { roomId: string | null; quem: unknown; oQue: string }[] = [];

vi.mock("../../cameras/query", () => ({
  findCamera: async () => camera,
  latestEventWithSnapshot: async () => evento,
  listCameras: async () => cameras,
}));
vi.mock("../../cameras/narrate", () => ({
  // a tool devolve este aviso quando a câmera identifica pessoas: é o que
  // explica ao dono por que a leitura leva um minuto (decisão 9.6)
  AVISO_SO_LOCAL: "só local",
  // a regra deixou de ser automática e virou config do dono (27/09/2026):
  // a tool pergunta, e a resposta é o que o teste controla
  soLocalParaCamera: async (identifica: boolean) => identifica && exigirLocal,
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
  exigirLocal = false; // o padrão novo: segue a preferência de visão
  narradas.length = 0;
  autorizacoes.length = 0;
  recusaComodo = null;
  camera = { id: "cam1", name: "Cozinha", roomId: "cozinha", enabled: true, identifyFaces: true };
  cameras = [camera];
  // `label` e data de AGORA: a janela de frescor deixou de ser checada dentro
  // do mock e passou a ser a regra de `imagemFresca`, então o evento do teste
  // precisa ser um evento plausível de verdade
  evento = { id: "e1", label: "person", snapshot: "data:image/jpeg;base64,AAA", createdAt: new Date() };
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

describe("câmera que identifica pessoas: quem narra é ESCOLHA do dono", () => {
  /**
   * A decisão 9.6 mandava narrar só com modelo local, sem exceção. O dono a
   * reviu em 27/09/2026, com dois fatos:
   *
   *   1. MEDIDO: o `moondream` levou 43 s numa imagem real da webcam e
   *      devolveu "!!!". A regra não protegia nada, só inutilizava a câmera.
   *   2. Na nuvem (Render) NÃO existe modelo local, então "só local" ali
   *      significa "sem visão nenhuma".
   *
   * O vetor de rosto continua saindo só para o serviço local de percepção
   * (§5.4.1): o que passou a poder ir para a nuvem é a DESCRIÇÃO DA CENA.
   */
  it("por padrão, segue a preferência de visão (nuvem/assinatura)", async () => {
    exigirLocal = false;
    await set().casa_ver_camera!.execute!({ local: "cozinha" }, exec);
    expect(narradas[0]!.opts).toMatchObject({ localOnly: false });
  });

  it("com `vision.identificacaoSoLocal` ligado, volta a ser só local", async () => {
    // o comportamento antigo continua disponível para quem o quiser
    exigirLocal = true;
    await set().casa_ver_camera!.execute!({ local: "cozinha" }, exec);
    expect(narradas[0]!.opts).toMatchObject({ localOnly: true });
  });

  it("câmera sem identificação segue a configuração de visão de sempre", async () => {
    camera = { id: "cam2", name: "Garagem", roomId: "garagem", enabled: true, identifyFaces: false };
    await set().casa_ver_camera!.execute!({ local: "garagem" }, exec);
    expect(narradas[0]!.opts).toMatchObject({ localOnly: false });
  });

  it("câmera sem imagem recente não chama o modelo: ela PEDE uma imagem", async () => {
    // A intenção do teste é a de sempre (não gastar uma chamada de visão sem
    // ter o que olhar). O que mudou é a saída: em vez de desistir com um erro,
    // a tool pede um quadro, e o chat transforma isso num botão. Descrever
    // uma imagem de horas atrás como se fosse agora seria pior que não ver.
    evento = null;
    const r = (await set().casa_ver_camera!.execute!({ local: "cozinha" }, exec)) as { precisa_de_imagem?: boolean; motivo?: string; erro?: string };
    expect(r.precisa_de_imagem).toBe(true);
    expect(r.motivo).toMatch(/imagem recente/i);
    expect(r.erro).toBeUndefined();
    expect(narradas).toEqual([]);
  });
});

describe("a mesma foto duas vezes: de quem é o quadro", () => {
  /**
   * Medido no banco em 27/09/2026: o dono pediu cinco vezes, em 92 segundos, no
   * modo de voz, e recebeu a MESMA imagem cinco vezes (UM `camera_event` e cinco
   * chamadas de visão depois dele). A janela de frescor era uma só, de 120 s,
   * para dois tipos de imagem muito diferentes.
   */
  it("quadro que a própria Órbita pediu, meio minuto atrás, já não serve", async () => {
    evento = { id: "e2", label: "sob demanda", snapshot: "data:image/jpeg;base64,AAA", createdAt: new Date(Date.now() - 30_000) };
    const r = (await set().casa_ver_camera!.execute!({ local: "cozinha" }, exec)) as { precisa_de_imagem?: boolean };
    expect(r.precisa_de_imagem).toBe(true);
    // e o mais importante: NÃO gastou uma chamada de visão na foto velha
    expect(narradas).toEqual([]);
  });

  it("evento empurrado por detector, meio minuto atrás, continua servindo", async () => {
    // encurtar a janela do Frigate seria "não consigo ver" numa câmera que o
    // navegador nem tem como fotografar
    evento = { id: "e3", label: "person", snapshot: "data:image/jpeg;base64,AAA", createdAt: new Date(Date.now() - 30_000) };
    const r = (await set().casa_ver_camera!.execute!({ local: "cozinha" }, exec)) as Record<string, unknown>;
    expect(r).toMatchObject({ descricao: "uma pessoa na cozinha" });
    expect(narradas).toHaveLength(1);
  });

  it("quadro pedido de segundos atrás ainda vale, para duas tools do mesmo turno", async () => {
    // sem esta folga, o modelo chamando `casa_ver_camera` e depois `ver_camera`
    // no MESMO turno acenderia a webcam duas vezes
    evento = { id: "e4", label: "sob demanda", snapshot: "data:image/jpeg;base64,AAA", createdAt: new Date(Date.now() - 3_000) };
    const r = (await set().casa_ver_camera!.execute!({ local: "cozinha" }, exec)) as Record<string, unknown>;
    expect(r).toMatchObject({ descricao: "uma pessoa na cozinha" });
  });
});

describe("casa_listar_cameras", () => {
  it("sem câmera nenhuma, aponta o caminho em vez de virar beco sem saída", async () => {
    // O modelo listava, via vazio e desistia ali ("não encontrei nenhuma
    // câmera cadastrada"), sem saber que o aparelho de quem fala pode virar
    // uma. A lista vazia agora carrega o próximo passo.
    cameras = [];
    const r = (await set().casa_listar_cameras!.execute!({}, exec)) as { cameras: unknown[]; aviso: string; proximo_passo: string };
    expect(r.cameras).toEqual([]);
    expect(r.aviso).toMatch(/aparelho/i);
    expect(r.proximo_passo).toMatch(/casa_ver_camera/);
  });

  it("lista nome e se está ligada, sem devolver id interno ao modelo", async () => {
    cameras = [{ id: "cam1", name: "Cozinha", roomId: "cozinha", enabled: false, identifyFaces: true }];
    const r = (await set().casa_listar_cameras!.execute!({}, exec)) as { cameras: Record<string, unknown>[] };
    expect(r.cameras).toEqual([{ nome: "Cozinha", ligada: false }]);
    expect(JSON.stringify(r)).not.toMatch(/cam1/);
  });
});
