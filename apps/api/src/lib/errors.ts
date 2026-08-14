import type { ErrorCode } from "@yu-book/shared";

/** Erro esperado, com código estável. Qualquer outra exceção vira 500 genérico. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;

  constructor(statusCode: number, code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const unauthorized = (message = "Não autenticado") =>
  new AppError(401, "UNAUTHORIZED", message);

export const invalidCredentials = () =>
  new AppError(401, "INVALID_CREDENTIALS", "Email ou senha incorretos");

export const notFound = (message = "Não encontrado") => new AppError(404, "NOT_FOUND", message);
