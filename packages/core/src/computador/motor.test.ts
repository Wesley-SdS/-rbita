import { describe, expect, it } from "vitest";
import type { BlocoClaude, PedidoClaudeDireto, RespostaClaudeDireto } from "@orbita/llm";
import { classificarErro, entradaDoPasso, NAO_EXECUTADO, rodarTarefa, type CfgDoComputador, type DependenciasDoComputador, type EstadoDaSessao } from "./motor";
import { PEDIDO_DE_RESUMO, usosSemResultado } from "./contexto";
import { ferramentasDoComputador } from "./membros";

/**
 * O LAÇO DELEGADO NO WINDOWS com o Claude e as mãos falsos (PRD-MOTOR-DESKTOP
 * §10.2): cada membro do computer toolset vira a tool certa do registro, a
 * proposta espera o dono, a sessão parada corta, os tetos pausam sem ampliar, e
 * a falha de um lote cancela o resto com a frase oficial.
 */

const CFG: CfgDoComputador = {
  modelo: "claude/claude-sonnet-5-5",
  modeloEscalada: "claude/claude-opus-5-5",
  escalarParaOpus: false,
  usarClaude: true,
  passosMax: 10,
  capturas: 3,
  contextoMaxTokens: 150_000,
  tokensMax: 600_000,
  esperaAprovacaoMs: 1000,
  pausaEntrePassosMs: 0,
  pausaMaxMs: 30_000,
  esperaAbrirMs: 2000,
  travadoMs: 20_000,
  apps: ["Bloco de Notas"],
};

type Uso = { name: string; input: Record<string, unknown> };
type Rodada = { usos: Uso[] } | { texto: string; stop?: string };

/** Um "Claude" de roteiro fixo: cada chamada devolve a rodada seguinte; depois, o texto final. */
function claudeDeRoteiro(rodadas: Rodada[], final = "Pronto: anotei no Bloco de Notas.", usage = { input_tokens: 5800, output_tokens: 200 }) {
  const pedidos: PedidoClaudeDireto[] = [];
  let i = 0;
  const fn = async (p: PedidoClaudeDireto): Promise<RespostaClaudeDireto> => {
    pedidos.push(structuredClone({ ...p, signal: undefined }));
    const r = rodadas[i++];
    if (!r) return { content: [{ type: "text", text: final }], stop_reason: "end_turn", usage };
    if ("texto" in r) return { content: [{ type: "text", text: r.texto }], stop_reason: r.stop ?? "end_turn", usage };
    const content: BlocoClaude[] = r.usos.map((u, j) => ({ type: "tool_use", id: `toolu_${i}_${j}`, name: u.name, input: u.input, toolset_name: "computer" }));
    return { content, stop_reason: "tool_use", usage };
  };
  return { fn, pedidos };
}

const IMG = { base64: "iVBOR", mediaType: "image/jpeg", alternativa: { tipo: "narracao", texto: "x" } };
const TELA = { captura: { id: "c1", largura: 1280, altura: 720 }, imagem_para_modelo: IMG };

function montar(over: Partial<DependenciasDoComputador> = {}, agirComo?: (entrada: Record<string, unknown>, n: number) => unknown) {
  const chamadas: { nome: string; entrada: Record<string, unknown> }[] = [];
  const avisos: string[] = [];
  const sonos: number[] = [];
  const pausas: string[] = [];
  const usos: string[] = [];
  let sessao: EstadoDaSessao = "ativa";
  let agiu = 0;
  const d: DependenciasDoComputador = {
    chamarClaude: async () => ({ content: [{ type: "text", text: "nada" }], stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 } }),
    tool: async (nome, entrada) => {
      chamadas.push({ nome, entrada });
      if (nome === "computador_ver") return TELA;
      if (nome === "computador_agir") return agirComo ? agirComo(entrada, ++agiu) : { mensagem: `Feito: ${String(entrada.acao)}.`, feitos: 1 };
      return { mensagem: "ok" };
    },
    esperarAprovacao: async () => ({ status: "executada", resultado: "Cliquei em Enviar." }),
    estadoDaSessao: async () => sessao,
    cancelado: async () => false,
    avisar: async (t, x) => void avisos.push(`${t}: ${x}`),
    dormir: async (ms) => void sonos.push(ms),
    progresso: async () => undefined,
    pausarSessao: async (m) => void pausas.push(m),
    janelas: async () => [],
    motorDaOrbita: async () => "feito com as tools da Órbita",
    registrarUso: (_u, m) => void usos.push(m),
    ...over,
  };
  return { d, chamadas, avisos, sonos, pausas, usos, sessao: (s: EstadoDaSessao) => (sessao = s) };
}

