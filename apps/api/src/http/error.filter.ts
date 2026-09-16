import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";
import { log } from "@orbita/core/observability/logger";

/**
 * Toda resposta de erro sai como `{ error: "mensagem" }`, o mesmo contrato das
 * rotas do Next: a UI e o mobile leem `error` e nada mais. Erro inesperado vira
 * 500 genérico (sem vazar stack) e vai para o log estruturado.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const message =
        typeof body === "string"
          ? body
          : ((body as { message?: string | string[] }).message ?? exception.message);
      res.status(exception.getStatus()).json({ error: Array.isArray(message) ? message[0] : message });
      return;
    }
    log.error("api.erro_inesperado", { error: exception instanceof Error ? exception.message : String(exception) });
    res.status(500).json({ error: "Erro interno" });
  }
}
