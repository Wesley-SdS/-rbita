import { mascararSegredos, segredosDoAmbiente } from "../terminal/saida";

/**
 * SEGREDO NÃO VAI PARA A TRILHA (O5 da revisão de 11/10/2026).
 *
 * A trilha do controle do PC grava o `comando` e a `url` de cada passo, e ela
 * fica no banco, aparece na tela e entra no export da conta. Um
 * `curl -H "Authorization: Bearer …"`, um `git clone https://usuario:senha@…`
 * ou uma URL com `?access_token=` saíam inteiros. A máscara é a mesma da saída
 * do terminal (formatos conhecidos de token, `chave=valor` com nome de
 * segredo e os valores dos segredos do ambiente), mais o que é próprio de
 * endereço: a senha antes do `@` e o parâmetro com nome de segredo. Puro.
 */

/** Nome de parâmetro de URL que costuma levar segredo. */
const PARAMETRO_SECRETO = /(token|secret|senha|password|passwd|pwd|pass|api[_-]?key|apikey|key|code|sig|signature|auth|session|jwt|otp|credential)/i;
/**
 * Um endereço com esquema CONHECIDO, até o primeiro espaço ou aspas. O esquema
 * é uma lista fixa, e não `[a-z][a-z0-9+.-]*`: com a classe aberta, cada
 * palavra de um texto `a.a.a…` começava uma tentativa que varria até o fim
 * (40 mil caracteres levavam 5,3 s com o laço de eventos parado; G2 da
 * auditoria de 11/10/2026). Começando num literal, a tentativa que falha
 * para logo.
 */
const ENDERECO = /\b(?:https?|ftps?|sftp|ssh|git|wss?|postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?|smtps?|imaps?|ldaps?|file):\/\/[^\s"'<>`]+/gi;

function mascararConsulta(trecho: string): string {
  return trecho
    .split("&")
    .map((par) => {
      const i = par.indexOf("=");
      if (i <= 0) return par;
      let nome = par.slice(0, i);
      try {
        nome = decodeURIComponent(nome);
      } catch {
        /* nome com % torto: compara como veio */
      }
      return PARAMETRO_SECRETO.test(nome) ? `${par.slice(0, i)}=[segredo]` : par;
    })
    .join("&");
}

/** A senha antes do `@` e os parâmetros com nome de segredo (na consulta e no fragmento) viram `[segredo]`. Puro. */
export function mascararEnderecos(texto: string): string {
  return texto.replace(ENDERECO, (url) => {
    let u = url.replace(/^([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+):[^\s/@]+@/i, "$1:[segredo]@");
    const q = u.indexOf("?");
    const h = u.indexOf("#");
    if (h !== -1) u = `${u.slice(0, h + 1)}${mascararConsulta(u.slice(h + 1))}`;
    if (q !== -1 && (h === -1 || q < h)) {
      const fim = h === -1 ? u.length : u.indexOf("#");
      u = `${u.slice(0, q + 1)}${mascararConsulta(u.slice(q + 1, fim))}${u.slice(fim)}`;
    }
    return u;
  });
}

/** O texto como pode ficar guardado na trilha: endereços e segredos mascarados. Puro (o ambiente entra como parâmetro). */
export function mascararNaTrilha(texto: string, valoresDoAmbiente: readonly string[] = segredosDoAmbiente()): string {
  return mascararSegredos(mascararEnderecos(texto), valoresDoAmbiente);
}