const pedidoDoLote = (c: ReturnType<typeof claudeDeRoteiro>, k: number) => c.pedidos[k]!.mensagens.at(-1)!.content as BlocoClaude[];
const run = (d: DependenciasDoComputador, cfg: Partial<CfgDoComputador> = {}) => rodarTarefa({ objetivo: "anotar: comprar leite", pedido: "anota no Bloco de Notas comprar leite" }, d, { ...CFG, ...cfg });

describe("tarefa curta", () => {
  it("vê a tela, clica, digita e conclui com o resumo do Claude", async () => {
    const c = claudeDeRoteiro([{ usos: [{ name: "left_click", input: { coordinate: [640, 360] } }] }, { usos: [{ name: "type", input: { text: "comprar leite" } }] }]);
    const { d, chamadas, usos } = montar({ chamarClaude: c.fn });
    const r = await run(d);
    expect(r).toMatchObject({ estado: "concluida", motor: "claude", resumo: "Pronto: anotei no Bloco de Notas.", acoes: 2 });
    expect(chamadas.map((x) => x.nome)).toEqual(["computador_ver", "computador_agir", "computador_ver", "computador_agir", "computador_ver"]);
    // o ponto do Claude vira alvo na captura do último screenshot: quem converte para físico são as mãos
    expect(chamadas[1]!.entrada).toEqual({ acao: "clicar", alvo: { captura: "c1", x: 640, y: 360 } });
    expect(chamadas[3]!.entrada).toEqual({ acao: "digitar", texto: "comprar leite" });
    // a primeira mensagem já leva a tela, e cada ação devolve a tela nova
    expect(JSON.stringify(c.pedidos[0]!.mensagens[0])).toContain("iVBOR");
    expect(pedidoDoLote(c, 1)[0]).toMatchObject({ type: "tool_result", toolset_name: "computer" });
    expect(JSON.stringify(pedidoDoLote(c, 1)[0])).toContain("iVBOR");
    expect(usos).toHaveLength(3);
  });

  it("o laço só vê o toolset do computador, com a cache no prefixo e o objetivo no system", async () => {
    const c = claudeDeRoteiro([]);
    const { d } = montar({ chamarClaude: c.fn });
    await run(d);
    expect(c.pedidos[0]!.tools).toEqual(ferramentasDoComputador());
    expect(c.pedidos[0]!.cachearPrefixo).toBe(true);
    expect(c.pedidos[0]!.system).toContain("<objetivo_do_dono>\nanotar: comprar leite\n</objetivo_do_dono>");
    expect(c.pedidos[0]!.modelo).toBe("claude/claude-sonnet-5-5");
  });

  it("toda tool chamada é do registro do computador (nunca terminal, arquivos, envio ou MCP)", async () => {
    const c = claudeDeRoteiro([
      { usos: [{ name: "left_click", input: { coordinate: [10, 10] } }, { name: "zoom", input: { region: [0, 0, 200, 200] } }, { name: "key", input: { text: "ctrl+s" } }, { name: "scroll", input: { scroll_direction: "down" } }, { name: "wait", input: { duration: 1 } }] },
      { usos: [{ name: "terminal_executar", input: { comando: "rm -rf /" } }, { name: "navegador_tarefa", input: {} }] },
    ]);
    const { d, chamadas } = montar({ chamarClaude: c.fn });
    await run(d);
    for (const x of chamadas) expect(["computador_ver", "computador_agir", "computador_abrir"]).toContain(x.nome);
    // o nome de tool que o toolset não tem vira erro ao modelo, não execução
    const ultimo = pedidoDoLote(c, 2);
    expect(ultimo[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/not a known/) });
    expect(ultimo[1]).toMatchObject({ is_error: true, content: NAO_EXECUTADO });
  });
});

