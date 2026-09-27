import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@orbita/db";
import {
  finPerfil, finConta, finCartao, finCategoria, finLancamento, finCompromisso, finPagamentoFatura,
  finDivida, finDividaPagamento, finDividaRolagem, finMeta, finMetaItem, finMetaFoto, finAtalho, finRegra, finDesfazer,
  expense,
} from "@orbita/db/finance-schema";
import { mesDe, partes, type Ymd } from "./calendario";
import { faturasDoCartao } from "./cartao";
import { saldoDevedor } from "./divida";
import { propagarEdicao } from "./recorrentes";
import {
  lancamentosDoPedido, pernasDaTransferencia, lancamentoDaQuitacao, planoDePagarFatura, planoDePagarDivida,
  lancamentosDoItem, RegraFinanceiraError, type NovoLancamento,
} from "./operacoes";
import { CATEGORIA_SISTEMA, JUROS_ROTATIVO_PADRAO, categoriaDaMeta, corDaVez, itensDoModelo, MODELOS_DE_META, type ModeloDeMeta } from "./padroes";
import { categoriaDoSistema, desfazer, inserirLancamentos, registrarDesfazer, semearInicio, garantirInicio, type Tx } from "./store";
import { brl } from "./formato";
import { dividirEmParcelas } from "./parcelas";

/**
 * TODAS as ações do financeiro, como comandos. A tela manda o comando por
 * `POST /api/financas`, e as tools do chat e da voz montam o MESMO comando
 * (depois de traduzir "no Nubank" para o id do cartão). Uma porta só para
 * gravar dinheiro: se a regra de quitar mudar, ela muda para as três.
 *
 * O resultado traz a mensagem do PRD (o toast da tela e a frase que a voz
 * lê), o id para desfazer e o mês para onde a tela deve ir.
 */

const Centavos = z.number().int().min(0).max(1_000_000_000_000);
const Positivo = z.number().int().min(1).max(1_000_000_000_000);
const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");
const Id = z.string().uuid();
const Nome = (msg: string) => z.string().trim().min(1, msg).max(120);
const Texto = z.string().trim().max(2000).nullish();
const Dia = z.number().int().min(1).max(31);
const Cor = z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish();

const Lancar = z.object({
  tipo: z.literal("lancar"),
  natureza: z.enum(["despesa", "receita"]),
  valor: z.number().int().min(0).max(1_000_000_000_000),
  data: Data,
  descricao: Texto,
  categoriaId: Id.nullish(),
  contaId: Id.nullish(),
  cartaoId: Id.nullish(),
  estorno: z.boolean().optional(),
  parcelas: z.number().int().min(1).max(48).optional(),
  guardarAtalho: z.boolean().optional(),
});

const EditarLancamento = z.object({
  tipo: z.literal("editar_lancamento"),
  id: Id,
  natureza: z.enum(["despesa", "receita"]),
  valor: Positivo,
  data: Data,
  descricao: Texto,
  categoriaId: Id.nullish(),
  contaId: Id.nullish(),
  cartaoId: Id.nullish(),
  estorno: z.boolean().optional(),
});

const Transferir = z.object({
  tipo: z.literal("transferir"),
  /** presente = edição: as duas pernas antigas são refeitas */
  grupo: Id.nullish(),
  valor: z.number().int().min(0).max(1_000_000_000_000),
  data: Data,
  descricao: Texto,
  origemId: Id,
  destinoId: Id,
});

const SalvarCompromisso = z.object({
  tipo: z.literal("salvar_compromisso"),
  id: Id.nullish(),
  direcao: z.enum(["pagar", "receber"]),
  descricao: Nome("Dê um nome para a conta."),
  valor: z.number().int().min(0).max(1_000_000_000_000),
  vencimento: Data,
  categoriaId: Id.nullish(),
  contaId: Id.nullish(),
  recorrente: z.boolean(),
});

const Quitar = z.object({ tipo: z.literal("quitar"), id: Id, valor: z.number().int().min(0).max(1_000_000_000_000), data: Data, contaId: Id.nullish(), cartaoId: Id.nullish() });

const PagarFatura = z.object({
  tipo: z.literal("pagar_fatura"),
  cartaoId: Id,
  fechamento: Data.nullish(),
  valor: z.number().int().min(0).max(1_000_000_000_000),
  data: Data,
  contaId: Id.nullish(),
  resto: z.enum(["rotativo", "depois"]).default("rotativo"),
});

const SalvarDivida = z.object({
  tipo: z.literal("salvar_divida"),
  id: Id.nullish(),
  nome: Nome("Dê um nome à dívida."),
  natureza: z.enum(["emprestimo", "cartao-rotativo", "cheque-especial", "crediario", "outro"]),
  saldo: Centavos,
  jurosMes: z.number().min(0).max(100),
  parcelaMensal: Centavos,
  contaId: Id.nullish(),
});

const PagarDivida = z.object({ tipo: z.literal("pagar_divida"), id: Id, valor: z.number().int().min(0).max(1_000_000_000_000), juros: Centavos.nullish(), data: Data, contaId: Id.nullish() });

const SalvarMeta = z.object({
  tipo: z.literal("salvar_meta"),
  id: Id.nullish(),
  nome: Nome("Dê um nome à meta."),
  orcamento: Centavos,
  descricao: Texto,
  cor: Cor,
  modelo: z.enum(Object.keys(MODELOS_DE_META) as [ModeloDeMeta, ...ModeloDeMeta[]]).nullish(),
});

const SalvarItem = z.object({
  tipo: z.literal("salvar_item"),
  id: Id.nullish(),
  metaId: Id,
  nome: Nome("Dê um nome ao item."),
  valor: Centavos,
  grupo: z.string().trim().max(80).nullish(),
  status: z.enum(["planejado", "orcado", "contratado", "pago"]),
  forma: z.enum(["avista", "cartao", "boleto", "carne"]).default("avista"),
  parcelas: z.number().int().min(1).max(48).default(1),
  primeiroVenc: Data.nullish(),
  contaId: Id.nullish(),
  cartaoId: Id.nullish(),
  obs: Texto,
});

/** Foto já reduzida no navegador (900 px, JPEG); o teto aqui é defesa, não a regra. */
const Foto = z.string().regex(/^data:image\/(jpeg|png|webp);base64,/).max(2_000_000);

