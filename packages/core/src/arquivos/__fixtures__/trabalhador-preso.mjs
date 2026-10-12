// Um parser PRESO de propósito, para o teste do isolamento (isolado.test.ts):
// fala o mesmo protocolo da thread de leitura e, ao receber um arquivo, gira a
// CPU sem nunca devolver o laço, como a regex quadrática do B5 fazia.
import { parentPort } from "node:worker_threads";

parentPort.on("message", (m) => {
  if (m.t !== "ler") return;
  for (;;) {
    /* laço síncrono sem fim: só a morte da thread o encerra */
  }
});
parentPort.postMessage({ t: "pronto" });