describe("abrir aplicativo (o toolset do Claude não tem)", () => {
  it("abrir_aplicativo vira computador_abrir tipo app, espera o app aparecer e devolve a tela", async () => {
    const c = claudeDeRoteiro([{ usos: [{ name: "abrir_aplicativo", input: { app: "Calculadora" } }] }]);
    const m = montar({ chamarClaude: c.fn });
    const r = await run(m.d);
    expect(m.chamadas.filter((x) => x.nome === "computador_abrir")).toEqual([{ nome: "computador_abrir", entrada: { tipo: "app", alvo: "Calculadora" } }]);
    expect(m.sonos).toContain(2000);
    expect(JSON.stringify(pedidoDoLote(c, 1)[0])).toContain("iVBOR");
    expect(r.estado).toBe("concluida");
  });

  it("app fora do envelope vira proposta e, recusada, a tarefa para (nada abre sozinho)", async () => {
    const c = claudeDeRoteiro([{ usos: [{ name: "abrir_aplicativo", input: { app: "Excel" } }] }]);
    const m = montar({ chamarClaude: c.fn, esperarAprovacao: async () => ({ status: "recusada", resultado: "" }), tool: async (nome) => (nome === "computador_ver" ? TELA : { proposta_enfileirada: true, id: "a9", resumo: "Abrir o app Excel (app fora do envelope da sessão)" }) });
    const r = await run(m.d);
    expect(r.estado).toBe("pausada");
    expect(r.resumo).toMatch(/Excel/);
  });

  it("sem o nome do app é erro, e não chama nada", async () => {
    const c = claudeDeRoteiro([{ usos: [{ name: "abrir_aplicativo", input: {} }] }]);
    const m = montar({ chamarClaude: c.fn });
    await run(m.d);
    expect(pedidoDoLote(c, 1)[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/precisa de app/) });
    expect(m.chamadas.filter((x) => x.nome === "computador_abrir")).toHaveLength(0);
  });
});

