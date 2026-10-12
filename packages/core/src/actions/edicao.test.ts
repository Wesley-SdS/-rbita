import { beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * B1 da revisão: editar a proposta no cartão não troca o que a Órbita fixou.
 * O payload passa pelo registro de verdade (`executarChamada` → `preparar` →
 * `payloadDaProposta`), e a edição pela mesclagem de verdade.
 */

vi.mock("@orbita/db", () => ({ db: {} }));
// a validação de verdade (o schema da tool), sem carregar o catálogo inteiro
vi.mock("../connectors/execute", async () => {
  const { getTool } = await import("../tools/registry");
  return {
    validarPropostaEditada: (kind: string, p: Record<string, unknown>) => {
      if (kind === "mcp_call") return { ok: true, dados: p };
      const { risco: _r, camposFixados: _f, ...entrada } = p;
      const r = getTool(kind)!.inputSchema.safeParse(entrada);
      return r.success ? { ok: true, dados: r.data } : { ok: false, erro: `${r.error.issues[0]!.path.join(".")}: inválido` };
    },
  };
});

const { registerTools, executarChamada } = await import("../tools/registry");
const { mesclarEdicao, vistaEditavel } = await import("./edicao");

const Agir = z.object({
  acao: z.enum(["clicar", "digitar"]),
  ref: z.string().nullish(),
  texto: z.string().max(200).nullish(),
  fixado: z.object({ alvo: z.object({ ref: z.string(), nome: z.string() }).nullish(), url: z.string() }).nullish(),
});
const Enviar = z.object({ para: z.string(), texto: z.string().min(1), anexo: z.string().nullish() });
// o padrão dos domínios: campo que a Órbita preenche leva esta descrição no schema
const FIXO = "Preenchido pela Órbita. Deixe vazio.";
const Mandar = z.object({ para: z.string(), para_nome: z.string().nullish().describe(FIXO), texto: z.string().min(1) });
const Gravar = z.object({ caminho: z.string(), conteudo: z.string(), modo: z.enum(["criar", "substituir"]), diff: z.string().nullish().describe(FIXO) });

beforeAll(() => {
  registerTools([
    {
      name: "teste_agir",
      domain: "teste",
      description: "x",
      risk: "efeito_externo",
      inputSchema: Agir,
      camposEditaveis: ["texto"],
      // como o navegador_agir: o alvo sai da PÁGINA, nunca do que o modelo escreveu
      preparar: async (i: z.infer<typeof Agir>) => ({ ...i, fixado: { alvo: { ref: "ref_9", nome: "Ver mais" }, url: "https://empresa.com/x" } }),
      run: async () => "ok",
    },
    {
      name: "teste_enviar",
      domain: "teste",
      description: "x",
      risk: "efeito_externo",
      inputSchema: Enviar,
      // "a Maria" vira o número na hora de propor
      preparar: async (i: z.infer<typeof Enviar>) => ({ ...i, para: i.para === "a Maria" ? "5511988887777" : i.para }),
      run: async () => "ok",
    },
    {
      name: "teste_mandar",
      domain: "teste",
      description: "x",
      risk: "efeito_externo",
      inputSchema: Mandar,
      // o nome do resumo vem do código, nunca do modelo
      preparar: async (i: z.infer<typeof Mandar>) => ({ ...i, para_nome: "Mãe" }),
      run: async () => "ok",
    },
    {
      // como o arquivos_escrever: sensível pelo domínio, o diff é calculado no preparar
      name: "teste_gravar",
      domain: "arquivos",
      description: "x",
      risk: "efeito_externo",
      inputSchema: Gravar,
      preparar: async (i: z.infer<typeof Gravar>) => ({ ...i, diff: `+${i.conteudo}` }),
      run: async () => "ok",
    },
  ]);
});

async function proposta(kind: string, entrada: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { getTool } = await import("../tools/registry");
  let gravado: Record<string, unknown> = {};
  await executarChamada(getTool(kind)!, entrada, { userId: "u1" }, {
    enqueue: async (_d, p, resumo) => ((gravado = p as Record<string, unknown>), { proposta_enfileirada: true, aguardando_aprovacao: true, id: "a1", resumo }),
    // tool sensível só passa com a guarda; esta só repassa (a trilha não é o que se testa aqui)
    guarda: { executar: async (c) => c.run(), enfileirada: async () => undefined, recusada: async () => undefined },
  });
  return gravado;
}

describe("editar a proposta não troca o que o código fixou (B1)", () => {
  it("o cartão nem mostra o alvo fixado: só o que é editável, do payload GRAVADO", async () => {
    const gravado = await proposta("teste_agir", { acao: "clicar", ref: "ref_1", texto: "oi", fixado: { alvo: { ref: "ref_666", nome: "Pagar" }, url: "https://golpe.com" } });
    // o modelo tentou pôr o alvo dele: o preparar sobrescreveu, e a fila guardou o conferido
    expect(gravado.fixado).toEqual({ alvo: { ref: "ref_9", nome: "Ver mais" }, url: "https://empresa.com/x" });
    expect(gravado.camposFixados).toEqual(["fixado"]);
    expect(vistaEditavel("teste_agir", gravado)).toEqual({ texto: "oi" });
  });

  it("forjar fixado.alvo.ref na edição é recusado, e o que executaria continua o gravado", async () => {
    const gravado = await proposta("teste_agir", { acao: "clicar", ref: "ref_1", texto: "oi" });
    const forjado = { ...gravado, texto: "oi", fixado: { alvo: { ref: "ref_666", nome: "Pagar" }, url: "https://empresa.com/x" } };
    const r = mesclarEdicao("teste_agir", gravado, forjado);
    expect(r).toMatchObject({ ok: false, erro: expect.stringMatching(/fixado pela Órbita/) });
    // nem por um campo que a tool não deixa editar (acao), nem pelo risco
    expect(mesclarEdicao("teste_agir", gravado, { acao: "digitar" })).toMatchObject({ ok: false });
    expect(mesclarEdicao("teste_agir", gravado, { risco: "leitura" })).toMatchObject({ ok: false });
  });

  it("controle: editar o texto continua funcionando, com o alvo e o risco gravados intactos", async () => {
    const gravado = await proposta("teste_agir", { acao: "clicar", ref: "ref_1", texto: "oi" });
    // o cartão antigo mandava o objeto inteiro: o que veio igual ao gravado é aceito e ignorado
    const r = mesclarEdicao("teste_agir", gravado, { ...gravado, texto: "olá, tudo bem?" });
    expect(r).toEqual({ ok: true, payload: { ...gravado, texto: "olá, tudo bem?" } });
    expect(mesclarEdicao("teste_agir", gravado, { texto: "x".repeat(300) })).toMatchObject({ ok: false, erro: expect.stringMatching(/texto/) });
  });

  it("o destino que o preparar resolveu não se troca; o texto se troca", async () => {
    const gravado = await proposta("teste_enviar", { para: "a Maria", texto: "chego às 8h" });
    expect(gravado.para).toBe("5511988887777");
    expect(vistaEditavel("teste_enviar", gravado)).toEqual({ texto: "chego às 8h" });
    // a entrada crua do modelo ("a Maria") voltando do cartão não desfaz a resolução
    expect(mesclarEdicao("teste_enviar", gravado, { para: "a Maria", texto: "chego às 8h15" })).toMatchObject({ ok: false });
    expect(mesclarEdicao("teste_enviar", gravado, { texto: "chego às 8h15" })).toMatchObject({ ok: true, payload: { para: "5511988887777", texto: "chego às 8h15", risco: "efeito_externo" } });
  });

  it("campo FIXO que o modelo acertou com o mesmo valor do preparar continua fixado e fora do cartão (linha 11 da auditoria)", async () => {
    // o modelo "adivinhou" o nome que o código resolveria: antes, por ser igual, ficava editável
    const gravado = await proposta("teste_mandar", { para: "5511988887777", para_nome: "Mãe", texto: "oi" });
    expect(gravado.camposFixados).toEqual(expect.arrayContaining(["para_nome"]));
    expect(vistaEditavel("teste_mandar", gravado)).not.toHaveProperty("para_nome");
    expect(mesclarEdicao("teste_mandar", gravado, { para_nome: "Banco" })).toMatchObject({ ok: false });
    // e a proposta antiga, gravada antes da correção (sem a lista), também não deixa: o schema diz quem é da Órbita
    const { camposFixados: _sem, ...antiga } = gravado;
    expect(vistaEditavel("teste_mandar", antiga)).not.toHaveProperty("para_nome");
    // controle: o texto continua editável
    expect(vistaEditavel("teste_mandar", gravado)).toMatchObject({ texto: "oi" });
  });

  it("tool sensível sem camposEditaveis (o diff do arquivo, o comando): nada se edita, o diff aprovado é o que grava (M18)", async () => {
    const gravado = await proposta("teste_gravar", { caminho: "C:/x.txt", conteudo: "linha", modo: "criar" });
    expect(gravado).toMatchObject({ conteudo: "linha", diff: "+linha" });
    expect(vistaEditavel("teste_gravar", gravado)).toEqual({});
    expect(mesclarEdicao("teste_gravar", gravado, { conteudo: "outra coisa, sem diff" })).toMatchObject({ ok: false });
  });

  it("as tools reais: arquivos_escrever e terminal_executar declaram que nada se edita", async () => {
    await import("../tools/domains/arquivos");
    await import("../tools/domains/terminal");
    const { getTool } = await import("../tools/registry");
    expect(getTool("arquivos_escrever")!.camposEditaveis).toEqual([]);
    expect(getTool("terminal_executar")!.camposEditaveis).toEqual([]);
  });

  it("envio com destino resolvido pelo preparar (WhatsApp, e-mail): o destino nunca se edita, nem quando o modelo já mandou o número certo", async () => {
    await import("../tools/domains/whatsapp");
    await import("../tools/domains/google");
    await import("../tools/domains/outlook");
    const { getTool } = await import("../tools/registry");
    const gravado = { para: "5511988887777@s.whatsapp.net", para_nome: "Mãe", texto: "chego às 8h", risco: "efeito_externo" };
    expect(vistaEditavel("enviar_whatsapp", gravado)).toEqual({ texto: "chego às 8h" });
    expect(mesclarEdicao("enviar_whatsapp", gravado, { para: "5511900000000" })).toMatchObject({ ok: false });
    for (const n of ["responder_whatsapp", "enviar_audio_whatsapp"]) expect(getTool(n)!.camposEditaveis).toEqual(["texto"]);
    expect(getTool("enviar_imagem_whatsapp")!.camposEditaveis).toEqual(["legenda"]);
    for (const n of ["enviar_email", "outlook_enviar_email"]) {
      expect(vistaEditavel(n, { para: "joao@x.com", para_nome: "João", assunto: "Oi", corpo: "Tudo bem?", conta: null })).toEqual({ assunto: "Oi", corpo: "Tudo bem?" });
    }
  });

  it("na tool de servidor MCP só os argumentos se editam: servidor e tool não se trocam", () => {
    const gravado = { serverId: "s1", tool: "comentar", args: { chamado: "TCK-1", texto: "recebi" }, risco: "efeito_externo" };
    expect(vistaEditavel("mcp_call", gravado)).toEqual({ chamado: "TCK-1", texto: "recebi" });
    expect(mesclarEdicao("mcp_call", gravado, { texto: "recebi, olho hoje" })).toEqual({ ok: true, payload: { ...gravado, args: { chamado: "TCK-1", texto: "recebi, olho hoje" } } });
    expect(mesclarEdicao("mcp_call", gravado, { tool: "apagar_tudo" })).toMatchObject({ ok: false });
  });
});
