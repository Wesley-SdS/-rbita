import { All, Controller, Req, Res } from "@nestjs/common";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import { bridge } from "./bridge";
import type { RouteCtx, RouteHandler } from "./web";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type RouteHandlers = Partial<Record<Method, RouteHandler>>;

/**
 * Fábrica de controller para uma rota migrada em PARIDADE: a rota continua
 * sendo um módulo com `GET`/`POST`/… na assinatura Web (a mesma do Next), e o
 * Nest só faz a borda. Um controller por caminho; método sem handler → 405.
 *
 * Os decoradores são aplicados programaticamente porque o TypeScript não aceita
 * decorador em classe criada dentro de função, e cada rota precisa da PRÓPRIA
 * classe (o Nest usa a classe como identidade do controller).
 */
export function webRoute(path: string, handlers: RouteHandlers) {
  class WebRouteController {
    all(req: ExpressRequest, res: ExpressResponse) {
      const h = handlers[req.method as Method];
      if (!h) {
        res.status(405).json({ error: "Método não permitido" });
        return;
      }
      return bridge(req, res, h);
    }
  }
  Object.defineProperty(WebRouteController, "name", { value: `Route_${path.replace(/\W+/g, "_")}` });
  Req()(WebRouteController.prototype, "all", 0);
  Res()(WebRouteController.prototype, "all", 1);
  All()(WebRouteController.prototype, "all", Object.getOwnPropertyDescriptor(WebRouteController.prototype, "all")!);
  Controller(path)(WebRouteController);
  return WebRouteController;
}

/** `{ user }` ou null: mesmo formato que `getSession()` devolvia nas rotas do Next. */
export function sessionOf(ctx: RouteCtx): { user: NonNullable<RouteCtx["user"]> } | null {
  return ctx.user ? { user: ctx.user } : null;
}
