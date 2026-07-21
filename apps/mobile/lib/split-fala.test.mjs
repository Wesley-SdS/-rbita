// Testa o splitFala do mobile com as MESMAS asserções do engine.test.ts do web,
// garantindo que a cópia não divergiu. Rode: node --experimental-strip-types split-fala.test.mjs
import assert from "node:assert";
import { splitFala } from "./split-fala.ts";

const compacta = (s) => s.replace(/\s/g, "");

const casos = [
  ["frase curta", "Claro, já anotei."],
  ["duas frases", "Bom dia, Wesley! Já separei sua agenda e o resumo do dia. Quer que eu comece por onde?"],
  [
    "resposta longa",
    "Bom dia! Você tem três compromissos hoje, sendo o primeiro às nove da manhã com a equipe de produto. Também separei dois e-mails que parecem urgentes e uma cobrança que vence amanhã. Quer que eu detalhe algum?",
  ],
  ["sem pontuação", "ok"],
  ["reticências", "Hmm... deixa eu ver. Achei!"],
  ["lista com quebras", "Tarefas de hoje:\nComprar pão\nLigar pro médico\nPagar a conta"],
  [
    "frase gigante sem ponto",
    "vamos revisar o contrato e depois falar com o financeiro, checar as pendências do mês passado, confirmar os pagamentos recorrentes, revisar as assinaturas ativas, cancelar o que não usamos mais e por fim montar o relatório consolidado do trimestre",
  ],
];

let n = 0;
const ok = (nome, cond) => { assert.ok(cond, "FALHOU: " + nome); n++; };

for (const [nome, txt] of casos) {
  const t = splitFala(txt);
  ok(`${nome}: não perde texto`, compacta(t.join("")) === compacta(txt));
  ok(`${nome}: sem trecho vazio`, t.every((x) => x.trim() !== ""));
  ok(`${nome}: nada acima de 200`, t.every((x) => x.length <= 200));
  ok(`${nome}: gera ao menos 1`, t.length > 0);
}

// específicos (iguais aos do web)
ok("curta fica num pedido só", splitFala("Claro, já anotei.").length === 1);
ok("longa quebra em vários", splitFala(casos[2][1]).length > 1);
ok("1º trecho curto (<=80)", splitFala(casos[2][1])[0].length <= 80);
ok("vazio não gera trecho", splitFala("   \n  ").length === 0);
ok("gigante parte na vírgula", splitFala(casos[6][1]).length > 1);

console.log(`OK — ${n} asserções passaram`);
console.log("exemplo (resposta longa):");
splitFala(casos[2][1]).forEach((t, i) => console.log(`  ${i}: (${t.length}) ${t}`));
