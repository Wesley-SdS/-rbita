/**
 * Contatos da agenda do Google, parte PURA: normalizar telefone, casar nome,
 * achar aniversário. Sem rede e sem banco, para ser testada inteira.
 */

export interface ContatoAgenda {
  nome: string;
  apelidos: string[];
  emails: string[];
  telefones: string[];
  /** mês e dia sempre; ano só quando a pessoa cadastrou */
  aniversario: { dia: number; mes: number; ano?: number } | null;
  empresa: string | null;
  /** rótulo da conta do Google de onde veio ("wesley@gmail.com") */
  conta?: string;
}

/** minúsculas, sem acento, sem pontuação */
export function normalizarNome(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * "(11) 99999-8888", "+55 11 99999-8888", "011 99999-8888" → "5511999998888".
 * Sem DDD não há como saber de onde é o número: devolve null em vez de chutar
 * São Paulo e mandar mensagem para um desconhecido.
 */
export function normalizarTelefone(bruto: string): string | null {
  let d = bruto.replace(/\D/g, "");
  if (!d) return null;
  // com "+" o número já traz o país: "+1 415…" tem 11 dígitos e não é daqui
  if (bruto.trim().startsWith("+")) return d.length >= 8 && d.length <= 15 ? d : null;
  // "0" na frente é o prefixo de operadora/interurbano ("011", "0xx21")
  d = d.replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) return "55" + d;
  if (d.length >= 12 && d.length <= 15) return d;
  return null;
}

/**
 * A chave que casa o MESMO celular brasileiro com e sem o nono dígito.
 *
 * O WhatsApp guarda contas antigas sem o 9 ("551188887777@s.whatsapp.net"),
 * e a agenda do dono tem o número de hoje ("5511988887777"). Comparando só DDD
 * e os oito últimos dígitos, os dois viram a mesma pessoa. Número de fora do
 * Brasil é comparado inteiro.
 */
export function chaveDoTelefone(numero: string): string {
  const d = numero.replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return d.slice(0, 4) + d.slice(-8);
  return d;
}

/**
 * Quem é "a Maria"? Apelido exato vence; depois nome exato; depois quem tem a
 * palavra no nome; por último, quem CONTÉM o termo. Mais de um volta como
 * lista e quem chama pergunta: mandar para a Maria errada não se desfaz.
 *
 * `soForte` corta o último nível, e é o que ENVIO usa: "Ana" contida em
 * "Juliana" é palpite, bom para uma busca que o dono lê, péssimo para decidir
 * sozinho para quem vai a mensagem.
 */
export function buscarNaAgenda<T extends Pick<ContatoAgenda, "nome" | "apelidos">>(contatos: readonly T[], termo: string, opts: { soForte?: boolean } = {}): T[] {
  const t = normalizarNome(termo).replace(/^(a|o|pra|para|com)\s+/, "");
  if (!t) return [];
  const apelido = contatos.filter((c) => c.apelidos.some((a) => normalizarNome(a) === t));
  if (apelido.length) return apelido;
  const exato = contatos.filter((c) => normalizarNome(c.nome) === t);
  if (exato.length) return exato;
  const palavras = t.split(" ");
  const porPalavra = contatos.filter((c) => {
    const nome = normalizarNome(c.nome).split(" ");
    return palavras.every((p) => nome.includes(p));
  });
  if (porPalavra.length || opts.soForte) return porPalavra;
  return t.length >= 3 ? contatos.filter((c) => normalizarNome(c.nome).includes(t)) : [];
}

/** O contato da agenda dono deste telefone (ou JID do WhatsApp), se houver um só. */
export function contatoPorTelefone<T extends Pick<ContatoAgenda, "telefones">>(contatos: readonly T[], numeroOuJid: string): T | null {
  const alvo = chaveDoTelefone(numeroOuJid.split("@")[0]);
  if (alvo.length < 8) return null;
  const achados = contatos.filter((c) => c.telefones.some((t) => chaveDe(t) === alvo));
  return achados.length === 1 ? achados[0] : null;
}

export interface Aniversariante {
  nome: string;
  dia: number;
  mes: number;
  /** 0 = hoje */
  emDias: number;
  /** idade que faz, quando o ano é conhecido */
  idade: number | null;
}

/**
 * Quem faz aniversário de hoje até `dias` à frente, do mais próximo ao mais
 * longe. `hoje` é a data LOCAL da casa ("YYYY-MM-DD"), não o relógio do
 * servidor: às 22h de Brasília o UTC já está no dia seguinte.
 */
export function aniversariantes(contatos: readonly Pick<ContatoAgenda, "nome" | "aniversario">[], hoje: string, dias: number): Aniversariante[] {
  const [ano, mes, dia] = hoje.split("-").map(Number);
  const base = Date.UTC(ano, mes - 1, dia);
  const out: Aniversariante[] = [];
  for (const c of contatos) {
    const a = c.aniversario;
    if (!a) continue;
    // o aniversário deste ano, ou do próximo se já passou (29/02 cai em 01/03)
    let alvo = Date.UTC(ano, a.mes - 1, a.dia);
    let anoDoAniversario = ano;
    if (alvo < base) {
      alvo = Date.UTC(ano + 1, a.mes - 1, a.dia);
      anoDoAniversario = ano + 1;
    }
    const emDias = Math.round((alvo - base) / 86_400_000);
    if (emDias > dias) continue;
    out.push({ nome: c.nome, dia: a.dia, mes: a.mes, emDias, idade: a.ano ? anoDoAniversario - a.ano : null });
  }
  return out.sort((x, y) => x.emDias - y.emDias || x.nome.localeCompare(y.nome));
}

/** A chave de um telefone como veio da agenda (normaliza antes: "(11) 9…" sem DDI tem de casar com o JID). */
export function chaveDe(telefone: string): string {
  return chaveDoTelefone(normalizarTelefone(telefone) ?? telefone);
}

/**
 * Tira duplicatas ENTRE contas: o mesmo contato salvo no Gmail pessoal e no do
 * trabalho. Só funde quando o nome é o mesmo E há um e-mail ou telefone em
 * comum, e nunca dentro da mesma conta: pai e mãe com o fixo da casa como
 * primeiro número viravam uma pessoa só, e a mãe sumia da busca.
 */
export function juntarContas(contatos: readonly ContatoAgenda[]): ContatoAgenda[] {
  const out: ContatoAgenda[] = [];
  for (const c of contatos) {
    const ja = out.find(
      (x) =>
        x.conta !== c.conta &&
        normalizarNome(x.nome) === normalizarNome(c.nome) &&
        (x.emails.some((e) => c.emails.some((f) => f.toLowerCase() === e.toLowerCase())) || x.telefones.some((t) => c.telefones.some((u) => chaveDe(u) === chaveDe(t)))),
    );
    if (!ja) {
      out.push({ ...c, apelidos: [...c.apelidos], emails: [...c.emails], telefones: [...c.telefones] });
      continue;
    }
    for (const e of c.emails) if (!ja.emails.some((x) => x.toLowerCase() === e.toLowerCase())) ja.emails.push(e);
    for (const t of c.telefones) if (!ja.telefones.some((x) => chaveDe(x) === chaveDe(t))) ja.telefones.push(t);
    for (const a of c.apelidos) if (!ja.apelidos.includes(a)) ja.apelidos.push(a);
    ja.aniversario ??= c.aniversario;
    ja.empresa ??= c.empresa;
  }
  return out;
}
