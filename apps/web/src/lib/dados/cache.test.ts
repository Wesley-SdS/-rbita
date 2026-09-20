import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  definirBuscador,
  definirDado,
  garantir,
  inscrever,
  invalidar,
  lerCache,
  limparCache,
  mutarRecurso,
  restaurarDado,
} from "./cache";

/** Resposta de leitura falsa, no formato que o cache espera. */
function resposta(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

let chamadas: string[];
let responder: (url: string) => Promise<Response>;
let buscadorAntes: (url: string) => Promise<Response>;

beforeEach(() => {
  limparCache();
  chamadas = [];
  responder = async (url) => resposta({ url });
  buscadorAntes = definirBuscador(async (url) => {
    chamadas.push(url);
    return responder(url);
  });
});

afterEach(() => {
  definirBuscador(buscadorAntes);
  limparCache();
  vi.useRealTimers();
});

describe("garantir", () => {
  it("busca quando não há nada guardado", async () => {
    await garantir("/api/home/rooms", 1000);
    expect(chamadas).toEqual(["/api/home/rooms"]);
    expect(lerCache<{ url: string }>("/api/home/rooms").dado).toEqual({ url: "/api/home/rooms" });
  });

  it("NÃO busca de novo enquanto o dado está fresco", async () => {
    await garantir("/api/home/rooms", 10_000);
    await garantir("/api/home/rooms", 10_000);
    await garantir("/api/home/rooms", 10_000);
    expect(chamadas).toHaveLength(1);
  });

  it("busca de novo depois que o TTL vence", async () => {
    await garantir("/api/home/rooms", 10);
    await new Promise((r) => setTimeout(r, 25));
    await garantir("/api/home/rooms", 10);
    expect(chamadas).toHaveLength(2);
  });

  it("DEDUPLICA pedidos simultâneos na mesma chave", async () => {
    // é o caso da tela Casa: três painéis pedindo /api/home/rooms ao montar
    let soltar: (r: Response) => void = () => {};
    responder = () => new Promise<Response>((res) => (soltar = res));

    const trio = Promise.all([
      garantir("/api/home/rooms", 1000),
      garantir("/api/home/rooms", 1000),
      garantir("/api/home/rooms", 1000),
    ]);
    soltar(resposta({ rooms: [] }));
    await trio;

    expect(chamadas).toHaveLength(1);
  });

  it("forçar ignora o TTL", async () => {
    await garantir("/api/x", 10_000);
    await garantir("/api/x", 10_000, true);
    expect(chamadas).toHaveLength(2);
  });
});

describe("erro", () => {
  it("guarda a mensagem e MANTÉM o último dado bom na tela", async () => {
    await garantir("/api/home/rooms", 0);
    expect(lerCache("/api/home/rooms").dado).toBeTruthy();

    responder = async () => resposta({ error: "boom" }, 500);
    await garantir("/api/home/rooms", 0, true);

    const estado = lerCache<{ url: string }>("/api/home/rooms");
    expect(estado.erro).toContain("500");
    expect(estado.dado).toEqual({ url: "/api/home/rooms" }); // não apagou o que já estava lá
    expect(estado.carregando).toBe(false);
  });

  it("401 vira uma mensagem que a pessoa entende", async () => {
    responder = async () => resposta({}, 401);
    await garantir("/api/x", 0);
    expect(lerCache("/api/x").erro).toBe("Sessão expirada.");
  });

  it("rede caída não derruba o painel", async () => {
    responder = async () => {
      throw new Error("offline");
    };
    await garantir("/api/x", 0);
    expect(lerCache("/api/x").erro).toBe("offline");
    expect(lerCache("/api/x").carregando).toBe(false);
  });
});

describe("invalidar", () => {
  it("marca como vencido por PREFIXO", async () => {
    await garantir("/api/home/rooms", 10_000);
    await garantir("/api/home/entities", 10_000);
    await garantir("/api/todos", 10_000);

    invalidar("/api/home/");

    expect(lerCache("/api/home/rooms").em).toBe(0);
    expect(lerCache("/api/home/entities").em).toBe(0);
    expect(lerCache("/api/todos").em).toBeGreaterThan(0); // outro assunto, intacto
  });

  it("refaz na hora o que está na tela, e só deixa vencido o que ninguém vê", async () => {
    await garantir("/api/visivel", 10_000);
    await garantir("/api/escondido", 10_000);
    const soltar = inscrever("/api/visivel", () => {});
    chamadas = [];

    invalidar("/api/");
    await new Promise((r) => setTimeout(r, 0));

    expect(chamadas).toEqual(["/api/visivel"]);
    soltar();
  });

  it("avisa quem está inscrito", async () => {
    await garantir("/api/x", 10_000);
    const avisos = vi.fn();
    const soltar = inscrever("/api/x", avisos);
    invalidar("/api/x");
    expect(avisos).toHaveBeenCalled();
    soltar();
  });
});

describe("atualização otimista", () => {
  interface Lista {
    todos: { id: string; done: boolean }[];
  }
  const CHAVE = "/api/todos";

  beforeEach(async () => {
    responder = async () => resposta({ todos: [{ id: "a", done: false }] });
    await garantir(CHAVE, 10_000);
  });

  it("muda a tela na hora e confirma quando o servidor aceita", async () => {
    const r = await mutarRecurso<Lista>({
      chave: CHAVE,
      otimista: (atual) => ({ todos: (atual?.todos ?? []).map((t) => ({ ...t, done: true })) }),
      executar: async () => resposta({ ok: true }),
    });

    expect(r.ok).toBe(true);
    expect(lerCache<Lista>(CHAVE).dado?.todos[0]?.done).toBe(true);
    expect(lerCache(CHAVE).em).toBe(0); // invalidado: a próxima leitura confere com o servidor
  });

  it("DESFAZ quando o servidor recusa, e explica o porquê", async () => {
    const r = await mutarRecurso<Lista>({
      chave: CHAVE,
      otimista: (atual) => ({ todos: (atual?.todos ?? []).map((t) => ({ ...t, done: true })) }),
      executar: async () => resposta({ error: "Tarefa não é sua" }, 403),
    });

    expect(r).toEqual({ ok: false, erro: "Tarefa não é sua" });
    expect(lerCache<Lista>(CHAVE).dado?.todos[0]?.done).toBe(false); // voltou como estava
  });

  it("desfaz também quando a requisição nem sai", async () => {
    const r = await mutarRecurso<Lista>({
      chave: CHAVE,
      otimista: () => ({ todos: [] }),
      executar: async () => {
        throw new Error("sem rede");
      },
    });

    expect(r.ok).toBe(false);
    expect(lerCache<Lista>(CHAVE).dado?.todos).toHaveLength(1);
  });

  it("invalida também as leituras vizinhas que a mutação envelheceu", async () => {
    await garantir("/api/home/rooms", 10_000);
    await mutarRecurso<Lista>({
      chave: CHAVE,
      otimista: () => ({ todos: [] }),
      executar: async () => resposta({ ok: true }),
      invalida: ["/api/home/rooms"],
    });
    expect(lerCache("/api/home/rooms").em).toBe(0);
  });
});

describe("definirDado e restaurarDado", () => {
  it("definir devolve como estava, para poder desfazer", async () => {
    await garantir("/api/x", 10_000);
    const antes = definirDado<{ url: string }>("/api/x", () => ({ url: "mexido" }));
    expect(antes).toEqual({ url: "/api/x" });
    expect(lerCache<{ url: string }>("/api/x").dado).toEqual({ url: "mexido" });

    restaurarDado("/api/x", antes);
    expect(lerCache<{ url: string }>("/api/x").dado).toEqual({ url: "/api/x" });
  });

  it("funciona em chave que ainda não existe", () => {
    const antes = definirDado<number[]>("/api/novo", (atual) => [...(atual ?? []), 1]);
    expect(antes).toBeNull();
    expect(lerCache<number[]>("/api/novo").dado).toEqual([1]);
  });
});

describe("limparCache", () => {
  it("apaga tudo e avisa quem estava olhando (sair da conta)", async () => {
    await garantir("/api/x", 10_000);
    const avisos = vi.fn();
    const soltar = inscrever("/api/x", avisos);

    limparCache();

    expect(lerCache("/api/x").dado).toBeNull();
    expect(avisos).toHaveBeenCalled();
    soltar();
  });
});

describe("lerCache", () => {
  it("chave nula devolve sempre a MESMA referência (evita laço de render)", () => {
    expect(lerCache(null)).toBe(lerCache(null));
  });

  it("chave desconhecida também", () => {
    expect(lerCache("/api/nunca")).toBe(lerCache("/api/jamais"));
  });
});
