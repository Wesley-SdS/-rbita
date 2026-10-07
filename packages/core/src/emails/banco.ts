/**
 * E-mail do banco virando lançamento. Puro.
 *
 * O dono recebe "Pix recebido", "Pagamento realizado", "Compra aprovada" o
 * dia inteiro e quer isso no financeiro sem digitar. O perigo é o e-mail
 * FALSO: qualquer um escreve "Você recebeu um Pix de R$ 10.000" e, se a
 * Órbita lançasse sozinha, o saldo do painel mentiria. Por isso o lançamento
 * automático exige as três coisas juntas:
 *
 *   1. o remetente é de um domínio que o DONO marcou como banco dele;
 *   2. o e-mail veio assinado por esse domínio (DKIM `pass`, que o servidor
 *      de e-mail do próprio dono conferiu e registrou no cabeçalho);
 *   3. a leitura do valor e do sentido não deixou dúvida.
 *
 * Faltou uma, a movimentação fica pronta na tela com um botão, e quem decide
 * é o dono. A leitura é por regra, e não pelo modelo: o texto do e-mail é de
 * terceiro (§5.2) e nunca decide quanto dinheiro entra na conta.
 */

export interface Movimentacao {
  natureza: "receita" | "despesa";
  /** centavos */
  valor: number;
  /** de quem veio ou para quem foi, quando o e-mail diz */
  contraparte: string | null;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "Nubank <todomundo@nubank.com.br>" → "todomundo@nubank.com.br". */
export function enderecoDe(de: string): string {
  const entre = /<([^>]+)>/.exec(de)?.[1];
  const s = (entre ?? de).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : "";
}

export function dominioDe(endereco: string): string {
  return endereco.split("@")[1]?.toLowerCase() ?? "";
}

/** O domínio é o confiável ou um subdomínio dele ("mail.itau.com.br" vale para "itau.com.br"). */
export function mesmoDominio(dominio: string, confiavel: string): boolean {
  const d = dominio.toLowerCase().replace(/^\.+/, "");
  const c = confiavel.toLowerCase().trim().replace(/^@/, "").replace(/^\.+/, "");
  return Boolean(c) && (d === c || d.endsWith(`.${c}`));
}

export function bancoConfiavel(endereco: string, confiaveis: string[]): string | null {
  const d = dominioDe(endereco);
  if (!d) return null;
  return confiaveis.find((c) => mesmoDominio(d, c)) ?? null;
}

/**
 * O e-mail veio assinado pelo domínio do remetente? Lê o cabeçalho
 * `Authentication-Results` que o servidor de quem RECEBEU escreveu (Gmail,
 * Outlook). Vale `dkim=pass` com `header.d` (ou `header.i`) no domínio
 * confiável. Assinatura de outro domínio não conta: um golpista assina com o
 * domínio DELE, e o `pass` sairia verdadeiro.
 */
export function autenticadoPor(authResults: string, dominio: string): boolean {
  if (!authResults || !dominio) return false;
  for (const trecho of authResults.split(/;\s*/)) {
    const m = /\bdkim=(\w+)/i.exec(trecho);
    if (!m || m[1]!.toLowerCase() !== "pass") continue;
    const d = /header\.d=([^\s;]+)/i.exec(trecho)?.[1] ?? /header\.i=@?([^\s;]+)/i.exec(trecho)?.[1]?.split("@").pop();
    if (d && mesmoDominio(d, dominio)) return true;
  }
  return false;
}

/** "R$ 1.234,56" → 123456. O primeiro valor em reais do texto. */
export function valorEmCentavos(texto: string): number | null {
  const m = /R\$\s?(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})\b/.exec(texto);
  if (!m) return null;
  const reais = Number(m[1]!.replace(/\./g, ""));
  const c = reais * 100 + Number(m[2]);
  return Number.isFinite(c) && c > 0 ? c : null;
}

