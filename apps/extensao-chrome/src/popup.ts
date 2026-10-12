/// <reference types="chrome" />

/** O popup só mostra e pede: quem conecta, pareia e para é o service worker. */

interface Status {
  conectado: boolean;
  via: "nativo" | "websocket" | null;
  pareado: boolean;
  envelope: { objetivo: string; sites: string[]; passosUsados: number; tetoPassos: number } | null;
  parado: boolean;
  ultimoErro: string | null;
  apiUrl: string;
  versao: string;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function pedir<T>(m: Record<string, unknown>): Promise<T> {
  return chrome.runtime.sendMessage(m) as Promise<T>;
}

export async function desenharStatus(): Promise<void> {
  const s = await pedir<Status>({ tipo: "orbita:status" });
  $("estado").textContent = s.conectado ? `Conectada à Órbita (${s.via === "nativo" ? "native messaging" : "WebSocket"})` : s.pareado ? "Pareada, mas sem conexão agora" : "Ainda não pareada";
  $("sessao").textContent = s.envelope ? `Sessão: ${s.envelope.objetivo} (${s.envelope.sites.join(", ")})${s.parado ? ", pausada por você" : ""}` : "Nenhuma sessão de controle aberta.";
  const parear = document.getElementById("parear");
  if (parear) parear.hidden = s.pareado && s.conectado;
  const end = document.getElementById("endereco") as HTMLInputElement | null;
  if (end && !end.value) end.value = s.apiUrl;
  $("aviso").textContent = s.ultimoErro && !s.conectado ? s.ultimoErro : "";
}

function ligar(): void {
  document.getElementById("botao-parear")?.addEventListener("click", async () => {
    const codigo = ($("codigo") as HTMLInputElement).value.trim();
    const r = await pedir<{ ok: boolean; erro?: string }>({ tipo: "orbita:parear", codigo });
    $("aviso").textContent = r.ok ? "" : (r.erro ?? "Não deu certo.");
    setTimeout(() => void desenharStatus(), 1500);
  });
  $("parar").addEventListener("click", async () => {
    await pedir({ tipo: "orbita:parar" });
    await desenharStatus();
  });
  document.getElementById("painel")?.addEventListener("click", async () => {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (t?.windowId !== undefined) await chrome.sidePanel.open({ windowId: t.windowId });
  });
  document.getElementById("botao-endereco")?.addEventListener("click", async () => {
    const r = await pedir<{ ok: boolean; erro?: string }>({ tipo: "orbita:endereco", apiUrl: ($("endereco") as HTMLInputElement).value.trim() });
    $("aviso").textContent = r.ok ? "" : (r.erro ?? "Endereço recusado.");
  });
  document.getElementById("esquecer")?.addEventListener("click", async () => {
    // com a Órbita no ar, o token é revogado lá também; fora do ar, a tela avisa que falta revogar em Ajustes
    const r = await pedir<{ ok: boolean; aviso?: string | null }>({ tipo: "orbita:esquecer" });
    await desenharStatus();
    if (r.aviso) $("aviso").textContent = r.aviso;
  });
  void desenharStatus();
  setInterval(() => void desenharStatus(), 2000);
}

ligar();
