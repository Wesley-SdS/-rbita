import { describe, expect, it } from "vitest";
import { SETTING_DEFS } from "../settings/defs";
import { apertaEnter, recusaDoPasso, riscoDeAbrir, riscoDoLote, riscoDoPasso, type ElementoVisto, type PassoParaRisco } from "./risco";

/**
 * O risco pelo ALVO no Windows (PRD §5.3, A7), puro: o que as mãos disseram
 * que está no ponto decide, não o que o modelo diz. Inclui os aceites do PRD:
 * "Enviar" no Outlook vira proposta; digitar em campo de senha é recusado;
 * app fora do envelope é recusado.
 */

const rotulos = SETTING_DEFS["computador.rotulosDeEfeito"].default;
const el = (p: Partial<ElementoVisto> = {}): ElementoVisto => ({
  papel: "botao", nome: "Ver mais", assinatura: "abc", senha: false, app: "Outlook", nomesDoApp: ["olk", "outlook", "novo outlook"], oculto: false, elevado: false, janela: 1, ponto: [10, 10], ...p,
});
const passo = (p: Partial<PassoParaRisco>): PassoParaRisco => ({ acao: "clicar", alvo: el(), focado: null, ...p });
const ENV = ["Outlook"];

describe("recusaDoPasso", () => {
  it("app no envelope e alvo comum: passa", () => {
    expect(recusaDoPasso(passo({}), ENV)).toBeNull();
  });

  it("app da lista de recusados (navegador) é recusado mesmo DENTRO do envelope", () => {
    const chrome = el({ app: "Google Chrome", nomesDoApp: ["chrome", "google chrome"] });
    expect(recusaDoPasso(passo({ alvo: chrome }), ["Chrome"])).toBeNull();
    expect(recusaDoPasso(passo({ alvo: chrome }), ["Chrome"], SETTING_DEFS["computador.appsRecusados"].default)).toMatch(/appsRecusados.*navegador_tarefa/);
    // o controle: o Outlook segue passando com a mesma lista
    expect(recusaDoPasso(passo({}), ENV, SETTING_DEFS["computador.appsRecusados"].default)).toBeNull();
  });

  it("app fora do envelope é recusado", () => {
    expect(recusaDoPasso(passo({ alvo: el({ app: "Excel", nomesDoApp: ["excel", "microsoft excel"] }) }), ENV)).toContain("não está no envelope");
  });

  it("digitar no campo de senha do Windows é recusado, com e sem alvo", () => {
    expect(recusaDoPasso(passo({ acao: "digitar", texto: "123", alvo: el({ papel: "campo", senha: true }) }), ENV)).toContain("senha");
    expect(recusaDoPasso(passo({ acao: "digitar", texto: "123", alvo: null, focado: el({ papel: "campo", senha: true }) }), ENV)).toContain("senha");
  });

  it("colar (ctrl+v) em campo de senha também", () => {
    expect(recusaDoPasso(passo({ acao: "atalho", tecla: "Ctrl+V", alvo: null, focado: el({ papel: "campo", senha: true }) }), ENV)).toContain("senha");
  });

  it("app oculto e janela de administrador são recusados", () => {
    expect(recusaDoPasso(passo({ alvo: el({ oculto: true }) }), ENV)).toContain("ocultos");
    expect(recusaDoPasso(passo({ alvo: el({ elevado: true }) }), ENV)).toContain("administrador");
  });

  it("clique sem alvo, arrastar sem destino e ação sem foco são recusados", () => {
    expect(recusaDoPasso(passo({ alvo: null }), ENV)).toContain("precisa de um alvo");
    expect(recusaDoPasso(passo({ acao: "arrastar" }), ENV)).toContain("destino");
    expect(recusaDoPasso(passo({ acao: "tecla", tecla: "Tab", alvo: null, focado: null }), ENV)).toContain("foco");
  });

  it("arrastar para um app fora do envelope é recusado", () => {
    expect(recusaDoPasso(passo({ acao: "arrastar", destino: el({ app: "Explorer", nomesDoApp: ["explorer"] }) }), ENV)).toContain("Explorer");
  });
});

