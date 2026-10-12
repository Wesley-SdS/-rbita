import { describe, expect, it } from "vitest";
import type { NavegadorRoteiro, PassoDeRoteiro } from "@orbita/db/navegador-schema";
import type { BlocoClaude, MensagemClaude, PedidoClaudeDireto, RespostaClaudeDireto } from "@orbita/llm";
import { estadoDoNavegador, filtrarPorBusca, podarCapturas, rodarTarefa, toolsetDoNavegador, type CfgDoMotor, type DependenciasDoMotor } from "./motor";
import type { Ordem } from "./protocolo";

/**
 * O LAÇO DELEGADO (B3, B4) com o Claude e as mãos falsos: cada membro do
 * browser toolset vira a tool certa do registro, coordenada vira elemento,
 * proposta espera o dono, login para e avisa, e o roteiro aprendido roda a
 * segunda vez sem gastar modelo.
 */

const CFG: CfgDoMotor = { modelo: "claude/claude-sonnet-5-5", passosMax: 10, capturas: 3, esperaAprovacaoMs: 1000, esperaLoginMs: 50, roteiros: true, usarClaude: true, capturaLargura: 1280 };

type Chamada = { nome: string; entrada: Record<string, unknown> };

/** Um "Claude" de roteiro fixo: cada rodada devolve os tool_use dados, depois o texto final. */
function claudeDeRoteiro(rodadas: { usos: { name: string; input: Record<string, unknown> }[] }[], final = "RESULTADO: CUMPRIDO\nPronto: preenchi o formulário.", tokens = 6000) {
  const pedidos: PedidoClaudeDireto[] = [];
  let i = 0;
  const fn = async (p: PedidoClaudeDireto): Promise<RespostaClaudeDireto> => {
    pedidos.push(structuredClone(p));
    const r = rodadas[i++];
    const content: BlocoClaude[] = r ? r.usos.map((u, j) => ({ type: "tool_use", id: `toolu_${i}_${j}`, name: u.name, input: u.input, toolset_name: "browser" })) : [{ type: "text", text: final }];
    return { content, stop_reason: r ? "tool_use" : "end_turn", usage: { input_tokens: tokens - 200, output_tokens: 200 } };
  };
  return { fn, pedidos };
}

function deps(over: Partial<DependenciasDoMotor> = {}) {
  const chamadas: Chamada[] = [];
  const ordens: Ordem[] = [];
  const avisos: string[] = [];
  const salvos: { dominio: string; passos: PassoDeRoteiro[]; tokens: number }[] = [];
  let roteiro: NavegadorRoteiro | null = null;
  const d: DependenciasDoMotor = {
    chamarClaude: async () => ({ content: [{ type: "text", text: "nada" }], stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 } }),
    tool: async (nome, entrada) => {
      chamadas.push({ nome, entrada });
      if (nome === "navegador_abrir") return { aba: 7, mensagem: "Abri empresa.com na aba 7." };
      if (nome === "navegador_ler" && entrada.acao === "ver") return { aba: 7, escala: 0.5, imagem_para_modelo: { base64: "iVBOR", mediaType: "image/png", alternativa: { tipo: "arvore", texto: "x" } } };
      if (nome === "navegador_ler") return { aba: 7, conteudo: '<dado_externo origem="pagina">\ntextbox "Nome" [ref_1]\nbutton "Enviar" [ref_2]\nlink "Ajuda" [ref_3]\n</dado_externo>' };
      return { aba: 7, mensagem: `feito: ${String(entrada.acao)}` };
    },
    ordem: async (o) => {
      ordens.push(o);
      if (o.tipo === "descrever") return { aba: 7, alvo: { ref: o.ref ?? "ref_9", papel: "button", nome: o.ref ? "Nome" : "Enviar", sensivel: false, submit: !o.ref, upload: false, emFormulario: true, centro: { x: 1, y: 1 }, visivel: true, seletor: "#enviar" } };
      if (o.tipo === "achar") return { aba: 7, alvo: { ref: "ref_20", papel: o.papel ?? "button", nome: o.nome ?? "", sensivel: false, submit: false, upload: false, emFormulario: false, centro: { x: 1, y: 1 }, visivel: true, seletor: o.seletor ?? "" } };
      if (o.tipo === "ler") return { leitura: { url: "https://empresa.com/form", titulo: "x", bloqueio: null, escondidos: 0, viewport: { largura: 1, altura: 1, dpr: 1 } } };
      return {};
    },
    abas: async () => [{ aba: 7, titulo: "Reembolso", url: "https://empresa.com/form", ativa: true, noGrupo: true }, { aba: 2, titulo: "Banco", url: "", ativa: false, noGrupo: false, bloqueada: true }],
    esperarAprovacao: async () => ({ status: "executada", resultado: "Cliquei em Enviar." }),
    sessaoAtiva: async () => true,
    cancelado: async () => false,
    avisar: async (t, x) => void avisos.push(`${t}: ${x}`),
    dormir: async () => undefined,
    progresso: async () => undefined,
    roteiro: {
      buscar: async () => roteiro,
      salvar: async (dominio, passos, tokens) => {
        salvos.push({ dominio, passos, tokens });
        roteiro = { id: "r1", userId: "u1", dominio, intencao: "x", intencaoChave: "x", passos, tokensAprendizado: tokens, usos: 0, falhas: 0, criadoEm: new Date(), usadoEm: null };
      },
      marcar: async () => undefined,
    },
    motorDaOrbita: async () => "feito com as tools da Órbita",
    ...over,
  };
  return { d, chamadas, ordens, avisos, salvos };
}

