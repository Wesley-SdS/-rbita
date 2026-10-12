import { describe, expect, it } from "vitest";
import { sensiveisLiberados, ehToolSensivel, tipoDeAlvoDoDominio, DOMINIOS_SENSIVEIS } from "./dominios";
import { appNoEnvelope, conferirSessao, listaLimpa, normalizarApp, normalizarSite, siteNoEnvelope, type SessaoParaConferir } from "./envelope";
import { modeloRecebeImagem, saidaParaOModelo, semImagem, comImagem, imagemDaSaida, separarMiniatura, comMiniatura } from "./imagem";

/**
 * As regras puras do controle do PC: quando os domínios sensíveis entram no
 * turno, o que um envelope cobre e como a imagem chega (ou não) ao modelo.
 */

describe("domínios sensíveis (F1)", () => {
  const base = { ativo: true, canais: ["tela", "voz", "whatsapp"], canal: "tela" };
  it("só com controle ligado, no canal liberado e fora dos turnos de terceiro", () => {
    expect(sensiveisLiberados(base)).toBe(true);
    expect(sensiveisLiberados({ ...base, ativo: false })).toBe(false);
    expect(sensiveisLiberados({ ...base, canal: "telegram" })).toBe(false);
    expect(sensiveisLiberados({ ...base, canal: "WhatsApp" })).toBe(true);
    expect(sensiveisLiberados({ ...base, soLeitura: true })).toBe(false);
    expect(sensiveisLiberados({ ...base, pessoaDaCasa: true })).toBe(false);
    expect(sensiveisLiberados({ ...base, canais: [] })).toBe(false);
  });
  it("sensível pelo NOME do domínio (a tool não precisa lembrar) ou por requires.dono", () => {
    for (const d of DOMINIOS_SENSIVEIS) expect(ehToolSensivel({ domain: d })).toBe(true);
    expect(ehToolSensivel({ domain: "financas" })).toBe(false);
    expect(ehToolSensivel({ domain: "financas", requires: { dono: true } })).toBe(true);
    expect(tipoDeAlvoDoDominio("computador")).toBe("computador");
    expect(tipoDeAlvoDoDominio("navegador")).toBe("navegador");
    expect(tipoDeAlvoDoDominio("terminal")).toBeNull();
  });
});

describe("envelope (F2)", () => {
  it("normaliza app e site sem confiar em caixa, acento, .exe, esquema ou caminho", () => {
    expect(normalizarApp("Code.EXE")).toBe("code");
    expect(normalizarApp("  Área  de Trabalho ")).toBe("area de trabalho");
    expect(normalizarSite("https://www.Jira.com/browse/X?y=1#z")).toBe("jira.com");
    expect(normalizarSite("*.empresa.com")).toBe("empresa.com");
    // atlassian.net é sufixo público (cada subdomínio é de um cliente): sozinho, não é um site
    expect(normalizarSite("*.atlassian.net")).toBe("");
    expect(normalizarSite("*.meu-time.atlassian.net")).toBe("meu-time.atlassian.net");
    expect(normalizarSite("javascript:alert(1)")).toBe("");
    expect(normalizarSite("localhost")).toBe("");
    expect(listaLimpa(["a.com", "A.com", "", "b.com"], normalizarSite)).toEqual(["a.com", "b.com"]);
  });
  it("subdomínio cabe; domínio parecido não", () => {
    expect(siteNoEnvelope("app.jira.com", ["jira.com"])).toBe(true);
    expect(siteNoEnvelope("jira.com.evil.io", ["jira.com"])).toBe(false);
    expect(siteNoEnvelope("notjira.com", ["jira.com"])).toBe(false);
    expect(appNoEnvelope("code.exe", ["Code"])).toBe(true);
    expect(appNoEnvelope("excel", ["Code"])).toBe(false);
  });

  const sessao = (x: Partial<SessaoParaConferir> = {}): SessaoParaConferir => ({
    alvo: "computador", apps: ["VS Code"], sites: [], status: "ativa", expiraEm: new Date(Date.now() + 60_000), passosUsados: 0, tetoPassos: 3, ...x,
  });
  it("sem sessão, a recusa diz como abrir uma", () => {
    const c = conferirSessao(null, { tipo: "computador" });
    expect(c.ok).toBe(false);
    expect(!c.ok && c.motivo).toMatch(/controle_iniciar/);
  });
  it("sessão do tipo errado, pausada, vencida, no teto ou com alvo fora: recusa", () => {
    expect(conferirSessao(sessao(), { tipo: "navegador" }).ok).toBe(false);
    expect(conferirSessao(sessao({ alvo: "ambos", sites: ["jira.com"] }), { tipo: "navegador", dominio: "jira.com" }).ok).toBe(true);
    expect(conferirSessao(sessao({ status: "pausada" }), { tipo: "computador" }).ok).toBe(false);
    expect(conferirSessao(sessao({ expiraEm: new Date(Date.now() - 1) }), { tipo: "computador" })).toMatchObject({ ok: false, pausar: "tempo" });
    expect(conferirSessao(sessao({ passosUsados: 3 }), { tipo: "computador" })).toMatchObject({ ok: false, pausar: "teto de passos" });
    expect(conferirSessao(sessao(), { tipo: "computador", app: "Excel" })).toMatchObject({ ok: false });
    expect(conferirSessao(sessao(), { tipo: "computador", app: "vs code" }).ok).toBe(true);
  });
  it("envelope sem app não é 'qualquer app' (falha fechada)", () => {
    expect(conferirSessao(sessao({ apps: [] }), { tipo: "computador", app: "Code" }).ok).toBe(false);
  });
});