const SalvarAtalho = z.object({
  tipo: z.literal("salvar_atalho"),
  id: Id.nullish(),
  rotulo: Nome("Dê um nome ao atalho."),
  valor: z.number().int().min(0).max(1_000_000_000_000),
  categoriaId: Id.nullish(),
  contaId: Id.nullish(),
  cartaoId: Id.nullish(),
});

const SalvarCategoria = z.object({ tipo: z.literal("salvar_categoria"), id: Id.nullish(), nome: Nome("Dê um nome à categoria."), natureza: z.enum(["despesa", "receita"]), orcamento: Centavos, cor: Cor });
const SalvarConta = z.object({ tipo: z.literal("salvar_conta"), id: Id.nullish(), nome: Nome("Dê um nome à conta."), saldoInicial: z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000), cor: Cor });
const SalvarCartao = z.object({ tipo: z.literal("salvar_cartao"), id: Id.nullish(), nome: Nome("Dê um nome ao cartão."), limite: Centavos, fechamento: Dia, vencimento: Dia, contaPagamentoId: Id.nullish(), cor: Cor });
const SalvarRegra = z.object({ tipo: z.literal("salvar_regra"), id: Id.nullish(), contem: Nome("Escreva o texto que deve ser procurado."), categoriaId: Id });

const LinhaImportada = z.object({
  natureza: z.enum(["despesa", "receita"]),
  data: Data,
  valor: Positivo,
  descricao: z.string().trim().max(300),
  categoriaId: Id.nullish(),
  /** palavra que vira regra quando o dono pede para lembrar */
  regra: z.string().trim().max(80).nullish(),
});

export const Comando = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("definir_renda"), valor: Centavos }),
  z.object({ tipo: z.literal("definir_teto"), valor: Centavos }),
  z.object({ tipo: z.literal("boas_vindas_vistas") }),
  Lancar,
  EditarLancamento,
  z.object({ tipo: z.literal("apagar_lancamento"), id: Id }),
  z.object({ tipo: z.literal("apagar_parcelas"), grupo: Id }),
  z.object({
    tipo: z.literal("refazer_parcelas"), grupo: Id, total: Positivo, parcelas: z.number().int().min(1).max(48), primeira: Data,
    categoriaId: Id.nullish(), contaId: Id.nullish(), cartaoId: Id.nullish(), descricao: Texto,
  }),
  Transferir,
  z.object({ tipo: z.literal("apagar_transferencia"), grupo: Id }),
  z.object({ tipo: z.literal("desfazer"), id: Id.nullish() }),
  z.object({ tipo: z.literal("lancar_atalho"), id: Id }),
  SalvarAtalho,
  z.object({ tipo: z.literal("apagar_atalho"), id: Id }),
  SalvarCompromisso,
  z.object({ tipo: z.literal("apagar_compromisso"), id: Id }),
  Quitar,
  z.object({ tipo: z.literal("desquitar"), id: Id }),
  PagarFatura,
  SalvarDivida,
  z.object({ tipo: z.literal("apagar_divida"), id: Id }),
  PagarDivida,
  SalvarMeta,
  z.object({ tipo: z.literal("apagar_meta"), id: Id }),
  SalvarItem,
  z.object({ tipo: z.literal("remover_item"), id: Id }),
  z.object({ tipo: z.literal("adicionar_fotos"), itemId: Id, fotos: z.array(Foto).min(1).max(6) }),
  z.object({ tipo: z.literal("remover_foto"), id: Id }),
  SalvarCategoria,
  z.object({ tipo: z.literal("apagar_categoria"), id: Id }),
  SalvarConta,
  z.object({ tipo: z.literal("apagar_conta"), id: Id }),
  SalvarCartao,
  z.object({ tipo: z.literal("apagar_cartao"), id: Id }),
  SalvarRegra,
  z.object({ tipo: z.literal("apagar_regra"), id: Id }),
  z.object({ tipo: z.literal("lancar_varios"), itens: z.array(z.union([Lancar, Transferir])).min(1).max(100), origem: z.enum(["ditado", "chat"]).default("ditado") }),
  z.object({
    tipo: z.literal("importar"), linhas: z.array(LinhaImportada).min(1).max(5000),
    contaId: Id.nullish(), cartaoId: Id.nullish(), lembrar: z.boolean().default(true),
  }),
  z.object({ tipo: z.literal("apagar_tudo") }),
]);
export type Comando = z.infer<typeof Comando>;

export interface Resultado {
  mensagem: string;
  /** para o "desfazer" da notificação e para "desfaz" por voz */
  desfazerId?: string | null;
  /** a tela passa a mostrar este mês */
  mes?: string | null;
  /** o que foi criado (meta nova abre na hora, §7.11) */
  id?: string | null;
  /** alerta que não impede (item que passa do teto da meta) */
  aviso?: string | null;
}

// ── utilidades ─────────────────────────────────────────────────────────────

const falha = (msg: string): never => {
  throw new RegraFinanceiraError(msg);
};

async function primeiraConta(ex: Tx, userId: string): Promise<string> {
  const [c] = await ex.select({ id: finConta.id }).from(finConta).where(eq(finConta.userId, userId)).orderBy(finConta.ordem).limit(1);
  return c?.id ?? falha("Cadastre uma conta primeiro.");
}

/** Confere que cada id apontado é do dono: a validação de formato do zod não diz de quem é. */
async function conferirDono(ex: Tx, userId: string, refs: { contaId?: string | null; cartaoId?: string | null; categoriaId?: string | null }) {
  const checar = async (tabela: typeof finConta | typeof finCartao | typeof finCategoria, id: string | null | undefined, msg: string) => {
    if (!id) return;
    const [r] = await ex.select({ id: tabela.id }).from(tabela).where(and(eq(tabela.id, id), eq(tabela.userId, userId)));
    if (!r) falha(msg);
  };
  await checar(finConta, refs.contaId, "Conta não encontrada.");
  await checar(finCartao, refs.cartaoId, "Cartão não encontrado.");
  await checar(finCategoria, refs.categoriaId, "Categoria não encontrada.");
}

async function nomeDaCategoria(ex: Tx, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const [c] = await ex.select({ nome: finCategoria.nome }).from(finCategoria).where(eq(finCategoria.id, id));
  return c?.nome ?? null;
}

const contar = async (ex: Tx, tabela: typeof finLancamento, cond: ReturnType<typeof and>) =>
  Number((await ex.select({ n: sql<number>`count(*)` }).from(tabela).where(cond))[0]?.n ?? 0);

const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

// ── executor ───────────────────────────────────────────────────────────────

