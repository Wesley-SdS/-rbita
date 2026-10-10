import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A visão do painel: lê a gestão e os chamados pelos servidores MCP, guarda
 * por pouco tempo, e uma parte fora do ar não apaga a outra.
 */

let ligados = [{ name: "tickets" }, { name: "adalink-gestao" }];
const leituras: string[] = [];
let gestaoFalha: Error | null = null;
const respostas: Record<string, unknown> = {};
/** o banco já tem chave daquele tipo (não é a primeira volta)? */
let jaVisto = false;
let comentarAoReceber = true;
const comentarios: { tool: string; args: Record<string, unknown> }[] = [];
let comentarioFalha: Error | null = null;
const notifyUser = vi.fn(async (..._a: unknown[]) => undefined);

vi.mock("@orbita/db", () => {
  const cadeia = (): Record<string, unknown> => {
    const p: Record<string, unknown> = {};
    for (const k of ["select", "from", "where", "insert", "values", "update", "set", "delete", "onConflictDoNothing", "returning"]) p[k] = () => p;
    p.limit = async () => (jaVisto ? [{ chave: "x" }] : []);
    p.then = (ok: (v: unknown) => void) => ok(ligados);
    return p;
  };
  return { db: cadeia() };
});
vi.mock("../settings", () => ({
  settings: {
    get: async (k: string) => ({ "comigo.cacheSegundos": 60, "comigo.meuNome": "Wesley", "connectors.fusoHorario": "America/Sao_Paulo", "comigo.avisar": true, "comigo.diasGuardar": 30 })[k],
    getMany: async (ks: string[]) => {
      const v: Record<string, unknown> = {
        "comigo.servidorGestao": "adalink-gestao", "comigo.servidorTickets": "tickets", "connectors.fusoHorario": "America/Sao_Paulo",
        "comigo.pertoPercentual": 25, "comigo.pertoHoras": 24, "comigo.avisarChamadoNovo": true, "comigo.chamadoNovoHoras": 24,
        "comigo.comentarAoReceber": comentarAoReceber, "comigo.comentarioTexto": "{saudacao} Recebi o chamado {codigo} e já estou analisando.", "comigo.comentarioInterno": false,
      };
      return Object.fromEntries(ks.map((k) => [k, v[k]]));
    },
  },
}));
vi.mock("../routines/run", () => ({ notifyUser }));
vi.mock("../mcp/client", () => ({
  lerFerramentaMcp: async (_u: string, servidor: string, tool: string, args: { status?: string }) => {
    leituras.push(`${servidor}:${tool}${args?.status ? `:${args.status}` : ""}`);
    if (servidor === "adalink-gestao" && gestaoFalha) throw gestaoFalha;
    return respostas[`${tool}${args?.status ? `:${args.status}` : ""}`] ?? { tickets: [], totalPages: 1 };
  },
  chamarFerramentaMcpPorAutomacao: async (_u: string, _s: string, tool: string, args: Record<string, unknown>) => {
    if (comentarioFalha) throw comentarioFalha;
    comentarios.push({ tool, args });
  },
}));

const { comigoDe, vigiarComigo } = await import("./servico");

beforeEach(() => {
  leituras.length = 0;
  gestaoFalha = null;
  jaVisto = false;
  comentarAoReceber = true;
  comentarios.length = 0;
  comentarioFalha = null;
  notifyUser.mockClear();
  ligados = [{ name: "tickets" }, { name: "adalink-gestao" }];
  respostas.get_my_day = { doing: [{ id: "a1", name: "Ajustar créditos", projectName: "Painel", endDate: "2020-01-01", overdue: true }] };
  respostas["tickets_list:open"] = { totalPages: 1, tickets: [{ id: "t1", code: "TCK-1", title: "Erro", status: "open", assignee: { name: "Wesley" }, sla: { deadline: "2020-01-01T00:00:00Z", paused: false } }] };
  respostas["tickets_list:in_progress"] = { totalPages: 1, tickets: [{ id: "t2", code: "TCK-2", title: "Lento", status: "in_progress", assignee: { name: "Fernando" }, sla: { deadline: "2020-01-01T00:00:00Z", paused: false } }] };
});

