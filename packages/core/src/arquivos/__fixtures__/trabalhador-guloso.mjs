// Um leitor que INFLA sem parar, para o teste do teto de memória (isolado.test.ts):
// fala o mesmo protocolo da thread de leitura e, ao receber um arquivo, guarda
// texto até a memória acabar, como o ZIP de TXT repetido do I5 fazia.
import { parentPort } from "node:worker_threads";

parentPort.on("message", (m) => {
  if (m.t !== "ler") return;
  const guardado = [];
  for (let i = 0; ; i++) guardado.push("x".repeat(1024 * 1024) + i);
});
parentPort.postMessage({ t: "pronto" });