describe("imagem para o modelo (F5)", () => {
  const saida = comImagem({ janela: "Chrome" }, { base64: "QUJD", mediaType: "image/jpeg", alternativa: { tipo: "narracao", texto: "uma página de login" }, miniatura: "data:image/jpeg;base64,QQ==" });
  it("quem não enxerga recebe a alternativa, sem os bytes", () => {
    expect(semImagem(saida)).toEqual({ janela: "Chrome", visao_usada: "narracao", narracao: "uma página de login" });
    expect(JSON.stringify(saidaParaOModelo(saida, false))).not.toContain("QUJD");
  });
  it("quem enxerga recebe texto e a imagem como arquivo", () => {
    const s = saidaParaOModelo(saida, true);
    expect(s.type).toBe("content");
    expect(JSON.stringify(s)).toContain("QUJD");
    expect(imagemDaSaida({ imagem_para_modelo: { base64: 1 } })).toBeNull();
  });
  it("a miniatura do cartão (controle.miniatura) nunca vai ao modelo, enxergue ele ou não (I10)", () => {
    const mini = `data:image/jpeg;base64,${"A".repeat(5000)}`;
    const status = { mensagem: "Sessão ativa", controle: { sessaoId: "s1", objetivo: "x", miniatura: mini } };
    for (const enxerga of [false, true]) {
      const s = JSON.stringify(saidaParaOModelo(status, enxerga));
      expect(s).not.toContain("base64");
      expect(s).toContain("Sessão ativa");
      expect(s).toContain("s1");
    }
    // com imagem de verdade junto (captura), a miniatura do cartão também fica de fora
    expect(JSON.stringify(saidaParaOModelo({ ...saida, controle: { miniatura: mini } }, true))).not.toContain("AAAAAAAA");
    // a voz: a rota manda a saída sem ela e a miniatura à parte; a tela junta de novo para o cartão
    const { saida: semMini, miniatura } = separarMiniatura(status);
    expect(JSON.stringify(semMini)).not.toContain("base64");
    expect(miniatura).toBe(mini);
    expect(comMiniatura(semMini, miniatura)).toEqual(status);
    expect(separarMiniatura({ texto: "x" })).toEqual({ saida: { texto: "x" }, miniatura: null });
  });
  it("só modelo que enxerga, e nuvem só com a captura liberada", () => {
    expect(modeloRecebeImagem(undefined, true)).toBe(false);
    expect(modeloRecebeImagem({ supportsVision: false, local: true }, true)).toBe(false);
    expect(modeloRecebeImagem({ supportsVision: true, local: false }, true)).toBe(true);
    expect(modeloRecebeImagem({ supportsVision: true, local: false }, false)).toBe(false);
    expect(modeloRecebeImagem({ supportsVision: true, local: true }, false)).toBe(true);
  });
});
