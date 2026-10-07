/**
 * O que o CÓDIGO acrescenta ao pedido do bom dia. Puro.
 *
 * O dono trabalha em lugares diferentes conforme o dia ("terça e quinta na
 * Companhia de Estágios, segunda, quarta e sexta na Adalink") e quer o
 * trânsito do lugar CERTO no bom dia. Deixar o modelo deduzir o dia da semana
 * e cruzar com uma memória é pedir erro; o código sabe que dia é e diz ao
 * modelo para qual lugar pedir a rota (`casa.trabalhoPorDia`).
 *
 * O bom dia também pode ir em ÁUDIO: aí o texto é para ser ouvido, sem lista,
 * asterisco nem link, que a voz leria em voz alta.
 */

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;
const NOMES = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * O lugar de trabalho de um dia da semana (0 = domingo). Cada linha de
 * `casa.trabalhoPorDia` é "dias: lugar", com os dias abreviados ou por
 * extenso e separados por vírgula ("ter, qui: Companhia de Estágios").
 */
export function trabalhoDoDia(linhas: string[], diaDaSemana: number): string | null {
  const alvo = DIAS[diaDaSemana];
  for (const linha of linhas) {
    const i = linha.indexOf(":");
    if (i < 1) continue;
    const lugar = linha.slice(i + 1).trim();
    // "terça e quinta": o "e" sozinho separa, o de dentro de "terça" não
    const dias = semAcento(linha.slice(0, i)).replace(/\se\s/g, ",").split(/[,;/\s]+/).map((d) => d.trim().slice(0, 3)).filter(Boolean);
    if (lugar && dias.includes(alvo!)) return lugar;
  }
  return null;
}

export function nomeDoDia(diaDaSemana: number): string {
  return NOMES[diaDaSemana] ?? "";
}

/** As linhas que vão depois do pedido do dono: o dia, o trabalho e o jeito de escrever. */
export function contextoDoBomDia(opts: { diaDaSemana: number; dia: string; trabalho: string | null; temTrabalhoCadastrado: boolean; audio: boolean }): string {
  const linhas = [`Hoje é ${nomeDoDia(opts.diaDaSemana)}, ${opts.dia.slice(8, 10)}/${opts.dia.slice(5, 7)}.`];
  if (opts.trabalho) linhas.push(`Hoje o trabalho é na ${opts.trabalho}: use a ferramenta rota de casa até "${opts.trabalho}" (de carro) e diga quanto tempo leva com o trânsito de agora.`);
  else if (opts.temTrabalhoCadastrado) linhas.push("Hoje não é dia de ir ao trabalho: não fale de trânsito.");
  if (opts.audio) {
    linhas.push(
      "Este bom dia vai como NOTA DE VOZ: escreva para ser ouvido, como se estivesse falando com ele. Frases curtas e naturais, sem lista, sem asterisco, sem emoji, sem link e sem travessão. Valores como \"duzentos e sessenta e cinco reais\" só quando ajudar; senão arredonde (\"uns 265 reais\"). No máximo uns 90 segundos de fala.",
    );
  }
  return `\n${linhas.join("\n")}`;
}