/**
 * Executa um comando já validado. `hoje` vem de quem chama (o servidor), não
 * do cliente: "lança o almoço" por voz às 23h59 não pode cair no dia seguinte
 * porque o celular está num fuso diferente.
 */
export async function executar(userId: string, cmd: Comando, hoje: Ymd): Promise<Resultado> {
  await garantirInicio(userId);
  if (cmd.tipo === "desfazer") {
    const r = await desfazer(userId, cmd.id);
    return { mensagem: r ? "Desfeito." : "Não há nada para desfazer." };
  }
  return db.transaction((tx) => executarNa(tx, userId, cmd, hoje));
}

async function executarNa(tx: Tx, userId: string, cmd: Exclude<Comando, { tipo: "desfazer" }>, hoje: Ymd): Promise<Resultado> {
  switch (cmd.tipo) {
    case "definir_renda":
      await tx.update(finPerfil).set({ renda: cmd.valor }).where(eq(finPerfil.userId, userId));
      return { mensagem: "Renda salva." };
    case "definir_teto":
      await tx.update(finPerfil).set({ teto: cmd.valor }).where(eq(finPerfil.userId, userId));
      return { mensagem: "Teto do mês definido." };
    case "boas_vindas_vistas":
      await tx.update(finPerfil).set({ boasVindasVistas: true }).where(eq(finPerfil.userId, userId));
      return { mensagem: "" };

    case "lancar":
      return lancar(tx, userId, cmd, hoje);

    case "editar_lancamento": {
      const [l] = await tx.select().from(finLancamento).where(and(eq(finLancamento.id, cmd.id), eq(finLancamento.userId, userId)));
      if (!l) falha("Lançamento não encontrado.");
      if (l!.metaId) {
        // ponto de atenção 3: ele seria recriado do zero ao salvar o item
        const [m] = await tx.select({ nome: finMeta.nome }).from(finMeta).where(eq(finMeta.id, l!.metaId));
        falha(`Este lançamento vem da meta ${m?.nome ?? ""}. Edite pelo item.`.replace("  ", " "));
      }
      if (l!.transferencia) falha("Isto é uma transferência. Edite pela transferência.");
      const noCartao = cmd.natureza === "despesa" && !!cmd.cartaoId;
      await conferirDono(tx, userId, { contaId: noCartao ? null : cmd.contaId, cartaoId: noCartao ? cmd.cartaoId : null, categoriaId: cmd.categoriaId });
      await tx
        .update(finLancamento)
        .set({
          tipo: cmd.natureza,
          valor: cmd.valor,
          data: cmd.data,
          descricao: cmd.descricao?.trim() || null,
          categoriaId: cmd.categoriaId ?? null,
          contaId: noCartao ? null : (cmd.contaId ?? (await primeiraConta(tx, userId))),
          cartaoId: noCartao ? cmd.cartaoId! : null,
          estorno: cmd.natureza === "receita" && !!cmd.estorno,
        })
        .where(eq(finLancamento.id, cmd.id));
      return { mensagem: "Lançamento atualizado.", mes: mesDe(cmd.data) };
    }

    case "apagar_lancamento": {
      const [l] = await tx.select().from(finLancamento).where(and(eq(finLancamento.id, cmd.id), eq(finLancamento.userId, userId)));
      if (!l) falha("Lançamento não encontrado.");
      if (l!.metaId) falha("Este lançamento vem de uma meta. Remova ou mude o item da meta.");
      await tx.delete(finLancamento).where(eq(finLancamento.id, cmd.id));
      // se ele era a quitação de uma conta, a conta volta a ficar em aberto
      if (l!.compromissoId) await tx.update(finCompromisso).set({ status: "aberto", quitadoEm: null, lancamentoId: null }).where(eq(finCompromisso.id, l!.compromissoId));
      return { mensagem: "Lançamento apagado." };
    }

    case "apagar_parcelas": {
      const apagados = await tx.delete(finLancamento).where(and(eq(finLancamento.userId, userId), eq(finLancamento.grupoParcela, cmd.grupo), sql`${finLancamento.metaId} is null`)).returning({ id: finLancamento.id });
      if (!apagados.length) falha("Não encontrei as parcelas dessa compra.");
      return { mensagem: "Parcelas apagadas." };
    }

    case "refazer_parcelas": {
      const antigas = await tx.select().from(finLancamento).where(and(eq(finLancamento.userId, userId), eq(finLancamento.grupoParcela, cmd.grupo)));
      if (!antigas.length) falha("Não encontrei as parcelas dessa compra.");
      if (antigas.some((l) => l.metaId)) falha("Essas parcelas vêm de uma meta. Edite pelo item.");
      await conferirDono(tx, userId, { contaId: cmd.contaId, cartaoId: cmd.cartaoId, categoriaId: cmd.categoriaId });
      await tx.delete(finLancamento).where(and(eq(finLancamento.userId, userId), eq(finLancamento.grupoParcela, cmd.grupo)));
      const descricao = cmd.descricao?.trim() || antigas[0]!.descricao?.replace(/\s*\(\d+\/\d+\)$/, "") || (await nomeDaCategoria(tx, cmd.categoriaId)) || "Compra";
      // refazer vale em conta ou cartão (§7.2); o grupo é o mesmo, para a tela continuar achando a compra
      const contaId = cmd.cartaoId ? null : (cmd.contaId ?? (await primeiraConta(tx, userId)));
      const novas: NovoLancamento[] = dividirEmParcelas(cmd.total, cmd.parcelas, cmd.primeira, descricao).map((x) => ({
        tipo: "despesa", data: x.data, valor: x.valor, descricao: x.descricao, categoriaId: cmd.categoriaId ?? null,
        contaId, cartaoId: cmd.cartaoId ?? null, grupoParcela: cmd.grupo, parcelaN: x.n, parcelaDe: x.de,
      }));
      await inserirLancamentos(tx, userId, novas);
      return { mensagem: `Parcelas refeitas: ${cmd.parcelas}x de ${brl(novas[novas.length - 1]!.valor)}.`, mes: mesDe(cmd.primeira) };
    }

    case "transferir":
      return transferir(tx, userId, cmd);

    case "apagar_transferencia": {
      const apagados = await tx.delete(finLancamento).where(and(eq(finLancamento.userId, userId), eq(finLancamento.grupoTransferencia, cmd.grupo))).returning({ id: finLancamento.id });
      if (!apagados.length) falha("Transferência não encontrada.");
      return { mensagem: "Transferência apagada." };
    }

    case "lancar_atalho": {
      const [a] = await tx.select().from(finAtalho).where(and(eq(finAtalho.id, cmd.id), eq(finAtalho.userId, userId)));
      if (!a) falha("Atalho não encontrado.");
      const r = await lancar(tx, userId, { tipo: "lancar", natureza: "despesa", valor: a!.valor, data: hoje, descricao: a!.rotulo, categoriaId: a!.categoriaId, contaId: a!.contaId, cartaoId: a!.cartaoId }, hoje);
      return { ...r, mensagem: `${a!.rotulo}: ${brl(a!.valor)} lançado.`, mes: mesDe(hoje) };
    }

    case "salvar_atalho": {
      if (cmd.valor <= 0) falha("Informe o valor.");
      await conferirDono(tx, userId, cmd);
      const campos = { rotulo: cmd.rotulo, valor: cmd.valor, categoriaId: cmd.categoriaId ?? null, contaId: cmd.cartaoId ? null : (cmd.contaId ?? null), cartaoId: cmd.cartaoId ?? null };
      if (cmd.id) await tx.update(finAtalho).set(campos).where(and(eq(finAtalho.id, cmd.id), eq(finAtalho.userId, userId)));
      else await tx.insert(finAtalho).values({ ...campos, userId, ordem: Date.now() % 1_000_000_000 });
      return { mensagem: "Atalho salvo." };
    }

    case "apagar_atalho":
      await tx.delete(finAtalho).where(and(eq(finAtalho.id, cmd.id), eq(finAtalho.userId, userId)));
      return { mensagem: "Atalho apagado." };

    case "salvar_compromisso":
      return salvarCompromisso(tx, userId, cmd);

    case "apagar_compromisso": {
      const apagados = await tx.delete(finCompromisso).where(and(eq(finCompromisso.id, cmd.id), eq(finCompromisso.userId, userId))).returning({ id: finCompromisso.id });
      if (!apagados.length) falha("Conta não encontrada.");
      return { mensagem: "Conta apagada." };
    }

    case "quitar": {
      if (cmd.valor <= 0) falha("Informe o valor.");
      const [c] = await tx.select().from(finCompromisso).where(and(eq(finCompromisso.id, cmd.id), eq(finCompromisso.userId, userId)));
      if (!c) falha("Conta não encontrada.");
      if (c!.status === "quitado") falha("Esta conta já foi quitada.");
      await conferirDono(tx, userId, { contaId: cmd.contaId, cartaoId: cmd.cartaoId });
      const contaId = cmd.contaId ?? c!.contaId ?? (await primeiraConta(tx, userId));
      const novo = lancamentoDaQuitacao({ id: c!.id, direcao: c!.direcao, descricao: c!.descricao, categoriaId: c!.categoriaId }, { valor: cmd.valor, data: cmd.data, contaId, cartaoId: cmd.cartaoId ?? null });
      const [id] = await inserirLancamentos(tx, userId, [novo]);
      await tx.update(finCompromisso).set({ status: "quitado", quitadoEm: cmd.data, lancamentoId: id! }).where(eq(finCompromisso.id, c!.id));
      return { mensagem: c!.direcao === "pagar" ? "Pagamento registrado." : "Recebimento registrado." };
    }

    case "desquitar": {
      // ponto de atenção 4: quitou a conta errada, volta atrás
      const [c] = await tx.select().from(finCompromisso).where(and(eq(finCompromisso.id, cmd.id), eq(finCompromisso.userId, userId)));
      if (!c) falha("Conta não encontrada.");
      if (c!.status !== "quitado") falha("Esta conta está em aberto.");
      if (c!.lancamentoId) await tx.delete(finLancamento).where(and(eq(finLancamento.id, c!.lancamentoId), eq(finLancamento.userId, userId)));
      await tx.update(finCompromisso).set({ status: "aberto", quitadoEm: null, lancamentoId: null }).where(eq(finCompromisso.id, c!.id));
      return { mensagem: "A conta voltou para em aberto." };
    }

    case "pagar_fatura":
      return pagarFatura(tx, userId, cmd);

    case "salvar_divida": {
      await conferirDono(tx, userId, { contaId: cmd.contaId });
      // editar o saldo muda o saldo INICIAL: os abatimentos já registrados continuam descontando (§7.9)
      const campos = { nome: cmd.nome, tipo: cmd.natureza, saldoInicial: cmd.saldo, jurosMes: cmd.jurosMes, parcelaMensal: cmd.parcelaMensal, contaId: cmd.contaId ?? (await primeiraConta(tx, userId)) };
      if (cmd.id) {
        const [pagos] = await tx.select({ s: sql<number>`coalesce(sum(${finDividaPagamento.abatimento}),0)` }).from(finDividaPagamento).where(eq(finDividaPagamento.dividaId, cmd.id));
        await tx.update(finDivida).set({ ...campos, saldoInicial: cmd.saldo + Number(pagos?.s ?? 0) }).where(and(eq(finDivida.id, cmd.id), eq(finDivida.userId, userId)));
      } else await tx.insert(finDivida).values({ ...campos, userId });
      return { mensagem: "Dívida salva." };
    }

    case "apagar_divida":
      await tx.delete(finDivida).where(and(eq(finDivida.id, cmd.id), eq(finDivida.userId, userId)));
      return { mensagem: "Dívida apagada." };

    case "pagar_divida": {
      const [d] = await tx.select().from(finDivida).where(and(eq(finDivida.id, cmd.id), eq(finDivida.userId, userId)));
      if (!d) falha("Dívida não encontrada.");
      await conferirDono(tx, userId, { contaId: cmd.contaId });
      const pagamentos = await tx.select().from(finDividaPagamento).where(eq(finDividaPagamento.dividaId, d!.id));
      const saldo = saldoDevedor({ ...d!, pagamentos });
      if (saldo <= 0) falha("Esta dívida já está quitada.");
      const plano = planoDePagarDivida({
        dividaNome: d!.nome, saldo, jurosMesPct: d!.jurosMes, valor: cmd.valor, juros: cmd.juros, data: cmd.data,
        contaId: cmd.contaId ?? d!.contaId ?? (await primeiraConta(tx, userId)),
        categoriaDividasId: await categoriaDoSistema(tx, userId, CATEGORIA_SISTEMA.dividas),
      });
      const [lid] = await inserirLancamentos(tx, userId, [plano.lancamento]);
      await tx.insert(finDividaPagamento).values({ userId, dividaId: d!.id, data: cmd.data, valor: cmd.valor, juros: plano.juros, abatimento: plano.abatimento, lancamentoId: lid! });
      return { mensagem: "Pagamento registrado.", desfazerId: null };
    }

    case "salvar_meta": {
      const campos = { nome: cmd.nome, orcamento: cmd.orcamento, descricao: cmd.descricao?.trim() || null };
      if (cmd.id) {
        const [antes] = await tx.select().from(finMeta).where(and(eq(finMeta.id, cmd.id), eq(finMeta.userId, userId)));
        if (!antes) falha("Meta não encontrada.");
        await tx.update(finMeta).set({ ...campos, ...(cmd.cor ? { cor: cmd.cor } : {}) }).where(eq(finMeta.id, cmd.id));
        // renomear a meta renomeia a categoria "Projeto · X" que os lançamentos dela usam
        if (antes!.nome !== cmd.nome) {
          await tx.update(finCategoria).set({ nome: categoriaDaMeta(cmd.nome).nome }).where(and(eq(finCategoria.userId, userId), eq(finCategoria.nome, categoriaDaMeta(antes!.nome).nome), eq(finCategoria.tipo, "despesa")));
        }
        return { mensagem: "Meta salva.", id: cmd.id };
      }
      const usadas = (await tx.select({ id: finMeta.id }).from(finMeta).where(eq(finMeta.userId, userId))).length;
      const [m] = await tx.insert(finMeta).values({ ...campos, userId, cor: cmd.cor ?? corDaVez(usadas) }).returning({ id: finMeta.id });
      if (cmd.modelo) {
        const contaId = await primeiraConta(tx, userId);
        await tx.insert(finMetaItem).values(itensDoModelo(cmd.modelo).map((it, i) => ({ userId, metaId: m!.id, grupo: it.grupo, nome: it.nome, contaId, primeiroVenc: hoje, ordem: i })));
      }
      return { mensagem: "Meta salva.", id: m!.id };
    }

    case "apagar_meta": {
      const [m] = await tx.select().from(finMeta).where(and(eq(finMeta.id, cmd.id), eq(finMeta.userId, userId)));
      if (!m) falha("Meta não encontrada.");
      await tx.delete(finLancamento).where(and(eq(finLancamento.userId, userId), eq(finLancamento.metaId, cmd.id)));
      await tx.delete(finMeta).where(eq(finMeta.id, cmd.id));
      return { mensagem: "Meta apagada." };
    }

    case "salvar_item":
      return salvarItem(tx, userId, cmd, hoje);

    case "remover_item": {
      const [it] = await tx.select().from(finMetaItem).where(and(eq(finMetaItem.id, cmd.id), eq(finMetaItem.userId, userId)));
      if (!it) falha("Item não encontrado.");
      await tx.delete(finLancamento).where(and(eq(finLancamento.userId, userId), eq(finLancamento.metaItemId, cmd.id)));
      await tx.delete(finMetaItem).where(eq(finMetaItem.id, cmd.id));
      return { mensagem: "Item removido." };
    }

    case "adicionar_fotos": {
      const [it] = await tx.select({ id: finMetaItem.id }).from(finMetaItem).where(and(eq(finMetaItem.id, cmd.itemId), eq(finMetaItem.userId, userId)));
      if (!it) falha("Item não encontrado.");
      await tx.insert(finMetaFoto).values(cmd.fotos.map((dado) => ({ userId, itemId: cmd.itemId, dado, bytes: Math.round((dado.length * 3) / 4) })));
      const n = cmd.fotos.length;
      return { mensagem: `${n} ${plural(n, "foto", "fotos")} neste item.` };
    }

    case "remover_foto":
      await tx.delete(finMetaFoto).where(and(eq(finMetaFoto.id, cmd.id), eq(finMetaFoto.userId, userId)));
      return { mensagem: "Foto removida." };

    case "salvar_categoria": {
      const campos = { nome: cmd.nome, orcamento: cmd.orcamento, ...(cmd.cor ? { cor: cmd.cor } : {}) };
      // o tipo não muda depois de criada (§7.13): trocaria o sentido de todo lançamento dela
      if (cmd.id) await tx.update(finCategoria).set(campos).where(and(eq(finCategoria.id, cmd.id), eq(finCategoria.userId, userId)));
      else {
        const usadas = (await tx.select({ id: finCategoria.id }).from(finCategoria).where(eq(finCategoria.userId, userId))).length;
        await tx.insert(finCategoria).values({ userId, nome: cmd.nome, tipo: cmd.natureza, orcamento: cmd.orcamento, cor: cmd.cor ?? corDaVez(usadas), ordem: usadas });
      }
      return { mensagem: "Categoria salva." };
    }

    case "apagar_categoria": {
      const n = await contar(tx, finLancamento, and(eq(finLancamento.userId, userId), eq(finLancamento.categoriaId, cmd.id)));
      if (n) falha(`Esta categoria tem ${n} ${plural(n, "lançamento", "lançamentos")}. Renomeie em vez de apagar.`);
      await tx.delete(finCategoria).where(and(eq(finCategoria.id, cmd.id), eq(finCategoria.userId, userId)));
      await tx.delete(finRegra).where(and(eq(finRegra.userId, userId), eq(finRegra.categoriaId, cmd.id)));
      return { mensagem: "Categoria apagada." };
    }

    case "salvar_conta": {
      if (cmd.id) await tx.update(finConta).set({ nome: cmd.nome, saldoInicial: cmd.saldoInicial, ...(cmd.cor ? { cor: cmd.cor } : {}) }).where(and(eq(finConta.id, cmd.id), eq(finConta.userId, userId)));
      else {
        const usadas = (await tx.select({ id: finConta.id }).from(finConta).where(eq(finConta.userId, userId))).length;
        await tx.insert(finConta).values({ userId, nome: cmd.nome, saldoInicial: cmd.saldoInicial, cor: cmd.cor ?? corDaVez(usadas + 3), ordem: usadas });
      }
      return { mensagem: "Conta salva." };
    }

    case "apagar_conta": {
      const contas = await tx.select({ id: finConta.id }).from(finConta).where(eq(finConta.userId, userId));
      if (!contas.some((c) => c.id === cmd.id)) falha("Conta não encontrada.");
      if (contas.length <= 1) falha("Você precisa de pelo menos uma conta.");
      const n = await contar(tx, finLancamento, and(eq(finLancamento.userId, userId), eq(finLancamento.contaId, cmd.id)));
      if (n) falha(`Esta conta tem ${n} ${plural(n, "lançamento", "lançamentos")} e não pode ser apagada.`);
      // ponto de atenção 5: conta, atalho e cartão apontando para ela ficariam órfãos
      const [ligadas] = await tx.select({ n: sql<number>`count(*)` }).from(finCompromisso).where(and(eq(finCompromisso.userId, userId), eq(finCompromisso.contaId, cmd.id), eq(finCompromisso.status, "aberto")));
      const [cartoes] = await tx.select({ n: sql<number>`count(*)` }).from(finCartao).where(and(eq(finCartao.userId, userId), eq(finCartao.contaPagamentoId, cmd.id)));
      if (Number(ligadas?.n) || Number(cartoes?.n)) falha("Há contas a pagar ou cartões ligados a esta conta. Mude-os para outra conta antes de apagar.");
      await tx.update(finAtalho).set({ contaId: contas.find((c) => c.id !== cmd.id)!.id }).where(and(eq(finAtalho.userId, userId), eq(finAtalho.contaId, cmd.id)));
      await tx.delete(finConta).where(eq(finConta.id, cmd.id));
      return { mensagem: "Conta apagada." };
    }

    case "salvar_cartao": {
      await conferirDono(tx, userId, { contaId: cmd.contaPagamentoId });
      const campos = { nome: cmd.nome, limite: cmd.limite, fechamento: cmd.fechamento, vencimento: cmd.vencimento, contaPagamentoId: cmd.contaPagamentoId ?? (await primeiraConta(tx, userId)) };
      if (cmd.id) await tx.update(finCartao).set({ ...campos, ...(cmd.cor ? { cor: cmd.cor } : {}) }).where(and(eq(finCartao.id, cmd.id), eq(finCartao.userId, userId)));
      else {
        const usadas = (await tx.select({ id: finCartao.id }).from(finCartao).where(eq(finCartao.userId, userId))).length;
        await tx.insert(finCartao).values({ ...campos, userId, cor: cmd.cor ?? corDaVez(usadas + 4), ordem: usadas });
      }
      return { mensagem: "Cartão salvo." };
    }

    case "apagar_cartao": {
      const n = await contar(tx, finLancamento, and(eq(finLancamento.userId, userId), eq(finLancamento.cartaoId, cmd.id)));
      if (n) falha(`Este cartão tem ${n} ${plural(n, "compra", "compras")} e não pode ser apagado.`);
      await tx.delete(finCartao).where(and(eq(finCartao.id, cmd.id), eq(finCartao.userId, userId)));
      await tx.delete(finAtalho).where(and(eq(finAtalho.userId, userId), eq(finAtalho.cartaoId, cmd.id)));
      return { mensagem: "Cartão apagado." };
    }

    case "salvar_regra": {
      await conferirDono(tx, userId, { categoriaId: cmd.categoriaId });
      if (cmd.id) await tx.update(finRegra).set({ contem: cmd.contem, categoriaId: cmd.categoriaId }).where(and(eq(finRegra.id, cmd.id), eq(finRegra.userId, userId)));
      else await tx.insert(finRegra).values({ userId, contem: cmd.contem, categoriaId: cmd.categoriaId, ordem: Date.now() % 1_000_000_000 });
      return { mensagem: "Regra salva." };
    }

    case "apagar_regra":
      await tx.delete(finRegra).where(and(eq(finRegra.id, cmd.id), eq(finRegra.userId, userId)));
      return { mensagem: "Regra apagada." };

    case "lancar_varios": {
      const ids: string[] = [];
      let n = 0;
      for (const item of cmd.itens) {
        if (item.tipo === "transferir") {
          // transferência com origem igual a destino é pulada, não derruba o resto (§8.1.4)
          if (item.origemId === item.destinoId || item.valor <= 0) continue;
          const r = await transferir(tx, userId, item, false);
          ids.push(...(r.ids ?? []));
        } else {
          if (item.valor <= 0) continue;
          const r = await lancar(tx, userId, item, hoje, false);
          ids.push(...(r.ids ?? []));
        }
        n++;
      }
      if (!n) falha("Nada para lançar.");
      const texto = `${n} ${plural(n, "lançamento registrado", "lançamentos registrados")}${cmd.origem === "ditado" ? " pelo ditado" : ""}.`;
      return { mensagem: texto, desfazerId: await registrarDesfazer(tx, userId, texto, ids) };
    }

    case "importar":
      return importar(tx, userId, cmd);

    case "apagar_tudo": {
      // a tabela antiga vai junto: senão o financeiro antigo voltaria na próxima abertura
      const tabelas = [finLancamento, finCompromisso, finPagamentoFatura, finDivida, finMeta, finAtalho, finRegra, finDesfazer, finCartao, finConta, finCategoria, finPerfil, expense] as const;
      for (const t of tabelas) await tx.delete(t).where(eq(t.userId, userId));
      await semearInicio(tx, userId, false);
      return { mensagem: "Tudo apagado." };
    }
  }
}

