// A PONTE de native messaging (PRD B7). O Chrome a inicia SÓ para a extensão
// listada em `allowed_origins` (sem curinga), e ela repassa as mensagens ao
// canal do apps/api. Não decide nada e não guarda nada: o token continua indo
// na primeira mensagem, como no WebSocket direto, e o api confere igual.
//
// Sem Origin, o api só aceita a ponte com o SEGREDO do arquivo que o
// instalador gerou (ACL só do dono): é o que impede qualquer outro processo da
// máquina de se passar pela ponte. A origem que o Chrome passou (a extensão que
// iniciou a ponte) vai junto, e o api confere que é a extensão configurada.
//
// Regras do protocolo no Windows: stdin e stdout em modo binário, NADA de
// console.log (stdout é o canal com o Chrome; log vai para o stderr, que o
// Chrome joga no log dele).
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import WebSocket from "ws";
import { criarLeitor, quadrosParaOChrome } from "./quadros.mjs";
import { caminhoDoSegredo } from "./instalar.mjs";

const URL_DO_CANAL = process.env.ORBITA_CANAL_URL || "ws://127.0.0.1:3010/api/navegador/canal";
const origemDoChrome = process.argv.find((a) => a.startsWith("chrome-extension://")) ?? "";
const log = (...a) => process.stderr.write(`[orbita-ponte] ${a.join(" ")}\n`);

const arquivo = caminhoDoSegredo();
const segredo = existsSync(arquivo) ? readFileSync(arquivo, "utf8").trim() : "";
if (!segredo) {
  // sem o segredo o api recusa de qualquer jeito: sai, e a extensão cai para o WebSocket direto
  log("sem o segredo da ponte (rode o instalador de novo):", arquivo);
  process.exit(0);
}

const fila = [];
let aberto = false;
const ws = new WebSocket(URL_DO_CANAL, { headers: { "x-orbita-ponte": segredo, "x-orbita-ponte-origem": origemDoChrome }, perMessageDeflate: false });

ws.on("open", () => {
  aberto = true;
  for (const m of fila.splice(0)) ws.send(JSON.stringify(m));
});
ws.on("message", (dados) => {
  let obj;
  try {
    obj = JSON.parse(dados.toString());
  } catch {
    return;
  }
  for (const q of quadrosParaOChrome(obj, randomUUID())) process.stdout.write(q);
});
ws.on("close", (codigo, motivo) => {
  log("canal fechou", String(codigo), motivo.toString());
  process.exit(0);
});
ws.on("error", (e) => {
  // api fora: sai sem responder, e a extensão cai para o WebSocket direto (que também vai tentar de novo)
  log("canal falhou", e.message);
  process.exit(0);
});

const ler = criarLeitor((m) => {
  if (aberto) ws.send(JSON.stringify(m));
  else fila.push(m);
});
process.stdin.on("data", (b) => {
  try {
    ler(b);
  } catch (e) {
    log("entrada inválida", e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
});
process.stdin.on("end", () => {
  ws.close();
  process.exit(0);
});
log("ponte de pé para", origemDoChrome || "(origem não informada)");