describe("parar não espera as mãos", () => {
  it("uma captura que demora a responder é largada na hora do parar (o laço não fica refém dela)", async () => {
    const aborto = new AbortController();
    let n = 0;
    const m = montar({
      sinal: aborto.signal,
      chamarClaude: claudeDeRoteiro([{ usos: [{ name: "left_click", input: { coordinate: [10, 10] } }] }]).fn,
      // a 1ª tela é rápida; a captura depois da ação nunca volta
      tool: async (nome) => (++n <= 2 ? (nome === "computador_ver" ? TELA : { mensagem: "Feito." }) : new Promise(() => undefined)),
    });
    const t0 = Date.now();
    setTimeout(() => (m.sessao("parada"), aborto.abort()), 50);
    const r = await run(m.d);
    expect(r.estado).toBe("parada");
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});

describe("aprovação", () => {
  const proposta = (entrada: Record<string, unknown>, n: number) => (n === 1 ? { proposta_enfileirada: true, id: "acao1", resumo: "Clicar em botao Enviar (Enviar)" } : { mensagem: "Feito." });
  const roteiro: Rodada[] = [{ usos: [{ name: "left_click", input: { coordinate: [900, 600] } }] }];

  it("efeito_externo pausa o laço, avisa o dono e, aprovado, segue com a tela nova", async () => {
    const c = claudeDeRoteiro(roteiro);
    const esperas: string[] = [];
    const { d, avisos, chamadas } = montar({ chamarClaude: c.fn, esperarAprovacao: async (id) => (esperas.push(id), { status: "executada", resultado: "Cliquei em Enviar." }) }, proposta);
    const r = await run(d);
    expect(esperas).toEqual(["acao1"]);
    expect(avisos[0]).toMatch(/espera você.*Enviar/);
    expect(r).toMatchObject({ estado: "concluida", acoes: 1 });
    const texto = JSON.stringify(pedidoDoLote(c, 1)[0]);
    expect(texto).toContain("O dono aprovou");
    expect(texto).toContain("A tela pode ter mudado");
    // depois da espera tirou a tela de novo
    expect(chamadas.at(-1)!.nome).toBe("computador_ver");
  });

  it("recusada ou vencida encerra a tarefa sem insistir", async () => {
    for (const status of ["recusada", "vencida"] as const) {
      const c = claudeDeRoteiro(roteiro);
      const { d, chamadas } = montar({ chamarClaude: c.fn, esperarAprovacao: async () => ({ status, resultado: "" }) }, proposta);
      const r = await run(d);
      expect(r.estado).toBe("pausada");
      expect(r.resumo).toMatch(status === "recusada" ? /dono não aprovou/ : /não veio a tempo/);
      expect(r.acoes).toBe(0);
      expect(chamadas.filter((x) => x.nome === "computador_agir")).toHaveLength(1);
      expect(c.pedidos).toHaveLength(1);
    }
  });
});

describe("falhas e lote", () => {
  it("a primeira falha cancela as seguintes com a frase oficial", async () => {
    const c = claudeDeRoteiro([{ usos: [{ name: "left_click", input: { coordinate: [10, 10] } }, { name: "type", input: { text: "a" } }, { name: "key", input: { text: "Tab" } }] }]);
    const { d, chamadas } = montar({ chamarClaude: c.fn }, () => ({ permitido: false, erro: "O alvo mudou: a assinatura não bate." }));
    await run(d);
    const r = pedidoDoLote(c, 1);
    expect(r[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/assinatura/) });
    expect(r[1]).toMatchObject({ is_error: true, content: NAO_EXECUTADO });
    expect(r[2]).toMatchObject({ is_error: true, content: NAO_EXECUTADO });
    expect(chamadas.filter((x) => x.nome === "computador_agir")).toHaveLength(1);
    expect(usosSemResultado(c.pedidos[1]!.mensagens)).toEqual([]);
  });

  it("membro desligado devolve erro e não executa nada", async () => {
    const c = claudeDeRoteiro([{ usos: [{ name: "mouse_move", input: { coordinate: [1, 1] } }, { name: "hold_key", input: { text: "ctrl" } }] }]);
    const { d, chamadas } = montar({ chamarClaude: c.fn });
    await run(d);
    expect(pedidoDoLote(c, 1)[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/not enabled/) });
    expect(chamadas.filter((x) => x.nome !== "computador_ver")).toHaveLength(0);
  });

  it("coordenada fora da imagem é recusada antes de chegar às mãos", async () => {
    const c = claudeDeRoteiro([{ usos: [{ name: "left_click", input: { coordinate: [5000, 5000] } }] }]);
    const { d, chamadas } = montar({ chamarClaude: c.fn });
    await run(d);
    expect(pedidoDoLote(c, 1)[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/fora do screenshot/) });
    expect(chamadas.filter((x) => x.nome === "computador_agir")).toHaveLength(0);
  });

  it("app fora do envelope: o erro volta ao Claude uma vez; na segunda, a tarefa para", async () => {
    const c = claudeDeRoteiro([{ usos: [{ name: "left_click", input: { coordinate: [10, 10] } }] }, { usos: [{ name: "left_click", input: { coordinate: [20, 20] } }] }, { usos: [{ name: "left_click", input: { coordinate: [30, 30] } }] }]);
    const { d, chamadas } = montar({ chamarClaude: c.fn }, () => ({ permitido: false, erro: 'O app "Calculadora" não está no envelope aprovado (Bloco de Notas). Para usá-lo, proponha um envelope novo.' }));
    const r = await run(d);
    expect(r.estado).toBe("falhou");
    expect(r.resumo).toMatch(/mesma falha se repetiu/);
    expect(chamadas.filter((x) => x.nome === "computador_agir")).toHaveLength(2);
    expect(c.pedidos).toHaveLength(2);
  });

  it("o erro entre dois acertos não conta como repetição", async () => {
    let n = 0;
    const c = claudeDeRoteiro([{ usos: [{ name: "left_click", input: { coordinate: [10, 10] } }] }, { usos: [{ name: "left_click", input: { coordinate: [10, 10] } }] }, { usos: [{ name: "left_click", input: { coordinate: [10, 10] } }] }]);
    const { d } = montar({ chamarClaude: c.fn }, () => (++n === 2 ? { permitido: false, erro: "a tela mudou" } : { mensagem: "Feito." }));
    expect((await run(d)).estado).toBe("concluida");
  });

  it("UAC ou janela elevada para a tarefa e pede ao dono", async () => {
    const c = claudeDeRoteiro([{ usos: [{ name: "left_click", input: { coordinate: [10, 10] } }] }]);
    const { d } = montar({ chamarClaude: c.fn }, () => ({ permitido: false, erro: "Essa janela roda como administrador: a Órbita nunca age em janela elevada." }));
    const r = await run(d);
    expect(r.estado).toBe("pausada");
    expect(r.resumo).toMatch(/UAC.*aprove ou recuse/);
    expect(c.pedidos).toHaveLength(1);
  });

  it("campo de senha para a tarefa: a Órbita nunca digita senha", async () => {
    const c = claudeDeRoteiro([{ usos: [{ name: "type", input: { text: "hunter2" } }] }]);
    const { d } = montar({ chamarClaude: c.fn }, () => ({ permitido: false, erro: "Este é um campo de senha: a Órbita nunca digita senha. Peça ao dono para digitar." }));
    const r = await run(d);
    expect(r.estado).toBe("pausada");
    expect(r.resumo).toMatch(/senha/);
  });

  it("app que não responde: espera o tempo configurado e tenta a mesma ação uma vez", async () => {
    const c = claudeDeRoteiro([{ usos: [{ name: "left_click", input: { coordinate: [10, 10] } }] }]);
    const { d, sonos, chamadas } = montar({ chamarClaude: c.fn }, (_e, n) => (n === 1 ? { permitido: false, erro: "A leitura da tela passou do prazo: o app não responde." } : { mensagem: "Feito." }));
    const r = await run(d, { travadoMs: 7000 });
    expect(sonos).toContain(7000);
    expect(chamadas.filter((x) => x.nome === "computador_agir")).toHaveLength(2);
    expect(r).toMatchObject({ estado: "concluida", acoes: 1 });
  });

  it("app que continua sem responder pausa a tarefa e avisa", async () => {
    const c = claudeDeRoteiro([{ usos: [{ name: "left_click", input: { coordinate: [10, 10] } }] }]);
    const { d } = montar({ chamarClaude: c.fn }, () => ({ permitido: false, erro: "O app não responde." }));
    const r = await run(d, { travadoMs: 5000 });
    expect(r.estado).toBe("pausada");
    expect(r.resumo).toMatch(/não está respondendo/);
  });

  it("janela que perdeu o foco: traz a do envelope de volta uma vez; na segunda, para", async () => {
    const c = claudeDeRoteiro([{ usos: [{ name: "left_click", input: { coordinate: [10, 10] } }] }, { usos: [{ name: "left_click", input: { coordinate: [10, 10] } }] }]);
    const { d, chamadas } = montar(
      { chamarClaude: c.fn, janelas: async () => [{ janela: 42, app: "Bloco de Notas", nomes: ["Bloco de Notas", "notepad"], foco: false, minimizada: false, elevada: false, oculta: false }, { janela: 7, app: "Outro", nomes: ["outro"], foco: false, minimizada: false, elevada: false, oculta: false }] },
      () => ({ permitido: false, erro: "Essa janela não existe mais: veja as janelas de novo." }),
    );
    const r = await run(d);
    const abrir = chamadas.filter((x) => x.nome === "computador_abrir");
    expect(abrir).toEqual([{ nome: "computador_abrir", entrada: { tipo: "janela", alvo: "42" } }]);
    expect(pedidoDoLote(c, 1)[0]).toMatchObject({ content: expect.stringMatching(/Trouxe a janela de Bloco de Notas/) });
    expect(r.estado).toBe("pausada");
    expect(r.resumo).toMatch(/perdeu o foco|sumiu/);
  });
});