// ── ações com mais de um passo ─────────────────────────────────────────────

type ResultadoComIds = Resultado & { ids?: string[] };

async function lancar(tx: Tx, userId: string, cmd: z.infer<typeof Lancar>, hoje: Ymd, desfazivel = true): Promise<ResultadoComIds> {
  if (cmd.valor <= 0) falha("Informe um valor maior que zero.");
  const noCartao = cmd.natureza === "despesa" && !!cmd.cartaoId;
  await conferirDono(tx, userId, { contaId: noCartao ? null : cmd.contaId, cartaoId: noCartao ? cmd.cartaoId : null, categoriaId: cmd.categoriaId });
  const contaId = noCartao ? null : (cmd.contaId ?? (await primeiraConta(tx, userId)));
  const novos = lancamentosDoPedido(
    { tipo: cmd.natureza, valor: cmd.valor, data: cmd.data || hoje, descricao: cmd.descricao, categoriaId: cmd.categoriaId ?? null, categoriaNome: await nomeDaCategoria(tx, cmd.categoriaId), contaId, cartaoId: noCartao ? cmd.cartaoId : null, estorno: cmd.estorno, parcelas: cmd.parcelas },
    () => crypto.randomUUID(),
  );
  const ids = await inserirLancamentos(tx, userId, novos);
  if (cmd.guardarAtalho && cmd.natureza === "despesa" && novos.length === 1) {
    await tx.insert(finAtalho).values({ userId, rotulo: cmd.descricao?.trim() || (await nomeDaCategoria(tx, cmd.categoriaId)) || "Atalho", valor: cmd.valor, categoriaId: cmd.categoriaId ?? null, contaId, cartaoId: noCartao ? cmd.cartaoId! : null, ordem: Date.now() % 1_000_000_000 });
  }
  const ultima = novos[novos.length - 1]!;
  const mensagem = novos.length > 1
    ? `${novos.length}x de ${brl(ultima.valor)} lançadas.`
    : `${cmd.natureza === "despesa" ? "Saída" : "Entrada"} de ${brl(cmd.valor)} registrada.`;
  const desfazerId = desfazivel ? await registrarDesfazer(tx, userId, mensagem, ids) : null;
  return { mensagem, desfazerId, mes: mesDe(novos[0]!.data), id: ids[0] ?? null, ids };
}