describe("riscoDoPasso", () => {
  it("clicar em Enviar no Outlook vira proposta", () => {
    const d = riscoDoPasso(passo({ alvo: el({ nome: "Enviar" }) }), rotulos);
    expect(d.risco).toBe("efeito_externo");
    expect(d.motivo).toContain("Enviar");
  });

  it("clicar em Ver mais é escrita", () => {
    expect(riscoDoPasso(passo({}), rotulos)).toEqual({ risco: "escrita", motivo: null });
  });

  it("palavra inteira: 'Reenviar' não bate com 'enviar', 'Excluir item' bate com 'excluir'", () => {
    expect(riscoDoPasso(passo({ alvo: el({ nome: "Reenviarx" }) }), rotulos).risco).toBe("escrita");
    expect(riscoDoPasso(passo({ alvo: el({ nome: "Excluir item" }) }), rotulos).risco).toBe("efeito_externo");
  });

  it("clique direito (abre menu) não sobe", () => {
    expect(riscoDoPasso(passo({ acao: "clique_direito", alvo: el({ nome: "Enviar" }) }), rotulos).risco).toBe("escrita");
  });

  it("Enter num campo de conversa envia: efeito_externo; num documento é quebra de linha", () => {
    const campo = el({ papel: "campo", nome: "Digite uma mensagem" });
    expect(riscoDoPasso(passo({ acao: "tecla", tecla: "Enter", alvo: null, focado: campo }), rotulos).risco).toBe("efeito_externo");
    expect(riscoDoPasso(passo({ acao: "atalho", tecla: "ctrl+enter", alvo: null, focado: campo }), rotulos).risco).toBe("efeito_externo");
    expect(riscoDoPasso(passo({ acao: "tecla", tecla: "Enter", alvo: null, focado: el({ papel: "documento", nome: "Texto" }) }), rotulos).risco).toBe("escrita");
  });

  it("digitar com quebra de linha é apertar Enter", () => {
    expect(apertaEnter({ acao: "digitar", texto: "oi\nmanda" })).toBe(true);
    expect(riscoDoPasso(passo({ acao: "digitar", texto: "oi\n", alvo: el({ papel: "campo", nome: "Mensagem" }) }), rotulos).risco).toBe("efeito_externo");
    expect(riscoDoPasso(passo({ acao: "digitar", texto: "oi", alvo: el({ papel: "campo", nome: "Mensagem" }) }), rotulos).risco).toBe("escrita");
  });

  it("arrastar sobre algo com rótulo de efeito sobe", () => {
    expect(riscoDoPasso(passo({ acao: "arrastar", destino: el({ nome: "Compartilhar" }) }), rotulos).risco).toBe("efeito_externo");
  });

  it("o lote vale pelo pior passo", () => {
    const d = riscoDoLote([passo({}), passo({ alvo: el({ nome: "Enviar" }) })], rotulos);
    expect(d).toMatchObject({ risco: "efeito_externo", passo: 1 });
    expect(riscoDoLote([passo({})], rotulos).risco).toBe("escrita");
  });
});

describe("riscoDeAbrir", () => {
  const env = { apps: ["notepad", "VS Code"], sites: ["jira.com"] };
  it("app do envelope é escrita; fora, efeito_externo; sem sessão, efeito_externo", () => {
    expect(riscoDeAbrir({ tipo: "app", alvo: "Notepad" }, env).risco).toBe("escrita");
    expect(riscoDeAbrir({ tipo: "app", alvo: "excel" }, env).risco).toBe("efeito_externo");
    expect(riscoDeAbrir({ tipo: "app", alvo: "notepad" }, null).risco).toBe("efeito_externo");
  });
  it("arquivo sempre pela fila", () => {
    expect(riscoDeAbrir({ tipo: "arquivo", alvo: "C:\\x.pdf" }, env).risco).toBe("efeito_externo");
  });
  it("endereço: do envelope sem parâmetros é escrita; com parâmetros ou fora, efeito_externo; torto, perigoso", () => {
    expect(riscoDeAbrir({ tipo: "url", alvo: "https://app.jira.com/browse/X-1" }, env).risco).toBe("escrita");
    expect(riscoDeAbrir({ tipo: "url", alvo: "https://jira.com/x?vaza=segredo" }, env).risco).toBe("efeito_externo");
    expect(riscoDeAbrir({ tipo: "url", alvo: "https://evil.example" }, env).risco).toBe("efeito_externo");
    expect(riscoDeAbrir({ tipo: "url", alvo: "nao e url" }, env).risco).toBe("perigoso");
  });
});