describe("sessão, tetos e cancelamento", () => {
  it("sessão pausada no meio do lote encerra sem agir mais", async () => {
    const c = claudeDeRoteiro([{ usos: [{ name: "left_click", input: { coordinate: [10, 10] } }, { name: "type", input: { text: "a" } }] }]);
    const m = montar({ chamarClaude: c.fn }, () => (m.sessao("pausada"), { mensagem: "Feito." }));
    const r = await run(m.d);
    expect(r.estado).toBe("pausada");
    expect(m.chamadas.filter((x) => x.nome === "computador_agir")).toHaveLength(1);
  });

  it("sessão parada (atalho, botão, voz) encerra como parada na próxima volta", async () => {
    const c = claudeDeRoteiro([{ usos: [{ name: "left_click", input: { coordinate: [10, 10] } }] }]);
    const m = montar({ chamarClaude: c.fn }, () => (m.sessao("parada"), { mensagem: "Feito." }));
    const r = await run(m.d);
    expect(r.estado).toBe("parada");
    expect(c.pedidos).toHaveLength(1);
  });

  it("sem sessão ativa nem começa", async () => {
    const m = montar();
    m.sessao("encerrada");
    const r = await run(m.d);
    expect(r).toMatchObject({ estado: "parada", acoes: 0 });
    expect(m.chamadas).toHaveLength(0);
  });

  it("o parar corta a chamada ao Claude em andamento (AbortSignal)", async () => {
    const m = montar({
      chamarClaude: async () => {
        m.sessao("parada");
        throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
      },
    });
    const r = await run(m.d);
    expect(r.estado).toBe("parada");
  });

  it("cancelado pelo dono encerra sem chamar o Claude", async () => {
    const c = claudeDeRoteiro([]);
    const r = await run(montar({ chamarClaude: c.fn, cancelado: async () => true }).d);
    expect(r.estado).toBe("parada");
    expect(c.pedidos).toHaveLength(0);
  });

  it("teto de ações pausa a sessão e NÃO amplia nada", async () => {
    const rodadas: Rodada[] = Array.from({ length: 10 }, () => ({ usos: [{ name: "left_click", input: { coordinate: [10, 10] } }] }));
    const c = claudeDeRoteiro(rodadas);
    const m = montar({ chamarClaude: c.fn });
    const r = await run(m.d, { passosMax: 3 });
    expect(r).toMatchObject({ estado: "pausada", acoes: 3 });
    expect(r.resumo).toMatch(/envelope novo/);
    expect(m.pausas).toEqual(["teto de ações da tarefa"]);
    expect(m.chamadas.filter((x) => x.nome === "computador_agir")).toHaveLength(3);
  });

  it("terminar exatamente no teto de ações conclui (não pausa à toa), e ler a tela não gasta ação", async () => {
    const um = { usos: [{ name: "left_click", input: { coordinate: [10, 10] } }, { name: "screenshot", input: {} }] };
    const c = claudeDeRoteiro([um, um], "Pronto.");
    const m = montar({ chamarClaude: c.fn });
    const r = await run(m.d, { passosMax: 2 });
    expect(r).toMatchObject({ estado: "concluida", acoes: 2 });
    expect(m.pausas).toEqual([]);
  });

  it("cancelar durante a chamada ao Claude diz que foi cancelada (não que a sessão acabou)", async () => {
    let cancelou = false;
    const m = montar({
      chamarClaude: async () => {
        cancelou = true;
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      },
      cancelado: async () => cancelou,
    });
    const r = await run(m.d);
    expect(r).toMatchObject({ estado: "parada", resumo: "Tarefa cancelada." });
  });

  it("teto de tokens pausa a sessão", async () => {
    const rodadas: Rodada[] = Array.from({ length: 10 }, () => ({ usos: [{ name: "left_click", input: { coordinate: [10, 10] } }] }));
    const c = claudeDeRoteiro(rodadas, "x", { input_tokens: 9000, output_tokens: 1000 });
    const m = montar({ chamarClaude: c.fn });
    const r = await run(m.d, { tokensMax: 25_000 });
    expect(r.estado).toBe("pausada");
    expect(m.pausas).toEqual(["teto de tokens da tarefa"]);
    expect(r.tokens).toBeGreaterThanOrEqual(25_000);
  });

  it("sem a tela no começo, falha em vez de chamar o Claude às cegas", async () => {
    const c = claudeDeRoteiro([]);
    const r = await run(montar({ chamarClaude: c.fn, tool: async () => ({ erro: "As mãos do Windows não estão no ar." }) }).d);
    expect(r.estado).toBe("falhou");
    expect(c.pedidos).toHaveLength(0);
  });
});