const formulario = [
  { usos: [{ name: "navigate", input: { url: "https://empresa.com/form" } }, { name: "find", input: { query: "campo nome" } }] },
  { usos: [{ name: "form_input", input: { target: { type: "ref", ref: "ref_1" }, value: "Wesley" } }, { name: "left_click", input: { target: { type: "coordinate", x: 640, y: 320 } } }] },
];

describe("tradução dos membros do toolset", () => {
  it("o toolset vai sem nome e com os membros sem tradução segura desligados", () => {
    const t = toolsetDoNavegador();
    expect(t).toMatchObject({ type: "browser_toolset_20260801", configs: { left_click_drag: { enabled: false }, hold_key: { enabled: false }, mouse_move: { enabled: false } } });
    expect(t).not.toHaveProperty("name");
  });

  it("cada membro vira a tool do registro; coordenada vira ELEMENTO antes", async () => {
    const c = claudeDeRoteiro(formulario);
    const { d, chamadas, ordens } = deps({ chamarClaude: c.fn });
    const r = await rodarTarefa({ objetivo: "preencher o reembolso", pedido: "preenche o reembolso" }, d, { ...CFG, roteiros: false });
    expect(r).toMatchObject({ estado: "concluida", motor: "claude", resumo: "Pronto: preenchi o formulário." });
    expect(chamadas.map((x) => x.nome)).toEqual(["navegador_abrir", "navegador_ler", "navegador_agir", "navegador_agir"]);
    expect(chamadas[1]!.entrada).toMatchObject({ modo: "arvore", filtro: "tudo" });
    expect(chamadas[2]!.entrada).toMatchObject({ acao: "preencher", ref: "ref_1", texto: "Wesley" });
    // (640, 320) da captura, na escala 1, perguntado à página: o clique vai pela ref do elemento
    expect(ordens.find((o) => o.tipo === "descrever" && !o.ref)).toMatchObject({ x: 640, y: 320 });
    expect(chamadas[3]!.entrada).toMatchObject({ acao: "clicar", ref: "ref_9" });
    // o resultado do find veio filtrado e embrulhado
    const resultados = (c.pedidos[1]!.mensagens.at(-1)!.content as BlocoClaude[]).filter((b) => b.type === "tool_result");
    expect(JSON.stringify(resultados[1])).toContain('textbox \\"Nome\\" [ref_1]');
    expect(JSON.stringify(resultados[1])).not.toContain("Ajuda");
    // o primeiro bloco de system é responsabilidade do chamarClaudeDireto; aqui vai o objetivo
    expect(c.pedidos[0]!.system).toContain("OBJETIVO: preencher o reembolso");
    expect(c.pedidos[0]!.tools).toEqual([toolsetDoNavegador()]);
  });

  it("membro desligado responde erro e o resto do lote não roda", async () => {
    const c = claudeDeRoteiro([{ usos: [{ name: "left_click_drag", input: {} }, { name: "navigate", input: { url: "x.com" } }] }]);
    const { d, chamadas } = deps({ chamarClaude: c.fn });
    await rodarTarefa({ objetivo: "x", pedido: "x" }, d, { ...CFG, roteiros: false });
    const r = c.pedidos[1]!.mensagens.at(-1)!.content as BlocoClaude[];
    expect(r[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/not enabled/) });
    expect(r[1]).toMatchObject({ is_error: true, content: expect.stringMatching(/Not executed/) });
    expect(chamadas).toHaveLength(0);
  });

  it("tab, screenshot e escala: browser_state com uma ativa, imagem em bloco e coordenada reescalada", async () => {
    const c = claudeDeRoteiro([{ usos: [{ name: "new_tab", input: {} }] }, { usos: [{ name: "screenshot", input: {} }] }, { usos: [{ name: "left_click", input: { target: { type: "coordinate", x: 100, y: 50 } } }] }]);
    const { d, ordens } = deps({ chamarClaude: c.fn });
    await rodarTarefa({ objetivo: "x", pedido: "x" }, d, { ...CFG, roteiros: false });
    const tab = (c.pedidos[1]!.mensagens.at(-1)!.content as BlocoClaude[])[0]!;
    expect(tab.content).toEqual([{ type: "browser_state", tabs: [{ tab_id: "tab-7", title: "Reembolso", url: "https://empresa.com/form", active: true }], state_changes: [{ type: "tab_opened", tab_id: "tab-7" }] }]);
    const img = (c.pedidos[2]!.mensagens.at(-1)!.content as BlocoClaude[])[0]!;
    expect(img.content).toEqual([{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBOR" } }]);
    // escala 0,5: o ponto 100,50 da captura é 200,100 na página
    expect(ordens.find((o) => o.tipo === "descrever" && !o.ref)).toMatchObject({ x: 200, y: 100 });
  });
});

describe("o dono no meio", () => {
  it("ação com efeito espera a aprovação, e continua quando aprovada", async () => {
    const c = claudeDeRoteiro([{ usos: [{ name: "left_click", input: { target: { type: "ref", ref: "ref_2" } } }] }]);
    const { d, avisos } = deps({ chamarClaude: c.fn, tool: async () => ({ proposta_enfileirada: true, aguardando_aprovacao: true, id: "a9", resumo: 'clicar button "Enviar"' }) });
    const r = await rodarTarefa({ objetivo: "x", pedido: "x" }, d, { ...CFG, roteiros: false });
    expect(avisos[0]).toMatch(/aprove: clicar button "Enviar"/);
    expect(JSON.stringify(c.pedidos[1]!.mensagens.at(-1))).toContain("O dono aprovou e a ação foi executada");
    expect(r.estado).toBe("concluida");
  });

  it("recusada na fila: a tarefa para e diz por quê", async () => {
    const c = claudeDeRoteiro([{ usos: [{ name: "left_click", input: { target: { type: "ref", ref: "ref_2" } } }] }]);
    const { d } = deps({ chamarClaude: c.fn, tool: async () => ({ proposta_enfileirada: true, id: "a9", resumo: "Enviar" }), esperarAprovacao: async () => ({ status: "recusada", resultado: "cancelled" }) });
    const r = await rodarTarefa({ objetivo: "x", pedido: "x" }, d, { ...CFG, roteiros: false });
    expect(r).toMatchObject({ estado: "pausada", resumo: expect.stringMatching(/não aprovou/) });
  });

  it("login na página: avisa o dono, espera, e para se ele não resolver", async () => {
    const c = claudeDeRoteiro([{ usos: [{ name: "navigate", input: { url: "https://empresa.com/entrar" } }] }]);
    const { d, avisos } = deps({
      chamarClaude: c.fn,
      ordem: async (o) => (o.tipo === "ler" ? { leitura: { url: "https://empresa.com/entrar", titulo: "Entrar", bloqueio: "login", escondidos: 0, viewport: { largura: 1, altura: 1, dpr: 1 } } } : {}),
    });
    const r = await rodarTarefa({ objetivo: "x", pedido: "x" }, d, { ...CFG, roteiros: false, esperaLoginMs: 1 });
    expect(avisos[0]).toMatch(/fazer o login/);
    expect(r).toMatchObject({ estado: "pausada", resumo: expect.stringMatching(/login .* não foi resolvido/) });
  });

  it("sessão parada no meio: a tarefa para na rodada seguinte", async () => {
    let ativa = true;
    const c = claudeDeRoteiro([{ usos: [{ name: "find", input: { query: "x" } }] }, { usos: [{ name: "find", input: { query: "y" } }] }]);
    const { d } = deps({ chamarClaude: async (p) => ((ativa = false), c.fn(p)), sessaoAtiva: async () => ativa });
    expect((await rodarTarefa({ objetivo: "x", pedido: "x" }, d, { ...CFG, roteiros: false })).estado).toBe("parada");
  });

  it("sem o Claude, ou com ele fora na primeira rodada, vale o motor da Órbita", async () => {
    const { d } = deps({ chamarClaude: async () => Promise.reject(new Error("429")) });
    expect(await rodarTarefa({ objetivo: "x", pedido: "x" }, d, { ...CFG, roteiros: false })).toMatchObject({ motor: "orbita", resumo: "feito com as tools da Órbita" });
    expect(await rodarTarefa({ objetivo: "x", pedido: "x" }, deps().d, { ...CFG, usarClaude: false, roteiros: false })).toMatchObject({ motor: "orbita" });
  });
});

describe("roteiros (B4)", () => {
  it("a segunda execução da mesma tarefa gasta bem menos de 20% dos tokens da primeira, e o Enviar continua indo pela tool", async () => {
    const c = claudeDeRoteiro(formulario);
    const ambiente = deps({ chamarClaude: c.fn });
    const primeira = await rodarTarefa({ objetivo: "preencher o reembolso", pedido: "x" }, ambiente.d, CFG);
    expect(primeira).toMatchObject({ roteiro: "aprendido", motor: "claude" });
    expect(primeira.tokens).toBe(18000);
    expect(ambiente.salvos[0]!.passos.map((p) => p.acao)).toEqual(["abrir", "preencher", "clicar"]);
    expect(ambiente.salvos[0]!.passos[2]!.alvo).toMatchObject({ papel: "button", nome: "Enviar", seletor: "#enviar" });

    ambiente.chamadas.length = 0;
    const segunda = await rodarTarefa({ objetivo: "preencher o reembolso", pedido: "x" }, { ...ambiente.d, chamarClaude: async () => Promise.reject(new Error("não devia chamar o modelo")) }, CFG);
    expect(segunda).toMatchObject({ estado: "concluida", motor: "roteiro", roteiro: "usado", tokens: 0 });
    expect(segunda.tokens).toBeLessThan(primeira.tokens * 0.2);
    // o roteiro achou os alvos pela semântica e passou pelas MESMAS tools (com fila e crítico)
    expect(ambiente.chamadas.map((x) => `${x.nome}:${String(x.entrada.acao)}`)).toEqual(["navegador_abrir:abrir", "navegador_agir:preencher", "navegador_agir:clicar"]);
  });

  it("passo que não casa devolve ao modelo, a partir dali", async () => {
    const c = claudeDeRoteiro([]);
    const ambiente = deps({ chamarClaude: c.fn });
    await ambiente.d.roteiro.salvar("empresa.com", [{ acao: "abrir", url: "https://empresa.com/form" }, { acao: "clicar", alvo: { papel: "button", nome: "Sumiu" } }], 9000);
    const r = await rodarTarefa({ objetivo: "x", pedido: "x" }, { ...ambiente.d, ordem: async (o) => (o.tipo === "achar" ? {} : { leitura: { url: "https://empresa.com", titulo: "", bloqueio: null, escondidos: 0, viewport: { largura: 1, altura: 1, dpr: 1 } } }) }, CFG);
    expect(r.motor).toBe("claude");
    expect(String(c.pedidos[0]!.mensagens[0]!.content)).toMatch(/parou porque o alvo "Sumiu"/);
  });
});

describe("utilidades do laço", () => {
  it("só as 3 últimas capturas ficam inteiras", () => {
    const img = (): BlocoClaude => ({ type: "tool_result", tool_use_id: "t", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "x" } }] });
    const msgs: MensagemClaude[] = Array.from({ length: 5 }, () => ({ role: "user" as const, content: [img()] }));
    podarCapturas(msgs, 3);
    const tipos = msgs.map((m) => ((m.content as BlocoClaude[])[0]!.content as BlocoClaude[])[0]!.type);
    expect(tipos).toEqual(["text", "text", "image", "image", "image"]);
  });
  it("browser_state: só o grupo da Órbita, nunca a aba bloqueada", () => {
    expect(estadoDoNavegador([{ aba: 1, titulo: "x", url: "u", ativa: false, noGrupo: false }], null)).toEqual({ type: "browser_state", tabs: [] });
  });
  it("find sem nada que case diz isso, embrulhado", () => {
    expect(filtrarPorBusca('button "A" [ref_1]', "zzz")).toMatch(/<dado_externo origem="pagina">\nNada casou/);
  });
});
