/**
 * Os nomes que o dono dá aos seus Jiras ("CG", "CIA"). Quem edita é o lápis da
 * tela inicial; o texto fica em `trabalho.apelidosJira`, uma linha por site,
 * `site=Nome`, para a tela de Ajustes também conseguir mostrar e corrigir.
 *
 * A chave é o NOME DO SITE que o Jira informa, o mesmo que vem em cada issue:
 * conectar um segundo Jira não mexe no apelido do primeiro, e o site novo
 * nasce sem apelido (a tela mostra o nome do site até o dono escolher).
 */

export const APELIDO_MAX = 40;

export function lerApelidos(texto: string): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const linha of texto.split("\n")) {
    // o primeiro "=" separa: o nome de um site pode conter "=" depois dele
    const i = linha.indexOf("=");
    if (i <= 0) continue;
    const site = linha.slice(0, i).trim();
    const apelido = linha.slice(i + 1).trim();
    if (site && apelido) mapa[site] = apelido.slice(0, APELIDO_MAX);
  }
  return mapa;
}

/** Grava (ou, com apelido vazio, remove) o nome de um site. Quebra de linha no nome vira espaço, para não forjar outra entrada. */
export function gravarApelido(texto: string, site: string, apelido: string): string {
  const limpo = (s: string) => s.replace(/[\r\n=]+/g, " ").trim();
  const chave = limpo(site);
  const mapa = lerApelidos(texto);
  const novo = limpo(apelido).slice(0, APELIDO_MAX);
  if (novo) mapa[chave] = novo;
  else delete mapa[chave];
  return Object.entries(mapa)
    .map(([s, a]) => `${s}=${a}`)
    .join("\n");
}
