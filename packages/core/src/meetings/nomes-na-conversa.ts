import type { SttUtterance } from "../stt/types";

/**
 * QUEM É CADA VOZ, PELO QUE FOI DITO.
 *
 * A separação de vozes devolve "Locutor A" e "Locutor B"; o reconhecimento por
 * voz só sabe o nome de quem já tem assinatura cadastrada. Resultado: um
 * visitante virava "Desconhecido 1" mesmo tendo dito o próprio nome em voz alta,
 * e o compromisso dele saía no nome de um rótulo.
 *
 * Só que a reunião quase sempre DIZ quem é quem, e raramente da forma fácil:
 *
 *   • apresentação  "eu me chamo Lucas", "aqui é a Marcela"   → é ELE falando
 *   • chamado       "William, te mandei o doc que você pediu" → é o PRÓXIMO
 *
 * O segundo caso é o normal numa reunião de verdade, e é mais fraco: quem foi
 * chamado costuma responder em seguida, mas nem sempre. Por isso as duas fontes
 * ficam separadas, e quem consome decide o que fazer com cada uma — afirmar um
 * nome errado numa transcrição é pior do que deixar "Locutor B".
 *
 * Puro e sem rede: só texto entra, só hipótese sai.
 */

/** De onde veio o nome. A apresentação é forte; o chamado é palpite bom. */
export type FonteDoNome = "apresentacao" | "chamado";

export interface NomeSugerido {
  /** etiqueta da diarização ("A", "B"…) */
  label: string;
  nome: string;
  fonte: FonteDoNome;
  /** o que foi dito, para a tela poder justificar a sugestão */
  trecho: string;
}

/** Apresentação vale mais que chamado quando os dois apontam para a mesma voz. */
const PESO: Record<FonteDoNome, number> = { apresentacao: 2, chamado: 1 };

/**
 * Palavra que começa com maiúscula mas não é nome de gente.
 *
 * Faz falta porque a transcrição capitaliza o início de cada frase: sem isto,
 * "Então, vamos começar" viraria uma pessoa chamada Então. É engenharia (lista
 * de apoio do português), não decisão do dono — nome de gente de verdade vem do
 * cadastro de pessoas e do que for dito.
 */
const NAO_SAO_NOMES = new Set([
  "orbita", "bom", "boa", "oi", "ola", "entao", "certo", "beleza", "ok", "okay", "opa", "eai",
  "pessoal", "gente", "galera", "time", "turma", "equipe", "senhores", "senhoras", "amigos",
  "desculpa", "desculpe", "obrigado", "obrigada", "valeu", "sim", "nao", "mas", "ai", "agora",
  "depois", "isso", "aquilo", "ta", "tudo", "pois", "bem", "olha", "escuta", "alo", "claro",
  "perfeito", "exato", "legal", "otimo", "show", "fechado", "combinado", "vamos", "vai", "veja",
  "ele", "ela", "voce", "eu", "a", "o", "e", "entendi", "sei", "acho", "pera", "espera", "so",
  "primeiro", "segundo", "ultimo", "hoje", "ontem", "amanha", "reuniao", "bem-vindo", "prazer",
]);

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Um nome plausível: começa com maiúscula, tem corpo, e não está na lista de apoio. */
function nomeValido(bruto: string | undefined): string | null {
  const nome = (bruto ?? "").trim().replace(/[.,;:!?]+$/, "");
  if (nome.length < 2 || nome.length > 20) return null;
  if (!/^\p{Lu}\p{L}+$/u.test(nome)) return null;
  return NAO_SAO_NOMES.has(semAcento(nome)) ? null : nome;
}

const NOME = "(\\p{Lu}\\p{L}+)";

/**
 * "eu me chamo Lucas", "aqui é a Marcela", "meu nome é William".
 * Quem diz é quem está falando — é a evidência mais forte que existe num áudio.
 */
const APRESENTACAO: RegExp[] = [
  new RegExp(`\\b(?:eu\\s+)?me\\s+chamo\\s+${NOME}`, "iu"),
  new RegExp(`\\bmeu\\s+nome\\s+(?:é|e)\\s+${NOME}`, "iu"),
  new RegExp(`\\beu\\s+sou\\s+(?:o|a)\\s+${NOME}`, "iu"),
  new RegExp(`\\beu\\s+sou\\s+${NOME}`, "iu"),
  new RegExp(`\\baqui\\s+(?:é|e)\\s+(?:o|a)\\s+${NOME}`, "iu"),
  new RegExp(`\\baqui\\s+quem\\s+fala\\s+(?:é|e)\\s+(?:o|a)?\\s*${NOME}`, "iu"),
  new RegExp(`\\bquem\\s+(?:fala|est[áa]\\s+falando)\\s+(?:é|e)\\s+(?:o|a)?\\s*${NOME}`, "iu"),
];