async function transferir(tx: Tx, userId: string, cmd: z.infer<typeof Transferir>, desfazivel = true): Promise<ResultadoComIds> {
  await conferirDono(tx, userId, { contaId: cmd.origemId });
  await conferirDono(tx, userId, { contaId: cmd.destinoId });
  if (cmd.grupo) await tx.delete(finLancamento).where(and(eq(finLancamento.userId, userId), eq(finLancamento.grupoTransferencia, cmd.grupo)));
  const pernas = pernasDaTransferencia({
    valor: cmd.valor, data: cmd.data, descricao: cmd.descricao, origemId: cmd.origemId, destinoId: cmd.destinoId,
    categoriaSaidaId: await categoriaDoSistema(tx, userId, CATEGORIA_SISTEMA.transferenciaSaida),
    categoriaEntradaId: await categoriaDoSistema(tx, userId, CATEGORIA_SISTEMA.transferenciaEntrada),
    grupo: cmd.grupo ?? crypto.randomUUID(),
  });
  const ids = await inserirLancamentos(tx, userId, pernas);
  const mensagem = "Transferência registrada.";
  return { mensagem, desfazerId: desfazivel && !cmd.grupo ? await registrarDesfazer(tx, userId, mensagem, ids) : null, mes: mesDe(cmd.data), ids };
}