// o que já ACONTECEU: "fatura vence dia 10" e "agende seu Pix" são aviso, não movimentação
const RECEITA = /\b(voce recebeu|recebeu um pix|pix recebido|transferencia recebida|ted recebida|deposito recebido|credito em conta|dinheiro na conta|caiu na (sua )?conta)\b/;
const DESPESA = /\b(pagamento (realizado|efetuado|aprovado|confirmado)|compra (aprovada|realizada|no credito|no debito)|pix (enviado|realizado|efetuado)|voce (fez|enviou) um pix|transferencia (enviada|realizada|efetuada)|debito (automatico )?(realizado|efetuado)|boleto pago)\b/;
const GENERICOS = /^(R|Pix|Conta|Sua|Seu|Cr[eé]dito|D[eé]bito|Ag[eê]ncia|Hoje|Ontem)$/i;
const FUTURO = /\b(vence|vencimento|vai vencer|agend|lembrete|fatura (fechou|fechada|disponivel)|programad)/;

/**
 * A movimentação descrita no e-mail, ou null quando não há certeza. Um texto
 * que fala de receber E de pagar, ou de algo que ainda vai acontecer, não é
 * lido: errar o sentido inverte o saldo.
 */
export function lerMovimentacao(assunto: string, texto: string): Movimentacao | null {
  const tudo = `${assunto}\n${texto}`;
  const t = semAcento(tudo);
  const recebe = RECEITA.test(t);
  const paga = DESPESA.test(t);
  if (recebe === paga) return null;
  if (FUTURO.test(semAcento(assunto))) return null;
  const valor = valorEmCentavos(tudo);
  if (!valor) return null;
  const natureza = recebe ? "receita" : "despesa";
  // "de FULANO" para quem mandou, "para FULANO"/"em LOJA" para onde foi; o
  // primeiro "de" do texto costuma ser "de R$", então procura o primeiro NOME
  const padrao = natureza === "receita" ? /\b(?:de|por)\s+([A-ZÀ-Ú][\wÀ-ú'&-]*(?:\s+[A-ZÀ-Ú0-9][\wÀ-ú'&-]*){0,4})/g : /\b(?:para|em|no estabelecimento)\s+([A-ZÀ-Ú][\wÀ-ú'&-]*(?:\s+[A-ZÀ-Ú0-9][\wÀ-ú'&-]*){0,4})/g;
  const contraparte = [...texto.matchAll(padrao)].map((m) => m[1]!.trim()).find((n) => n.length >= 2 && !GENERICOS.test(n)) ?? null;
  return { natureza, valor, contraparte };
}

export function descricaoDaMovimentacao(m: Movimentacao): string {
  const base = m.natureza === "receita" ? "Recebido" : "Pago";
  return m.contraparte ? `${base} ${m.natureza === "receita" ? "de" : "para"} ${m.contraparte}` : `${base} (e-mail do banco)`;
}

/**
 * Em qual conta da Órbita lançar: a única conta, ou a que tem o nome do banco
 * ("Nubank" para "nubank.com.br", "Itaú" para "itau.com.br"). Duas candidatas,
 * ou nenhuma com várias contas: null, e o dono escolhe na tela. Lançar na
 * conta errada deixa dois saldos errados ao mesmo tempo.
 */
export function contaDoBanco<T extends { id: string; nome: string }>(contas: T[], dominio: string): T | null {
  if (contas.length === 1) return contas[0]!;
  return pelaMarca(contas, dominio);
}

/** O único item com o nome do banco do domínio ("Nubank" para "nubank.com.br"), ou null. */
function pelaMarca<T extends { nome: string }>(itens: T[], dominio: string): T | null {
  const partes = semAcento(dominio).split(".").filter((p) => p.length >= 3 && !["com", "net", "org", "mail", "email", "br", "info", "noreply", "comunicacao", "news"].includes(p));
  const casam = itens.filter((c) => partes.some((p) => semAcento(c.nome).replace(/\s+/g, "").includes(p)));
  return casam.length === 1 ? casam[0]! : null;
}

export interface Cobranca {
  direcao: "pagar" | "receber";
  /** centavos */
  valor: number;
  /** "AAAA-MM-DD" */
  vencimento: string;
  /** é fatura de cartão: o financeiro já calcula pela compra no cartão */
  fatura: boolean;
  /** "final 6093" do cartão, quando o e-mail diz */
  finalDoCartao: string | null;
  /** quem emitiu o boleto, quando o e-mail diz ("emitido por Banco Santander") */
  emissor: string | null;
}