describe("a chamada ao Claude", () => {
  const um: Rodada[] = [{ usos: [{ name: "left_click", input: { coordinate: [10, 10] } }] }];

  it("429 espera com backoff, até 3 vezes, e depois falha com a frase (nada de laço)", async () => {
    let n = 0;
    const base = claudeDeRoteiro(um);
    const m = montar({
      chamarClaude: async (p) => {
        if (++n > 1) throw Object.assign(new Error("limite"), { status: 429 });
        return base.fn(p);
      },
    });
    const r = await run(m.d);
    expect(r.estado).toBe("falhou");
    expect(r.resumo).toMatch(/limite de uso da assinatura/);
    expect(m.sonos.filter((x) => x >= 2000)).toEqual([2000, 4000, 8000]);
    expect(n).toBe(5);
  });

  it("429 que passa depois de uma espera segue a tarefa", async () => {
    let n = 0;
    const base = claudeDeRoteiro([]);
    const m = montar({
      chamarClaude: async (p) => {
        if (++n === 1) throw Object.assign(new Error("limite"), { status: 429 });
        return base.fn(p);
      },
    });
    expect((await run(m.d)).estado).toBe("concluida");
  });

  it("na primeira rodada, a assinatura recusada (401) manda a tarefa para as tools da Órbita", async () => {
    const m = montar({ chamarClaude: async () => { throw Object.assign(new Error("negado"), { status: 401 }); } });
    const r = await run(m.d);
    expect(r).toMatchObject({ estado: "concluida", motor: "orbita", resumo: "feito com as tools da Órbita" });
  });

  it("no meio da tarefa, a assinatura recusada falha em vez de recomeçar com outro motor", async () => {
    let n = 0;
    const base = claudeDeRoteiro(um);
    const m = montar({ chamarClaude: async (p) => (++n === 1 ? base.fn(p) : Promise.reject(Object.assign(new Error("negado"), { status: 403 }))) });
    const r = await run(m.d);
    expect(r.estado).toBe("falhou");
    expect(r.motor).toBe("claude");
  });

  it("resposta vazia repete a CHAMADA uma vez (não a ação); depois falha", async () => {
    let n = 0;
    const m = montar({ chamarClaude: async () => (n++, { content: [], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 0 } }) });
    const r = await run(m.d);
    expect(n).toBe(2);
    expect(r.estado).toBe("falhou");
    expect(m.chamadas.filter((x) => x.nome === "computador_agir")).toHaveLength(0);
  });

  it("stop_reason inesperado também repete uma vez", async () => {
    const c = claudeDeRoteiro([{ texto: "cortou", stop: "max_tokens" }, { texto: "Terminei.", stop: "end_turn" }]);
    const r = await run(montar({ chamarClaude: c.fn }).d);
    expect(c.pedidos).toHaveLength(2);
    expect(r).toMatchObject({ estado: "concluida", resumo: "Terminei." });
  });

  it("imagem recusada por tamanho: reduz a captura e tenta uma vez", async () => {
    let n = 0;
    const base = claudeDeRoteiro(um);
    const m = montar({
      chamarClaude: async (p) => {
        if (++n === 2) throw Object.assign(new Error("Claude respondeu 400: image dimensions exceed"), { status: 400 });
        return base.fn(p);
      },
    });
    const r = await run(m.d);
    const telas = m.chamadas.filter((x) => x.nome === "computador_ver");
    expect(telas.at(-1)!.entrada).toMatchObject({ reducao: 0.5 });
    expect(r.estado).toBe("concluida");
  });
});