async function salvarCompromisso(tx: Tx, userId: string, cmd: z.infer<typeof SalvarCompromisso>): Promise<Resultado> {
  if (cmd.valor <= 0) falha("Informe o valor.");
  await conferirDono(tx, userId, { contaId: cmd.contaId, categoriaId: cmd.categoriaId });
  const diaMes = partes(cmd.vencimento).d;
  const campos = {
    direcao: cmd.direcao, descricao: cmd.descricao, valor: cmd.valor, vencimento: cmd.vencimento, categoriaId: cmd.categoriaId ?? null,
    recorrencia: cmd.recorrente ? ("mensal" as const) : ("nenhuma" as const), diaMes,
  };
  if (!cmd.id) {
    const id = crypto.randomUUID();
    await tx.insert(finCompromisso).values({ ...campos, id, userId, contaId: cmd.contaId ?? (await primeiraConta(tx, userId)), serieId: cmd.recorrente ? id : null });
    return { mensagem: "Conta salva.", id };
  }
  const [antes] = await tx.select().from(finCompromisso).where(and(eq(finCompromisso.id, cmd.id), eq(finCompromisso.userId, userId)));
  if (!antes) falha("Conta não encontrada.");
  const serieId = cmd.recorrente ? (antes!.serieId ?? antes!.id) : antes!.serieId;
  const contaId = cmd.contaId ?? antes!.contaId;
  await tx.update(finCompromisso).set({ ...campos, contaId, serieId }).where(eq(finCompromisso.id, cmd.id));
  if (cmd.recorrente && serieId) {
    // §4.5: a edição vale para as próximas em aberto da série, não para a história
    const serie = await tx.select().from(finCompromisso).where(and(eq(finCompromisso.userId, userId), eq(finCompromisso.serieId, serieId)));
    const editada = { ...antes!, ...campos, serieId };
    const mudadas = propagarEdicao(serie, editada, { descricao: cmd.descricao, valor: cmd.valor, categoriaId: campos.categoriaId, contaId, diaMes });
    for (const m of mudadas) {
      await tx.update(finCompromisso).set({ descricao: m.descricao, valor: m.valor, categoriaId: m.categoriaId ?? null, contaId: m.contaId ?? null, diaMes: m.diaMes ?? null, vencimento: m.vencimento }).where(eq(finCompromisso.id, m.id));
    }
  }
  return { mensagem: "Conta salva.", id: cmd.id };
}