const A_PAGAR = /\b(boleto (emitido|gerado|disponivel|registrado|a pagar)|fatura (fechou|fechada|disponivel|do (seu )?cartao|de [a-z]+)|sua fatura|conta (disponivel|chegou)|codigo de barras|linha digitavel)\b/;
const A_RECEBER = /\b(a receber|voce vai receber|recebimento (agendado|previsto)|pix agendado para voce|credito previsto)\b/;

/**
 * "Vence 09/11/2026", "vencimento em 13/10", "vencimento: 09/11". Sem ano, o
 * próximo dia com essa data a partir de hoje (uma fatura de dezembro lida em
 * janeiro é do ano seguinte). Puro.
 */
export function vencimentoDoTexto(texto: string, hoje: string): string | null {
  const m = /venc\w*\s*(?:em|:|dia|para|no dia)?\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i.exec(texto);
  if (!m) return null;
  const d = Number(m[1]);
  const mes = Number(m[2]);
  if (d < 1 || d > 31 || mes < 1 || mes > 12) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (m[3]) {
    const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${ano}-${pad(mes)}-${pad(d)}`;
  }
  const ano = Number(hoje.slice(0, 4));
  const candidato = `${ano}-${pad(mes)}-${pad(d)}`;
  // vencimento sem ano que já passou há mais de dois meses é do ano que vem
  return candidato < `${ano}-${pad(Math.max(1, Number(hoje.slice(5, 7)) - 2))}-01` ? `${ano + 1}-${pad(mes)}-${pad(d)}` : candidato;
}

/**
 * Boleto, fatura, conta: o que AINDA vai ser pago (ou recebido). Movimentação
 * que já aconteceu não é cobrança (`lerMovimentacao`), e sem valor ou sem
 * vencimento não há o que agendar.
 */
export function lerCobranca(assunto: string, texto: string, hoje: string): Cobranca | null {
  const tudo = `${assunto}\n${texto}`;
  const t = semAcento(tudo);
  if (lerMovimentacao(assunto, texto)) return null;
  const receber = A_RECEBER.test(t);
  const pagar = A_PAGAR.test(t);
  if (receber === pagar) return null;
  const valor = valorEmCentavos(tudo);
  const vencimento = vencimentoDoTexto(tudo, hoje);
  if (!valor || !vencimento) return null;
  const fatura = /\bfatura\b/.test(t);
  const finalDoCartao = /final\s*(\d{4})\b/i.exec(tudo)?.[1] ?? null;
  const emissor = /emitido (?:por|pel[oa])\s+([A-ZÀ-Ú][\wÀ-ú'&-]*(?:\s+[A-ZÀ-Ú0-9][\wÀ-ú'&-]*){0,4})/.exec(texto)?.[1]?.trim() ?? null;
  return { direcao: receber ? "receber" : "pagar", valor, vencimento, fatura, finalDoCartao, emissor };
}

/** A fatura é de um cartão já cadastrado ("final 6093" no nome do cartão, ou o único cartão do banco)? */
export function cartaoDaFatura<T extends { id: string; nome: string }>(cartoes: T[], c: Cobranca, dominio: string): T | null {
  if (!c.fatura) return null;
  if (c.finalDoCartao) {
    const porFinal = cartoes.filter((x) => x.nome.includes(c.finalDoCartao!));
    if (porFinal.length === 1) return porFinal[0]!;
  }
  // sem o final, pelo nome do banco; o "único cartão" do `contaDoBanco` não
  // vale aqui: o único cartão cadastrado pode ser de outro banco
  return pelaMarca(cartoes, dominio);
}

/**
 * A movimentação PAGA uma conta que já estava em aberto? Mesmo sentido, mesmo
 * valor e vencimento perto da data do pagamento: aí ela é dada como paga, e
 * não vira um lançamento a mais (o boleto contaria duas vezes). Mais de uma
 * candidata, nenhuma: quem decide é o dono.
 */
export function contaQueEstePagamentoQuita<T extends { id: string; direcao: "pagar" | "receber"; valor: number; vencimento: string }>(abertas: T[], m: Movimentacao, data: string, folgaDias = 10): T | null {
  const direcao = m.natureza === "despesa" ? "pagar" : "receber";
  const dias = (a: string, b: string) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000;
  const casam = abertas.filter((c) => c.direcao === direcao && c.valor === m.valor && dias(c.vencimento, data) <= folgaDias);
  return casam.length === 1 ? casam[0]! : null;
}
