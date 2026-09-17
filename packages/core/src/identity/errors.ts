/** Erro de domínio de identidade com status HTTP sugerido (a rota só repassa). */
export class IdentityError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = "IdentityError";
  }
}