describe("o que está com o dono", () => {
  it("lê a gestão e os chamados (aberto, em andamento e aguardando) e separa os atrasos", async () => {
    const c = await comigoDe("u-ler", { fresco: true });
    expect(c.partes).toEqual({ gestao: true, tickets: true });
    expect(leituras.sort()).toEqual(["adalink-gestao:get_my_day", "tickets:tickets_list:in_progress", "tickets:tickets_list:open", "tickets:tickets_list:waiting"]);
    expect(c.atividades).toEqual([expect.objectContaining({ titulo: "Ajustar créditos", atrasada: true })]);
    expect(c.chamados.comigo.map((x) => x.codigo)).toEqual(["TCK-1"]);
    expect(c.chamados.semTratativa.map((x) => x.codigo)).toEqual(["TCK-1"]);
    expect(c.chamados.comDevAtrasados.map((x) => x.codigo)).toEqual(["TCK-2"]);
  });

  it("a tela reaproveita a leitura; o laço pede a de agora", async () => {
    await comigoDe("u-cache");
    const antes = leituras.length;
    await comigoDe("u-cache");
    expect(leituras.length).toBe(antes);
    await comigoDe("u-cache", { fresco: true });
    expect(leituras.length).toBeGreaterThan(antes);
  });

  it("a gestão fora do ar não apaga os chamados, diz o motivo e não fica guardada", async () => {
    gestaoFalha = new Error("get_my_day está marcada para pedir aprovação em Extensões");
    const c = await comigoDe("u-falha");
    expect(c.atividades).toEqual([]);
    expect(c.chamados.comigo).toHaveLength(1);
    expect(c.falhas[0]).toContain("pedir aprovação");
    const antes = leituras.length;
    await comigoDe("u-falha");
    expect(leituras.length).toBeGreaterThan(antes);
  });

  it("servidor desligado em Extensões: a parte nem é lida", async () => {
    ligados = [{ name: "tickets" }];
    const c = await comigoDe("u-so-tickets", { fresco: true });
    expect(c.partes).toEqual({ gestao: false, tickets: true });
    expect(leituras.some((l) => l.startsWith("adalink-gestao"))).toBe(false);
  });
});

describe("o comentário de recebi", () => {
  // TCK-1 está com o Wesley e foi aberto pela Ana: é o que "acabou de chegar"
  const comAna = () => {
    respostas["tickets_list:open"] = { totalPages: 1, tickets: [{ id: "t1", code: "TCK-1", title: "Erro", status: "open", assignee: { name: "Wesley" }, createdBy: { name: "Ana Lima" }, sla: { deadline: "2099-01-01T00:00:00Z", paused: false } }] };
  };

  it("chamado que acabou de chegar para o dono ganha o comentário dele, uma vez, pelo id", async () => {
    comAna();
    jaVisto = true;
    await vigiarComigo("u-coment");
    expect(comentarios).toEqual([{ tool: "tickets_comment", args: { ticket: "t1", body: "Olá, Ana! Recebi o chamado TCK-1 e já estou analisando.", internal: false } }]);
  });

  it("primeira volta só guarda: o que já estava com o dono não é comentado", async () => {
    comAna();
    jaVisto = false;
    await vigiarComigo("u-primeira");
    expect(comentarios).toEqual([]);
  });

  it("desligado em Ajustes, não comenta", async () => {
    comAna();
    jaVisto = true;
    comentarAoReceber = false;
    await vigiarComigo("u-desligado");
    expect(comentarios).toEqual([]);
  });

  it("a central recusou: o dono é avisado, em vez de achar que saiu", async () => {
    comAna();
    jaVisto = true;
    comentarioFalha = new Error("403");
    await vigiarComigo("u-falha");
    expect(notifyUser).toHaveBeenCalledWith("u-falha", "Não consegui comentar no chamado", expect.stringContaining("TCK-1"), null, { destino: "/app" });
  });
});
