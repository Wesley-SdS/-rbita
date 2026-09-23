/**
 * POR QUE A VOZ NÃO FUNCIONA NESTE APARELHO.
 *
 * O navegador só entrega microfone, Wake Lock e service worker em CONTEXTO
 * SEGURO: HTTPS, ou `localhost`. Acessando a Órbita de outro aparelho da casa
 * por `http://192.168.x.x:3000`, `navigator.mediaDevices` simplesmente NÃO
 * EXISTE, e o código que tenta usá-lo estoura com "cannot read property
 * getUserMedia of undefined".
 *
 * Isso não é detalhe de configuração: é o que impede o celular de virar um
 * satélite de voz na cozinha, e é quase certamente a mesma causa do "no iPhone
 * não consigo criar conta" que está no checklist desde sempre (cookie com
 * `Secure` não é gravado fora de HTTPS).
 *
 * Este arquivo existe para a falha ser DITA. Antes, a voz no celular
 * simplesmente não acontecia, sem mensagem nenhuma, e parecia defeito da
 * Órbita.
 */

export interface DiagnosticoDeVoz {
  /** dá para abrir o microfone */
  podeGravar: boolean;
  /** dá para impedir a tela de dormir (satélite) */
  podeSegurarTela: boolean;
  /** o que dizer ao dono, ou null quando está tudo certo */
  motivo: string | null;
  /** o endereço que funcionaria, quando dá para sugerir um */
  sugestao?: string;
}

/** O mínimo do `window` que este diagnóstico olha. Facilita o teste. */
export interface JanelaSuficiente {
  isSecureContext?: boolean;
  location?: { protocol?: string; hostname?: string; host?: string; port?: string };
  navigator?: { mediaDevices?: unknown; wakeLock?: unknown };
}

const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * O que este navegador consegue fazer, e o motivo quando não consegue.
 *
 * A ordem das checagens importa: contexto inseguro explica TUDO de uma vez, e
 * dizer "seu navegador não suporta microfone" para quem só está em HTTP seria
 * mandar a pessoa procurar no lugar errado.
 */
export function diagnosticarVoz(win: JanelaSuficiente): DiagnosticoDeVoz {
  const host = win.location?.hostname ?? "";
  const seguro = win.isSecureContext ?? (win.location?.protocol === "https:" || LOCAL.has(host));

  if (!seguro) {
    const porta = win.location?.port ? `:${win.location.port}` : "";
    return {
      podeGravar: false,
      podeSegurarTela: false,
      motivo:
        "Este endereço não é seguro (HTTP), e por isso o navegador não libera o microfone. " +
        "Voz, “Ei Órbita” e o modo satélite só funcionam por HTTPS ou no próprio computador.",
      // a sugestão é útil de verdade: em muitos casos a pessoa está no celular
      // e só precisa saber que no computador funciona
      sugestao: host && !LOCAL.has(host) ? `http://localhost${porta}` : undefined,
    };
  }

  const temMic = Boolean(win.navigator?.mediaDevices);
  if (!temMic) {
    return {
      podeGravar: false,
      podeSegurarTela: Boolean(win.navigator?.wakeLock),
      motivo: "Este navegador não dá acesso ao microfone. Use o Chrome, o Edge ou o Safari atualizados.",
    };
  }

  return { podeGravar: true, podeSegurarTela: Boolean(win.navigator?.wakeLock), motivo: null };
}

/** Atalho para o código de tela, que só quer saber se pode tentar. */
export function podeUsarVoz(): boolean {
  if (typeof window === "undefined") return false;
  return diagnosticarVoz(window as unknown as JanelaSuficiente).podeGravar;
}