async function pagarFatura(tx: Tx, userId: string, cmd: z.infer<typeof PagarFatura>): Promise<Resultado> {
  const [cartao] = await tx.select().from(finCartao).where(and(eq(finCartao.id, cmd.cartaoId), eq(finCartao.userId, userId)));
  if (!cartao) falha("Cartão não encontrado.");
  await conferirDono(tx, userId, { contaId: cmd.contaId });
  const compras = await tx.select().from(finLancamento).where(and(eq(finLancamento.userId, userId), eq(finLancamento.cartaoId, cmd.cartaoId)));
  const pagos = await tx.select().from(finPagamentoFatura).where(and(eq(finPagamentoFatura.userId, userId), eq(finPagamentoFatura.cartaoId, cmd.cartaoId)));
  const abertas = faturasDoCartao(cartao!, compras, pagos).filter((f) => !f.paga);
  if (!abertas.length) falha("Nenhuma fatura em aberto neste cartão.");
  // sem fatura escolhida (pedido por voz), a mais antiga, que é a que a tela seleciona
  const fatura = cmd.fechamento ? abertas.find((f) => f.fechamento === cmd.fechamento) : abertas[0];
  if (!fatura) falha("Escolha a fatura.");
  const contaId = cmd.contaId ?? cartao!.contaPagamentoId ?? (await primeiraConta(tx, userId));
  const plano = planoDePagarFatura({
    cartaoNome: cartao!.nome, fechamento: fatura!.fechamento, restante: fatura!.restante, valor: cmd.valor, data: cmd.data, contaId,
    categoriaFaturaId: await categoriaDoSistema(tx, userId, CATEGORIA_SISTEMA.fatura), resto: cmd.resto,
  });
  const [lid] = await inserirLancamentos(tx, userId, [plano.lancamento]);
  await tx.insert(finPagamentoFatura).values({ userId, cartaoId: cartao!.id, fechamento: fatura!.fechamento, valor: plano.pagamento, data: cmd.data, lancamentoId: lid! });
  if (plano.rolado > 0) {
    let [rot] = await tx.select().from(finDivida).where(and(eq(finDivida.userId, userId), eq(finDivida.cartaoId, cartao!.id), eq(finDivida.tipo, "cartao-rotativo")));
    if (!rot) {
      [rot] = await tx.insert(finDivida).values({ userId, nome: `Rotativo ${cartao!.nome}`, tipo: "cartao-rotativo", saldoInicial: 0, jurosMes: JUROS_ROTATIVO_PADRAO, parcelaMensal: 0, contaId, cartaoId: cartao!.id }).returning();
    }
    await tx.update(finDivida).set({ saldoInicial: rot!.saldoInicial + plano.rolado }).where(eq(finDivida.id, rot!.id));
    await tx.insert(finDividaRolagem).values({ userId, dividaId: rot!.id, data: cmd.data, valor: plano.rolado, fechamento: fatura!.fechamento });
    await tx.insert(finPagamentoFatura).values({ userId, cartaoId: cartao!.id, fechamento: fatura!.fechamento, valor: plano.rolado, data: cmd.data, rolado: true });
    return { mensagem: `${brl(plano.rolado)} foram para o rotativo. Confira os juros em Contas, aba Dívidas.` };
  }
  if (plano.emAberto > 0) return { mensagem: `Pagamento parcial registrado. Faltam ${brl(plano.emAberto)} nesta fatura.` };
  return { mensagem: "Fatura quitada." };
}

