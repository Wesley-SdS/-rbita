import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { isOwner } from "@orbita/core/owner";
import type { SessionUser } from "./session.guard";

/**
 * Só o DONO da instância passa (RV.1). Usar DEPOIS do SessionGuard, em rotas
 * que mudam o que vale para a casa inteira: ajustes globais, catálogo de tools,
 * posse. As outras contas da casa seguem usando a Órbita, só não mudam isso.
 */
@Injectable()
export class OwnerGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: SessionUser }>();
    if (!req.user || !(await isOwner(req.user.id))) {
      throw new ForbiddenException("Somente o dono desta instância pode alterar isto.");
    }
    return true;
  }
}