describe("escalada de modelo e compactação", () => {
  it("com a chave ligada, o segundo erro igual chama o Opus uma vez; se falhar de novo, para", async () => {
    const um = { usos: [{ name: "left_click", input: { coordinate: [10, 10] } }] };
    const c = claudeDeRoteiro([um, um, um, um]);
    const m = montar({ chamarClaude: c.fn }, () => ({ permitido: false, erro: "A tela mudou entre propor e executar." }));
    const r = await run(m.d, { escalarParaOpus: true });
    expect(c.pedidos.map((p) => p.modelo)).toEqual(["claude/claude-sonnet-5-5", "claude/claude-sonnet-5-5", "claude/claude-opus-5-5", "claude/claude-opus-5-5"].slice(0, c.pedidos.length));
    expect(c.pedidos[2]!.modelo).toBe("claude/claude-opus-5-5");
    expect(r.estado).toBe("falhou");
    expect(m.usos).toContain("claude/claude-opus-5-5");
  });

  it("perto do teto de contexto o Claude resume e a tarefa recomeça só com o resumo e a última captura", async () => {
    const um = { usos: [{ name: "left_click", input: { coordinate: [10, 10] } }] };
    let n = 0;
    const base = claudeDeRoteiro([um, { texto: "Resumo: abri o Bloco de Notas, falta digitar." }, { texto: "Pronto." }]);
    const m = montar({
      chamarClaude: async (p) => {
        const r = await base.fn(p);
        // a primeira resposta já estoura o contexto
        return ++n === 1 ? { ...r, usage: { input_tokens: 160_000, output_tokens: 100 } } : r;
      },
    });
    const r = await run(m.d);
    // 2ª chamada: o pedido de resumo; 3ª: histórico novo de uma mensagem
    expect(JSON.stringify(base.pedidos[1]!.mensagens.at(-1))).toContain(PEDIDO_DE_RESUMO.slice(0, 30));
    expect(base.pedidos[2]!.mensagens).toHaveLength(1);
    expect(JSON.stringify(base.pedidos[2]!.mensagens[0])).toContain("Resumo: abri o Bloco de Notas");
    expect(JSON.stringify(base.pedidos[2]!.mensagens[0])).toContain("iVBOR");
    expect(r).toMatchObject({ estado: "concluida", resumo: "Pronto." });
  });
});

