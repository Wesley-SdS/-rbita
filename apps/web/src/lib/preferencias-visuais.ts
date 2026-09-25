/**
 * TEMA E BARRA LATERAL, DECIDIDOS NO SERVIDOR.
 *
 * Isto morava num `<script>` cru dentro do layout, que lia o `localStorage` e
 * escrevia o atributo antes do primeiro paint. Funcionava por acidente: o
 * navegador executa a tag ao ler o HTML, antes de o React existir. O React 19
 * passou a avisar no console que "scripts dentro de componentes nunca são
 * executados na renderização do cliente", e o aviso está certo.
 *
 * A saída óbvia (`next/script` com `beforeInteractive`) foi MEDIDA e não
 * serve: nesta versão do Next o script sai DEPOIS do `<body>`, e não dentro do
 * `<head>`. Trocaria um aviso de console por um flash de tema visível.
 *
 * A solução é não ter script: a preferência vira COOKIE, o servidor a lê e já
 * manda o `<html>` com o atributo certo. Sem flash, sem aviso, sem
 * `suppressHydrationWarning`, e funciona até com JavaScript desligado.
 *
 * Cookie e não `localStorage` porque o servidor precisa ler, e `localStorage`
 * o servidor nunca vê. É preferência de interface, não segredo: não precisa de
 * `httpOnly`, e é o próprio navegador que grava.
 */

export const COOKIE_TEMA = "orbita.tema";
export const COOKIE_LATERAL = "orbita.lateral";

/** Um ano: preferência visual não deve expirar no meio do uso. */
const UM_ANO = 60 * 60 * 24 * 365;

export type Tema = "claro" | "escuro";
export type Lateral = "aberta" | "recolhida";

/**
 * Os atributos do `<html>`, a partir dos cookies.
 *
 * O padrão (Mineral claro, barra aberta) NÃO grava atributo: é o CSS base, e
 * escrever `data-theme="light"` só criaria um segundo jeito de dizer a mesma
 * coisa.
 */
export function atributosDoHtml(tema: string | undefined, lateral: string | undefined): { "data-theme"?: string; "data-lateral"?: string } {
  const out: { "data-theme"?: string; "data-lateral"?: string } = {};
  if (tema === "escuro" || tema === "dark") out["data-theme"] = "dark";
  if (lateral === "recolhida") out["data-lateral"] = "recolhida";
  return out;
}

/** Grava a preferência no navegador. `path=/` porque vale para o app inteiro. */
export function gravarPreferencia(nome: string, valor: string): void {
  try {
    document.cookie = `${nome}=${encodeURIComponent(valor)}; path=/; max-age=${UM_ANO}; samesite=lax`;
  } catch {
    /* navegação privada muito restrita: a escolha vale só nesta aba */
  }
}

/**
 * Leva a escolha antiga do `localStorage` para o cookie, uma vez.
 *
 * Sem isto, quem já usava a Órbita com tema escuro abriria no claro depois
 * desta mudança e acharia que a preferência foi esquecida. Só grava quando NÃO
 * há cookie: se a pessoa já escolheu depois da mudança, o cookie manda.
 *
 * Aplica o atributo na hora também, senão a correção só apareceria no
 * recarregamento seguinte.
 */
export function migrarDoLocalStorage(): void {
  if (typeof document === "undefined") return;
  try {
    if (document.cookie.includes(`${COOKIE_TEMA}=`)) return;
    const tema = localStorage.getItem("orbita.theme");
    const lateral = localStorage.getItem("orbita.lateral");
    if (!tema && !lateral) return;

    if (tema) gravarPreferencia(COOKIE_TEMA, tema === "dark" ? "escuro" : "claro");
    if (lateral) gravarPreferencia(COOKIE_LATERAL, lateral);

    const d = document.documentElement;
    if (tema === "dark") d.dataset.theme = "dark";
    if (lateral === "recolhida") d.dataset.lateral = "recolhida";
  } catch {
    /* navegação privada: a escolha antiga se perde, e a nova vale normalmente */
  }
}
