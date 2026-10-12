import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Integração com o Postgres REAL (a rede da Pluggy é simulada). Existe porque
 * o que mais quebra nesta área é SQL e transação, e os testes com banco
 * simulado não enxergam isso: um saldo calculado errado por causa de uma
 * subconsulta passou em todos eles e só apareceu aqui.
 *
 * Desligado por padrão, para a suíte comum não depender de banco. Liga com:
 *
 *   ORBITA_E2E_DB=1 node ./node_modules/vitest/vitest.mjs run packages/core/src/pluggy/integracao.test.ts
 *
 * Cada cenário cria um usuário temporário e apaga no fim (as tabelas caem por
 * cascade), então não mexe nos dados do dia a dia.
 */

const LIGADO = process.env.ORBITA_E2E_DB === "1";

/** O vitest fixa uma DATABASE_URL de teste; aqui vale a do .env, que tem a senha de verdade. */
function usarEnvDoApp() {
  for (const caminho of [resolve(process.cwd(), "apps/web/.env"), resolve(process.cwd(), "../web/.env"), resolve(process.cwd(), "../../apps/web/.env")]) {
    if (!existsSync(caminho)) continue;
    for (const linha of readFileSync(caminho, "utf-8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(linha.trim());
      if (m && ["DATABASE_URL", "BETTER_AUTH_SECRET", "CONNECTORS_ENC_KEY"].includes(m[1]!)) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
    }
    return;
  }
}

type Tx = Record<string, unknown>;

describe.skipIf(!LIGADO)("Pluggy contra o Postgres real", () => {
  let M: Awaited<ReturnType<typeof modulos>>;
  const usuarios: string[] = [];

  async function modulos() {
    const { db } = await import("@orbita/db");
    const { user } = await import("@orbita/db/auth-schema");
    const fin = await import("@orbita/db/finance-schema");
    const pl = await import("@orbita/db/pluggy-schema");
    const { notification } = await import("@orbita/db/routine-schema");
    const orm = await import("drizzle-orm");
    const store = await import("../finance/store");
    return {
      db, user, fin, pl, notification, orm, store,
      servico: await import("./servico"),
      conectores: await import("../connectors/store"),
      calendario: await import("../finance/calendario"),
      comandos: await import("../finance/comandos"),
      transferencias: await import("../finance/transferencias"),
      cartaoMotor: await import("../finance/cartao"),
    };
  }

  beforeAll(async () => {
    usarEnvDoApp();
    M = await modulos();
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    for (const id of usuarios) await M.db.delete(M.user).where(M.orm.eq(M.user.id, id));
  });

  async function novoDono(): Promise<string> {
    const userId = `e2e-pluggy-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    usuarios.push(userId);
    await M.db.insert(M.user).values({ id: userId, name: "E2E Pluggy", email: `${userId}@teste.local`, emailVerified: true });
    await M.store.garantirInicio(userId);
    await M.conectores.salvarConexaoPorToken("pluggy", userId, { clientId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", clientSecret: "segredo-bem-comprido" });
    return userId;
  }

  const lancamentos = (userId: string) => M.db.select().from(M.fin.finLancamento).where(M.orm.eq(M.fin.finLancamento.userId, userId));

  // ────────────────────────────────────────────────────────────────────────────
  it("duas contas: transferência por par, perna que chega depois, terceiro, pendente e o que o dono apagou", async () => {
    const hoje = M.store.hojeDoServidor();
    const dia = (n: number) => `${M.calendario.somarDias(hoje, -n)}T00:00:00.000Z`;
    const ITEM_A = "11111111-1111-4111-8111-111111111111";
    const ITEM_B = "22222222-2222-4222-8222-222222222222";
    const ACC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const ACC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const EU = { documentNumber: { type: "CPF", value: "33333333333" } };
    const MARIA = { name: "Maria", documentNumber: { type: "CPF", value: "11111111111" } };
    const t = (id: string, accountId: string, amount: number, d: number, description: string, extra: Tx = {}): Tx => ({
      id, accountId, amount, date: dia(d), description, currencyCode: "BRL", status: "POSTED", type: amount < 0 ? "DEBIT" : "CREDIT", ...extra,
    });
    const feed: Record<string, Tx[]> = {
      [ACC_A]: [t("a-salario", ACC_A, 3000, 5, "SALARIO EMPRESA"), t("a-pix-b", ACC_A, -500, 2, "PIX TRANSF WESLEY S"), t("a-mercado", ACC_A, -45.9, 1, "MERCADO CENTRAL", { merchant: { name: "Mercado Central" } })],
      [ACC_B]: [t("b-pix-a", ACC_B, 500, 2, "Pix recebido"), t("b-cafe", ACC_B, -20, 1, "CAFE")],
    };
    const saldoBanco: Record<string, number> = { [ACC_A]: 3454.1, [ACC_B]: 680 };
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const u = new URL(String(input));
      const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
      if (u.pathname === "/auth") return json({ apiKey: "k" });
      if (u.pathname.startsWith("/items/")) return json({ id: "x", status: "UPDATED", executionStatus: "SUCCESS", lastUpdatedAt: new Date().toISOString(), connector: { name: u.pathname.endsWith(ITEM_A) ? "Itaú" : "Nubank" } });
      if (u.pathname === "/accounts") {
        const a = u.searchParams.get("itemId") === ITEM_A;
        const id = a ? ACC_A : ACC_B;
        return json({ results: [{ id, type: "BANK", subtype: "CHECKING_ACCOUNT", name: "Conta Corrente", number: a ? "1234" : "5678", balance: saldoBanco[id], taxNumber: "333.333.333-33" }] });
      }
      if (u.pathname === "/v2/transactions") return json({ results: feed[u.searchParams.get("accountId")!] ?? [], next: null });
      return new Response("{}", { status: 404 });
    });

    const userId = await novoDono();
    const { servico, db, fin, orm, pl } = M;
    await servico.adicionarItem(userId, ITEM_A);
    await servico.adicionarItem(userId, ITEM_B);
    let visao = await servico.visaoDoBanco(userId);
    expect(visao.itens).toHaveLength(2);

    const semVinculo = await servico.sincronizarDono(userId);
    expect(semVinculo.lancadas).toBe(0);
    expect(semVinculo.avisos).toHaveLength(2);

    const pcA = visao.itens.find((i) => i.banco === "Itaú")!.contas[0]!;
    const pcB = visao.itens.find((i) => i.banco === "Nubank")!.contas[0]!;
    // B é uma conta que o dono já tinha, com o café lançado à mão
    const [contaB] = await db.insert(fin.finConta).values({ userId, nome: "Nubank manual", tipo: "corrente", saldoInicial: 20000, cor: "#123456", ordem: 9 }).returning();
    await db.insert(fin.finLancamento).values({ userId, tipo: "despesa", data: M.calendario.somarDias(hoje, -1), valor: 2000, descricao: "café", contaId: contaB!.id });
    const { contaId: contaA } = await servico.vincularConta(userId, pcA.id, { nova: true });
    await servico.vincularConta(userId, pcB.id, { contaId: contaB!.id });

    const r1 = await servico.sincronizarDono(userId);
    const todas = await lancamentos(userId);
    const transf = todas.filter((l) => l.transferencia);
    expect(todas.filter((l) => l.contaId === contaA)).toHaveLength(3);
    expect(r1).toMatchObject({ transferencias: 1, jaExistiam: 1 });
    expect(transf).toHaveLength(2);
    expect(transf[0]!.grupoTransferencia).toBe(transf[1]!.grupoTransferencia);
    expect(transf.some((l) => l.tipo === "despesa" && l.contaId === contaA)).toBe(true);
    expect(transf.some((l) => l.tipo === "receita" && l.contaId === contaB!.id)).toBe(true);

    const gasto = todas.filter((l) => l.tipo === "despesa" && !l.transferencia).reduce((s, l) => s + l.valor, 0);
    const renda = todas.filter((l) => l.tipo === "receita" && !l.transferencia).reduce((s, l) => s + l.valor, 0);
    expect({ gasto, renda }).toEqual({ gasto: 4590 + 2000, renda: 300000 });

    // o saldo que a TELA mostra bate com o do banco nas duas contas (conta nova acertada, conta antiga intocada)
    visao = await servico.visaoDoBanco(userId);
    expect(visao.itens.find((i) => i.banco === "Itaú")!.contas[0]).toMatchObject({ saldoBanco: 345410, saldoOrbita: 345410 });
    expect(visao.itens.find((i) => i.banco === "Nubank")!.contas[0]).toMatchObject({ saldoBanco: 68000, saldoOrbita: 68000 });
    expect((await db.select().from(fin.finConta).where(orm.eq(fin.finConta.id, contaB!.id)))[0]!.saldoInicial).toBe(20000);

    // ler de novo não duplica; apagado não volta
    const n = (await lancamentos(userId)).length;
    expect((await servico.sincronizarDono(userId)).lancadas).toBe(0);
    expect((await lancamentos(userId)).length).toBe(n);
    const mercado = (await lancamentos(userId)).find((l) => l.descricao === "MERCADO CENTRAL")!;
    await db.delete(fin.finLancamento).where(orm.eq(fin.finLancamento.id, mercado.id));
    await servico.sincronizarDono(userId);
    expect((await lancamentos(userId)).some((l) => l.descricao === "MERCADO CENTRAL")).toBe(false);

    // perna que chega depois: reclassifica a antiga
    feed[ACC_A]!.push(t("a-pix-b2", ACC_A, -100, 1, "PIX ENVIADO"));
    await servico.sincronizarDono(userId);
    const solta = (await lancamentos(userId)).find((l) => l.descricao === "PIX ENVIADO")!;
    expect(solta.transferencia).toBe(false);
    feed[ACC_B]!.push(t("b-pix-a2", ACC_B, 100, 1, "Pix recebido"));
    await servico.sincronizarDono(userId);
    const depois = await lancamentos(userId);
    const antiga = depois.find((l) => l.id === solta.id)!;
    const entrada = depois.find((l) => l.contaId === contaB!.id && l.valor === 10000)!;
    expect(antiga.transferencia && entrada.transferencia).toBe(true);
    expect(antiga.grupoTransferencia).toBe(entrada.grupoTransferencia);

    // terceiro identificado nunca pareia; os dois lados sendo o dono, sim; pendente nunca entra
    feed[ACC_A]!.push(t("a-pix-maria", ACC_A, -77, 0, "PIX MARIA", { paymentData: { payer: EU, receiver: MARIA } }));
    feed[ACC_B]!.push(t("b-pix-amigo", ACC_B, 77, 0, "PIX AMIGO", { paymentData: { payer: { name: "Joao", documentNumber: { type: "CPF", value: "22222222222" } }, receiver: EU } }));
    feed[ACC_A]!.push(t("a-propria", ACC_A, -30, 0, "TED MESMA TITULARIDADE", { paymentData: { payer: EU, receiver: EU } }));
    feed[ACC_A]!.push(t("a-pendente", ACC_A, -9, 0, "COMPRA PENDENTE", { status: "PENDING" }));
    await servico.sincronizarDono(userId);
    const fim = await lancamentos(userId);
    expect(fim.find((l) => l.descricao === "PIX MARIA")!.transferencia).toBe(false);
    expect(fim.find((l) => l.descricao === "PIX AMIGO")!.transferencia).toBe(false);
    expect(fim.find((l) => l.descricao === "TED MESMA TITULARIDADE")!.transferencia).toBe(true);
    expect(fim.some((l) => l.descricao === "COMPRA PENDENTE")).toBe(false);
    const [cafe] = await db.select().from(pl.pluggyTransacao).where(orm.and(orm.eq(pl.pluggyTransacao.userId, userId), orm.eq(pl.pluggyTransacao.pluggyId, "b-cafe")));
    expect(cafe?.estado).toBe("ja_existia");
  });

  // ────────────────────────────────────────────────────────────────────────────
  it("cartão, fatura, pares antigos, saldo, widget e avisos", async () => {
    const hoje = M.store.hojeDoServidor();
    const ano = hoje.slice(0, 4);
    const iso = (md: string) => `${ano}-${md}T00:00:00.000Z`;
    const ITEM = "11111111-1111-4111-8111-111111111111";
    const ACC_CC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const ACC_POUP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const ACC_CARD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const t = (id: string, accountId: string, amount: number, md: string, description: string, extra: Tx = {}): Tx => ({
      id, accountId, amount, date: iso(md), description, currencyCode: "BRL", status: "POSTED", type: amount < 0 ? "DEBIT" : "CREDIT", ...extra,
    });
    const feed: Record<string, Tx[]> = {
      [ACC_CC]: [t("cc-salario", ACC_CC, 5000, "10-02", "SALARIO"), t("cc-fatura", ACC_CC, -470, "10-14", "PAGAMENTO FATURA ITAU"), t("cc-fatura-outra", ACC_CC, -999, "10-13", "PAGAMENTO FATURA OUTRO BANCO")],
      [ACC_POUP]: [],
      // no cartão o que decide é o type (compra = DEBIT), não o sinal do valor
      [ACC_CARD]: [
        t("k1", ACC_CARD, 120, "10-03", "MERCADO LIVRE", { type: "DEBIT", creditCardMetadata: { billId: "b-out" } }),
        t("k2", ACC_CARD, 300, "09-20", "GELADEIRA 2/10", { type: "DEBIT", creditCardMetadata: { billId: "b-out", installmentNumber: 2, totalInstallments: 10 } }),
        t("k3", ACC_CARD, 80, "10-08", "COMPRA NO DIA SEGUINTE AO FECHAMENTO", { type: "DEBIT", creditCardMetadata: { billId: "b-out" } }),
        t("k4", ACC_CARD, 30, "10-04", "ESTORNO LOJA", { type: "CREDIT", creditCardMetadata: { billId: "b-out" } }),
        t("k5", ACC_CARD, 1000, "09-15", "Pagamento recebido", { type: "CREDIT" }),
      ],
    };
    let status = "UPDATED";
    let execucao = "SUCCESS";
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(String(input));
      const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
      if (u.pathname === "/auth") return json({ apiKey: "k" });
      if (u.pathname === "/connect_token") return json({ accessToken: "token-curto", recebido: JSON.parse(String(init?.body)) });
      if (u.pathname.startsWith("/items/")) return json({ id: ITEM, status, executionStatus: execucao, lastUpdatedAt: new Date().toISOString(), connector: { name: "Itaú" } });
      if (u.pathname === "/accounts") {
        return json({ results: [
          { id: ACC_CC, type: "BANK", subtype: "CHECKING_ACCOUNT", name: "Conta Corrente", number: "1234", balance: 3531, taxNumber: "333.333.333-33" },
          { id: ACC_POUP, type: "BANK", subtype: "SAVINGS_ACCOUNT", name: "Poupança", number: "5678", balance: 1500, taxNumber: "333.333.333-33" },
          { id: ACC_CARD, type: "CREDIT", subtype: "CREDIT_CARD", name: "Cartão Platinum", number: "xxxx8670", taxNumber: "333.333.333-33", creditData: { creditLimit: 5000, balanceCloseDate: `${ano}-10-07T00:00:00.000Z`, balanceDueDate: `${ano}-10-15T00:00:00.000Z` } },
        ] });
      }
      if (u.pathname === "/v2/transactions") return json({ results: feed[u.searchParams.get("accountId")!] ?? [], next: null });
      if (u.pathname === "/bills") return json({ results: [{ id: "b-out", dueDate: iso("10-15"), totalAmount: 470, billClosingDate: iso("10-07") }], totalPages: 1 });
      return new Response("{}", { status: 404 });
    });

    const userId = await novoDono();
    const { servico, db, fin, orm, pl, notification } = M;
    await servico.adicionarItem(userId, ITEM);
    let visao = await servico.visaoDoBanco(userId);
    expect(visao.widgetUrl.startsWith("https://cdn.pluggy.ai/")).toBe(true);
    const contas = visao.itens[0]!.contas;
    const cc = contas.find((c) => c.numero === "1234")!;
    const poup = contas.find((c) => c.numero === "5678")!;
    const cartaoPl = contas.find((c) => c.tipo === "CREDIT")!;
    expect(cartaoPl).toMatchObject({ limite: 500000, diaFechamento: 7, diaVencimento: 15 });

    const [pouOrbita] = await db.insert(fin.finConta).values({ userId, nome: "Poupança manual", tipo: "corrente", saldoInicial: 10000, cor: "#abcdef", ordem: 9 }).returning();
    await db.insert(fin.finLancamento).values({ userId, tipo: "receita", data: `${ano}-10-05`, valor: 25000, descricao: "depósito", contaId: pouOrbita!.id });
    const { contaId: contaCC } = await servico.vincularConta(userId, cc.id, { nova: true });
    await servico.vincularConta(userId, poup.id, { contaId: pouOrbita!.id });
    const { cartaoId } = await servico.vincularConta(userId, cartaoPl.id, { nova: true });
    const [cartao] = await db.select().from(fin.finCartao).where(orm.eq(fin.finCartao.id, cartaoId!));
    expect(cartao).toMatchObject({ fechamento: 7, vencimento: 15, limite: 500000 });

    const r1 = await servico.sincronizarDono(userId);
    const todas = await lancamentos(userId);
    const noCartao = todas.filter((l) => l.cartaoId === cartaoId);
    expect(noCartao).toHaveLength(4);
    expect(todas.some((l) => l.descricao === "Pagamento recebido")).toBe(false);
    const k2 = noCartao.find((l) => l.descricao?.startsWith("GELADEIRA"))!;
    expect([k2.parcelaN, k2.parcelaDe]).toEqual([2, 10]);
    expect(noCartao.find((l) => l.descricao === "ESTORNO LOJA")).toMatchObject({ tipo: "receita", estorno: true });
    expect(noCartao.find((l) => l.descricao?.startsWith("COMPRA NO DIA"))!.data).toBe(`${ano}-10-07`);

    const dados = await M.store.carregar(userId, hoje, 2);
    const cartaoMotor = dados.cartoes.find((c) => c.id === cartaoId)!;
    const fatura = M.cartaoMotor.faturasDoCartao(cartaoMotor, dados.lancamentos, dados.pagamentosFatura).find((f) => f.fechamento === `${ano}-10-07`)!;
    expect(fatura).toMatchObject({ total: 47000, pago: 47000, paga: true });
    const debito = todas.find((l) => l.descricao === "PAGAMENTO FATURA ITAU")!;
    const pagamentos = await db.select().from(fin.finPagamentoFatura).where(orm.eq(fin.finPagamentoFatura.userId, userId));
    expect(debito.transferencia).toBe(true);
    expect(pagamentos).toHaveLength(1);
    expect(pagamentos[0]!.lancamentoId).toBe(debito.id);
    expect(todas.find((l) => l.descricao === "PAGAMENTO FATURA OUTRO BANCO")!.transferencia).toBe(false);
    expect(r1.avisos.some((a) => a.includes("OUTRO BANCO"))).toBe(true);
    expect(r1.faturasPagas).toBe(1);

    const r2 = await servico.sincronizarDono(userId);
    expect(r2.lancadas).toBe(0);
    expect((await lancamentos(userId)).length).toBe(todas.length);
    expect(await db.select().from(fin.finPagamentoFatura).where(orm.eq(fin.finPagamentoFatura.userId, userId))).toHaveLength(1);

    // conta que já existia: mostra a diferença, o dono manda acertar, e só o saldo inicial muda
    visao = await servico.visaoDoBanco(userId);
    expect(visao.itens[0]!.contas.find((c) => c.numero === "5678")).toMatchObject({ saldoBanco: 150000, saldoOrbita: 35000 });
    await servico.acertarSaldoInicial(userId, poup.id);
    visao = await servico.visaoDoBanco(userId);
    expect(visao.itens[0]!.contas.find((c) => c.numero === "5678")!.saldoOrbita).toBe(150000);
    expect((await db.select().from(fin.finConta).where(orm.eq(fin.finConta.id, pouOrbita!.id)))[0]!.saldoInicial).toBe(125000);
    expect((await lancamentos(userId)).length).toBe(todas.length);

    // pares antigos lançados à mão: sugere, marca, desfaz, recusa o que não faz sentido
    const [conta2] = await db.insert(fin.finConta).values({ userId, nome: "Carteira manual", tipo: "corrente", saldoInicial: 0, cor: "#111111", ordem: 10 }).returning();
    const [s] = await db.insert(fin.finLancamento).values({ userId, tipo: "despesa", data: `${ano}-10-06`, valor: 77700, descricao: "TED enviada", contaId: conta2!.id }).returning();
    const [e] = await db.insert(fin.finLancamento).values({ userId, tipo: "receita", data: `${ano}-10-06`, valor: 77700, descricao: "TED recebida", contaId: contaCC! }).returning();
    expect((await M.transferencias.paresSugeridosDoDono(userId, hoje)).find((x) => x.saida.id === s!.id)?.entrada.id).toBe(e!.id);
    const marcado = await M.comandos.executar(userId, { tipo: "juntar_transferencia", pares: [{ saidaId: s!.id, entradaId: e!.id }] }, hoje);
    const [s2] = await db.select().from(fin.finLancamento).where(orm.eq(fin.finLancamento.id, s!.id));
    const [e2] = await db.select().from(fin.finLancamento).where(orm.eq(fin.finLancamento.id, e!.id));
    expect(s2!.transferencia && e2!.transferencia).toBe(true);
    expect(s2!.grupoTransferencia).toBe(e2!.grupoTransferencia);
    expect(marcado.grupos).toHaveLength(1);
    expect((await M.transferencias.paresSugeridosDoDono(userId, hoje)).some((x) => x.saida.id === s!.id)).toBe(false);
    await M.comandos.executar(userId, { tipo: "desjuntar_transferencia", grupos: marcado.grupos! }, hoje);
    const [s3] = await db.select().from(fin.finLancamento).where(orm.eq(fin.finLancamento.id, s!.id));
    expect(s3!.transferencia).toBe(false);
    expect(s3!.grupoTransferencia).toBeNull();
    await expect(M.comandos.executar(userId, { tipo: "juntar_transferencia", pares: [{ saidaId: s!.id, entradaId: s!.id }] }, hoje)).rejects.toThrow();
    const [mesmaConta] = await db.insert(fin.finLancamento).values({ userId, tipo: "receita", data: `${ano}-10-06`, valor: 77700, descricao: "na mesma conta", contaId: conta2!.id }).returning();
    await expect(M.comandos.executar(userId, { tipo: "juntar_transferencia", pares: [{ saidaId: s!.id, entradaId: mesmaConta!.id }] }, hoje)).rejects.toThrow(/duas contas diferentes/);

    // widget: o token vem do servidor; item alheio é recusado
    expect(await servico.tokenDeConexao(userId)).toEqual({ accessToken: "token-curto", itemId: null });
    const [item] = await db.select().from(pl.pluggyItem).where(orm.eq(pl.pluggyItem.userId, userId));
    expect((await servico.tokenDeConexao(userId, item!.id)).itemId).toBe(ITEM);
    await expect(servico.tokenDeConexao(userId, "00000000-0000-4000-8000-000000000000")).rejects.toThrow();

    // avisos: um por problema, e nada de aviso em "sincronizar agora"
    const avisos = (titulo: string) => db.select().from(notification).where(orm.and(orm.eq(notification.userId, userId), orm.eq(notification.title, titulo)));
    feed[ACC_CC]!.push(t("cc-novo", ACC_CC, -12.5, "10-09", "PADARIA"));
    await servico.sincronizarDono(userId, { notificar: true });
    const novidades = await avisos("Bancos sincronizados");
    expect(novidades).toHaveLength(1);
    expect(novidades[0]!.content).toMatch(/1 lançamento novo/);
    await servico.sincronizarDono(userId, { notificar: true });
    expect(await avisos("Bancos sincronizados")).toHaveLength(1);
    status = "LOGIN_ERROR";
    await servico.sincronizarDono(userId, { notificar: true });
    await servico.sincronizarDono(userId, { notificar: true });
    expect(await avisos("Itaú precisa de você")).toHaveLength(1);
    status = "UPDATED";
    await servico.sincronizarDono(userId, { notificar: true });
    status = "LOGIN_ERROR";
    await servico.sincronizarDono(userId, { notificar: true });
    expect(await avisos("Itaú precisa de você")).toHaveLength(2);
    status = "UPDATED";
    execucao = "SITE_NOT_AVAILABLE";
    await servico.sincronizarDono(userId, { notificar: true });
    expect(await avisos("Itaú precisa de você")).toHaveLength(2);
    const antes = (await db.select().from(notification).where(orm.eq(notification.userId, userId))).length;
    feed[ACC_CC]!.push(t("cc-novo2", ACC_CC, -5, "10-09", "BALA"));
    await servico.sincronizarDono(userId);
    expect((await db.select().from(notification).where(orm.eq(notification.userId, userId))).length).toBe(antes);
  });
});
