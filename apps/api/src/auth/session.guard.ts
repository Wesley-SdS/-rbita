import { Injectable, UnauthorizedException, createParamDecorator, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "@orbita/core/auth";

/**
 * Sessão do dono, validada pela MESMA instância do Better Auth que o Next usa
 * (mesmo segredo, mesmo banco). O cookie chega intacto porque o Next encaminha
 * /api/* para cá na mesma origem. Sem token S2S: decisão da Onda 1.
 */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

@Injectable()
export class SessionGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: SessionUser }>();
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) }).catch(() => null);
    if (!session) throw new UnauthorizedException("Não autenticado");
    req.user = { id: session.user.id, email: session.user.email, name: session.user.name };
    return true;
  }
}

/** `@CurrentUser() user: SessionUser` num handler protegido pelo SessionGuard. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): SessionUser => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: SessionUser }>();
  if (!req.user) throw new UnauthorizedException("Não autenticado");
  return req.user;
});