/**
 * "William, te mandei o doc", "me fala das suas tarefas, Marcela?", "obrigado, Lucas".
 * Quem é chamado costuma ser o PRÓXIMO a falar — não quem falou.
 */
/**
 * O chamado quase nunca vem limpo no começo da frase. Em português falado ele
 * vem depois de uma interjeição — "Ô Lucas, você viu...", "Ei Marcela,", "Olha
 * William," —, e foi exatamente assim numa reunião real (26/09/2026), com o
 * "Ô" derrubando o reconhecimento sozinho.
 */
const CHAMA = "(?:(?:ô|o|oh|ei|eita|olha|escuta|oi|alô|opa|hey|então|pô)\\s+)?";

const CHAMADO: RegExp[] = [
  new RegExp(`^\\s*${CHAMA}${NOME}\\s*,`, "iu"),
  new RegExp(`,\\s*${NOME}\\s*[?!.]*\\s*$`, "u"),
  new RegExp(`\\bobrigad[oa]\\s*,?\\s*${NOME}\\b`, "iu"),
];

/** O primeiro nome que alguma das formas encontrar na fala. */
function primeiroNome(texto: string, formas: RegExp[]): string | null {
  for (const re of formas) {
    const nome = nomeValido(re.exec(texto)?.[1]);
    if (nome) return nome;
  }
  return null;
}

/** A próxima fala de OUTRA voz (é ela que responde a quem foi chamado). */
function proximaVozDiferente(utterances: readonly SttUtterance[], i: number): string | null {
  for (let j = i + 1; j < utterances.length; j++) {
    if (utterances[j]!.speaker !== utterances[i]!.speaker) return utterances[j]!.speaker;
  }
  return null;
}

/**
 * Os nomes que a própria conversa revelou, um por voz.
 *
 * Conflito não vira chute: duas vozes reivindicando o mesmo nome, ou uma voz com
 * dois nomes de mesma força, saem as duas de fora. Preferir errar para menos é
 * deliberado — a tela sempre deixa o dono digitar o nome, e um nome ERRADO se
 * espalha para o resumo, para as tarefas e para a memória da casa.
 */
export function nomesNaConversa(utterances: readonly SttUtterance[]): NomeSugerido[] {
  const candidatos: NomeSugerido[] = [];

  for (const [i, u] of utterances.entries()) {
    const texto = u.text ?? "";

    const apresentado = primeiroNome(texto, APRESENTACAO);
    if (apresentado) candidatos.push({ label: u.speaker, nome: apresentado, fonte: "apresentacao", trecho: texto.slice(0, 160) });

    const chamado = primeiroNome(texto, CHAMADO);
    const proxima = chamado ? proximaVozDiferente(utterances, i) : null;
    if (chamado && proxima) candidatos.push({ label: proxima, nome: chamado, fonte: "chamado", trecho: texto.slice(0, 160) });
  }

  // um nome por voz: a evidência mais forte vence; empate entre nomes
  // DIFERENTES não escolhe nenhum
  const porLabel = new Map<string, NomeSugerido | null>();
  for (const c of candidatos) {
    const atual = porLabel.get(c.label);
    if (atual === undefined) {
      porLabel.set(c.label, c);
      continue;
    }
    if (!atual) continue; // já marcado como ambíguo
    if (PESO[c.fonte] > PESO[atual.fonte]) porLabel.set(c.label, c);
    else if (PESO[c.fonte] === PESO[atual.fonte] && semAcento(c.nome) !== semAcento(atual.nome)) porLabel.set(c.label, null);
  }

  // e uma voz por nome: se duas vozes dizem ser a mesma pessoa, alguma está
  // errada, e não dá para saber qual
  const escolhidos = [...porLabel.entries()].filter((e): e is [string, NomeSugerido] => Boolean(e[1]));
  const porNome = new Map<string, NomeSugerido[]>();
  for (const [, c] of escolhidos) {
    const chave = semAcento(c.nome);
    porNome.set(chave, [...(porNome.get(chave) ?? []), c]);
  }

  const out: NomeSugerido[] = [];
  for (const iguais of porNome.values()) {
    if (iguais.length === 1) {
      out.push(iguais[0]!);
      continue;
    }
    const forte = iguais.filter((c) => c.fonte === "apresentacao");
    if (forte.length === 1) out.push(forte[0]!); // quem se apresentou vence quem foi só chamado
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** Só os nomes fortes o bastante para AFIRMAR ("Lucas:" na transcrição). */
export function nomesAfirmaveis(sugeridos: readonly NomeSugerido[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of sugeridos) if (s.fonte === "apresentacao") out[s.label] = s.nome;
  return out;
}