async function salvarItem(tx: Tx, userId: string, cmd: z.infer<typeof SalvarItem>, hoje: Ymd): Promise<Resultado> {
  const [meta] = await tx.select().from(finMeta).where(and(eq(finMeta.id, cmd.metaId), eq(finMeta.userId, userId)));
  if (!meta) falha("Meta não encontrada.");
  await conferirDono(tx, userId, { contaId: cmd.contaId, cartaoId: cmd.cartaoId });
  const campos = {
    nome: cmd.nome, valor: cmd.valor, grupo: cmd.grupo?.trim() || "Sem grupo", status: cmd.status, forma: cmd.forma, parcelas: cmd.parcelas,
    primeiroVenc: cmd.primeiroVenc ?? hoje, contaId: cmd.contaId ?? null, cartaoId: cmd.forma === "cartao" ? (cmd.cartaoId ?? null) : null, obs: cmd.obs?.trim() || null,
  };
  let id = cmd.id ?? null;
  if (id) {
    const r = await tx.update(finMetaItem).set(campos).where(and(eq(finMetaItem.id, id), eq(finMetaItem.userId, userId), eq(finMetaItem.metaId, cmd.metaId))).returning({ id: finMetaItem.id });
    if (!r.length) falha("Item não encontrado.");
  } else {
    const n = (await tx.select({ id: finMetaItem.id }).from(finMetaItem).where(eq(finMetaItem.metaId, cmd.metaId))).length;
    [{ id }] = (await tx.insert(finMetaItem).values({ ...campos, userId, metaId: cmd.metaId, ordem: n }).returning({ id: finMetaItem.id })) as [{ id: string }];
  }
  // §6.5.4: os lançamentos do item são refeitos do zero a cada salvar
  await tx.delete(finLancamento).where(and(eq(finLancamento.userId, userId), eq(finLancamento.metaItemId, id!)));
  const categoriaId = cmd.status === "contratado" || cmd.status === "pago" ? await categoriaDoSistema(tx, userId, categoriaDaMeta(meta!.nome)) : null;
  const novos = lancamentosDoItem({ id: id!, ...campos }, { metaId: meta!.id, categoriaId, contaPadraoId: await primeiraConta(tx, userId), hoje, grupo: () => crypto.randomUUID() });
  await inserirLancamentos(tx, userId, novos);

  let aviso: string | null = null;
  if (meta!.orcamento > 0) {
    const [soma] = await tx.select({ s: sql<number>`coalesce(sum(${finMetaItem.valor}),0)` }).from(finMetaItem).where(eq(finMetaItem.metaId, meta!.id));
    const passou = Number(soma?.s ?? 0) - meta!.orcamento;
    if (passou > 0) aviso = `Com este item a meta passa ${brl(passou)} do teto de ${brl(meta!.orcamento)}.`;
  }
  return { mensagem: cmd.id ? "Item salvo." : "Item adicionado.", id, aviso };
}

async function importar(tx: Tx, userId: string, cmd: Extract<Comando, { tipo: "importar" }>): Promise<Resultado> {
  await conferirDono(tx, userId, { contaId: cmd.contaId, cartaoId: cmd.cartaoId });
  const contaId = cmd.cartaoId ? null : (cmd.contaId ?? (await primeiraConta(tx, userId)));
  const categorias = new Set((await tx.select({ id: finCategoria.id }).from(finCategoria).where(eq(finCategoria.userId, userId))).map((c) => c.id));
  const novos: NovoLancamento[] = cmd.linhas.map((l) => ({
    tipo: l.natureza, data: l.data, valor: l.valor, descricao: l.descricao || "Lançamento importado",
    categoriaId: l.categoriaId && categorias.has(l.categoriaId) ? l.categoriaId : null,
    contaId, cartaoId: cmd.cartaoId ?? null, importado: true,
  }));
  const ids = await inserirLancamentos(tx, userId, novos);
  if (cmd.lembrar) {
    const existentes = new Set((await tx.select({ contem: finRegra.contem }).from(finRegra).where(eq(finRegra.userId, userId))).map((r) => r.contem.toLowerCase()));
    for (const l of cmd.linhas) {
      const palavra = l.regra?.trim();
      if (!palavra || !l.categoriaId || !categorias.has(l.categoriaId) || existentes.has(palavra.toLowerCase())) continue;
      existentes.add(palavra.toLowerCase());
      await tx.insert(finRegra).values({ userId, contem: palavra, categoriaId: l.categoriaId, ordem: Date.now() % 1_000_000_000 });
    }
  }
  const n = ids.length;
  const mensagem = `${n} ${plural(n, "lançamento importado", "lançamentos importados")}.`;
  return { mensagem, desfazerId: await registrarDesfazer(tx, userId, mensagem, ids) };
}
