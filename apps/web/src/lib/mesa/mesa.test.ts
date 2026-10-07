import { describe, expect, it } from "vitest";
import type { CartaoDaTela } from "@orbita/core/chat/cartoes-da-tela";
import { LARGURA_DO_CARTAO, abrir, alternarMinimizado, dentroDaArea, fechar, mover, paraFrente, vagaPara, vazia } from "./mesa";

const AREA = { largura: 1440, altura: 900 };
const c = (id: string, tipo = id): CartaoDaTela => ({ id, tipo: tipo as CartaoDaTela["tipo"], titulo: id, itens: [] });

describe("a mesa de cartões", () => {
  it("cartões novos nascem em vagas diferentes, começando pela direita", () => {
    const m = abrir(vazia(), [c("emails"), c("agenda"), c("clima")], AREA, 5);
    const pos = m.cartoes.map((x) => `${x.x},${x.y}`);
    expect(new Set(pos).size).toBe(3);
    expect(m.cartoes[0]!.x).toBe(AREA.largura - LARGURA_DO_CARTAO - 16);
  });

  it("o mesmo cartão de novo é ATUALIZADO no lugar, volta para a frente e sai da bandeja", () => {
    let m = abrir(vazia(), [c("emails"), c("agenda")], AREA, 5);
    m = mover(m, "emails", 100, 200, AREA);
    m = alternarMinimizado(m, "emails", 5, AREA);
    m = abrir(m, [{ ...c("emails"), titulo: "atualizado" }], AREA, 5);
    const e = m.cartoes.find((x) => x.cartao.id === "emails")!;
    expect(m.cartoes).toHaveLength(2);
    expect(e).toMatchObject({ x: 100, y: 200, minimizado: false });
    expect(e.cartao.titulo).toBe("atualizado");
    expect(e.z).toBeGreaterThan(m.cartoes.find((x) => x.cartao.id === "agenda")!.z);
  });

  it("passou do limite de abertos, o mais antigo vai para a bandeja, sem fechar", () => {
    const m = abrir(vazia(), [c("a"), c("b"), c("c")], AREA, 2);
    expect(m.cartoes.map((x) => x.minimizado)).toEqual([true, false, false]);
    // restaurar o antigo respeita o limite: agora quem desce é o próximo mais antigo
    const r = alternarMinimizado(m, "a", 2, AREA);
    expect(r.cartoes.filter((x) => !x.minimizado).map((x) => x.cartao.id).sort()).toEqual(["a", "c"]);
  });

  it("nasce onde o dono deixou o último do mesmo tipo, se a vaga estiver livre", () => {
    const m = abrir(vazia(), [c("emails")], AREA, 5, (t) => (t === "emails" ? { x: 40, y: 300 } : null));
    expect(m.cartoes[0]).toMatchObject({ x: 40, y: 300 });
    const ocupada = abrir(m, [c("emails2", "emails")], AREA, 5, () => ({ x: 40, y: 300 }));
    expect(ocupada.cartoes[1]).not.toMatchObject({ x: 40, y: 300 });
  });

  it("arrastado para fora, o cabeçalho continua alcançável", () => {
    expect(dentroDaArea(5000, 5000, AREA)).toEqual({ x: AREA.largura - 120, y: AREA.altura - 56 });
    expect(dentroDaArea(-5000, -50, AREA).y).toBe(16);
    expect(dentroDaArea(-5000, -50, AREA).x).toBeGreaterThan(-LARGURA_DO_CARTAO);
  });

  it("mesa cheia cai em cascata em vez de empilhar exatamente no mesmo ponto", () => {
    const pequena = { largura: 400, altura: 500 };
    let m = abrir(vazia(), [c("a")], pequena, 9);
    const v = vagaPara(m, pequena);
    m = abrir(m, [c("b")], pequena, 9);
    expect(m.cartoes[1]).toMatchObject(v);
    expect(`${m.cartoes[0]!.x},${m.cartoes[0]!.y}`).not.toBe(`${m.cartoes[1]!.x},${m.cartoes[1]!.y}`);
  });

  it("trazer para a frente e fechar", () => {
    let m = abrir(vazia(), [c("a"), c("b")], AREA, 5);
    m = paraFrente(m, "a");
    expect(m.cartoes.find((x) => x.cartao.id === "a")!.z).toBe(m.proximoZ - 1);
    expect(paraFrente(m, "a")).toBe(m);
    expect(fechar(m, "a").cartoes.map((x) => x.cartao.id)).toEqual(["b"]);
  });
});
