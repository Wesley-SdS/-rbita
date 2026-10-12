import { parentPort } from "node:worker_threads";
import { extrair } from "./extrair";
import type { MensagemAoTrabalhador, MensagemDoTrabalhador } from "./isolado";

/**
 * O lado de DENTRO da leitura isolada (`isolado.ts`): roda o extrator
 * universal numa thread própria. Um parser que gaste CPU aqui para só esta
 * thread; o laço do apps/api (chat, WhatsApp, scheduler) continua girando, e
 * quem pediu pode matar esta thread pelo teto de tempo.
 */

const porta = parentPort;
if (!porta) throw new Error("isolado-trabalhador só roda como worker thread.");

const paradas = new Map<number, AbortController>();
const enviar = (m: MensagemDoTrabalhador) => porta.postMessage(m);

porta.on("message", (m: MensagemAoTrabalhador) => {
  if (m.t === "parar") {
    paradas.get(m.id)?.abort();
    return;
  }
  const parar = new AbortController();
  if (m.parado) parar.abort();
  paradas.set(m.id, parar);
  const bytes = Buffer.from(m.bytes.buffer, m.bytes.byteOffset, m.bytes.byteLength);
  extrair(bytes, {
    ...m.opcoes,
    sinal: parar.signal,
    progresso: async (feito, total, passo) => enviar({ t: "progresso", id: m.id, feito, total, passo }),
  })
    .then((r) => enviar({ t: "fim", id: m.id, r }))
    .catch((e: unknown) => enviar({ t: "erro", id: m.id, nome: e instanceof Error ? e.name : "Error", mensagem: e instanceof Error ? e.message : String(e) }))
    .finally(() => paradas.delete(m.id));
});

enviar({ t: "pronto" });