describe("sem o Claude", () => {
  it("motor orbita (ou sem token) vai direto para as tools da Órbita e diz qual motor rodou", async () => {
    const c = claudeDeRoteiro([]);
    const m = montar({ chamarClaude: c.fn });
    const r = await run(m.d, { usarClaude: false });
    expect(r).toMatchObject({ estado: "concluida", motor: "orbita", resumo: "feito com as tools da Órbita" });
    expect(c.pedidos).toHaveLength(0);
    expect(m.chamadas).toHaveLength(0);
  });
});

describe("puros", () => {
  it("classifica o erro pela frase da tool", () => {
    expect(classificarErro("Essa janela roda como administrador")).toBe("elevacao");
    expect(classificarErro("Este é um campo de senha")).toBe("senha");
    expect(classificarErro("A sessão de controle do computador não está mais ativa.")).toBe("sessao");
    expect(classificarErro("O app não responde")).toBe("travado");
    expect(classificarErro("Essa janela não existe mais")).toBe("janela");
    expect(classificarErro("a assinatura não bate")).toBe("alvo");
    expect(classificarErro("alguma coisa estranha")).toBe("outro");
  });

  it("a entrada do computador_agir leva só o que o passo tem", () => {
    expect(entradaDoPasso({ acao: "arrastar", alvo: { captura: "c", x: 1, y: 2 }, destino: { captura: "c", x: 3, y: 4 } })).toEqual({ acao: "arrastar", alvo: { captura: "c", x: 1, y: 2 }, destino: { captura: "c", x: 3, y: 4 } });
    expect(entradaDoPasso({ acao: "tecla", tecla: "Enter", quantidade: 2 })).toEqual({ acao: "tecla", tecla: "Enter", quantidade: 2 });
  });
});
