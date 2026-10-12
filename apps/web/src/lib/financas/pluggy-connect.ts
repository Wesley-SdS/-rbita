/**
 * O widget de conexão da Pluggy (Open Finance). É o único trecho do fluxo que
 * roda no navegador, e por isso:
 *  - o script só é baixado quando o dono clica em conectar ou renovar, nunca na
 *    abertura da tela;
 *  - o endereço vem do servidor (que só aceita o domínio da Pluggy);
 *  - o que ele recebe é um token curto de uso único para o widget, nunca o
 *    clientSecret.
 */

interface WidgetPluggy {
  init(): void;
}

declare global {
  interface Window {
    PluggyConnect?: new (opcoes: Record<string, unknown>) => WidgetPluggy;
  }
}

const carregando = new Map<string, Promise<void>>();

export function carregarWidget(url: string): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Só no navegador."));
  if (window.PluggyConnect) return Promise.resolve();
  let p = carregando.get(url);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = url;
      s.async = true;
      s.onload = () => (window.PluggyConnect ? resolve() : reject(new Error("O widget da Pluggy carregou, mas não iniciou.")));
      s.onerror = () => {
        carregando.delete(url);
        reject(new Error("Não consegui carregar o widget da Pluggy. Confira a conexão e tente de novo."));
      };
      document.head.appendChild(s);
    });
    carregando.set(url, p);
  }
  return p;
}

/** O id do item que o widget devolve no sucesso (o formato varia entre `{ item }` e o item solto). */
export function itemDoSucesso(dados: unknown): string | null {
  const d = dados as { item?: { id?: string }; id?: string } | null;
  const id = d?.item?.id ?? d?.id;
  return typeof id === "string" ? id : null;
}

export async function abrirWidget(opcoes: {
  url: string;
  connectToken: string;
  /** o item da Pluggy a renovar; ausente = conectar um banco novo */
  updateItem?: string | null;
  aoConcluir: (itemId: string) => void;
  aoFalhar: (mensagem: string) => void;
}): Promise<void> {
  await carregarWidget(opcoes.url);
  const Widget = window.PluggyConnect!;
  new Widget({
    connectToken: opcoes.connectToken,
    ...(opcoes.updateItem ? { updateItem: opcoes.updateItem } : {}),
    language: "pt",
    onSuccess: (dados: unknown) => {
      const id = itemDoSucesso(dados);
      if (id) opcoes.aoConcluir(id);
      else opcoes.aoFalhar("A Pluggy concluiu, mas não informou qual banco foi conectado.");
    },
    onError: (erro: { message?: string } | undefined) => opcoes.aoFalhar(erro?.message ?? "A conexão com o banco não foi concluída."),
  }).init();
}
