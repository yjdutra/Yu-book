/** Códigos de erro estáveis — o front decide o que fazer por `code`, nunca pela mensagem. */
export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "INVALID_CREDENTIALS",
  "EMAIL_TAKEN",
  "SIGNUP_DISABLED",
  "UNAUTHORIZED",
  "TOKEN_EXPIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  /** RN-01: já existe uma nota ativa com esse título. */
  "TITULO_DUPLICADO",
  "NOME_DUPLICADO",
  /** RF-16: a coluna tem cards e a chamada não disse o que fazer com eles. */
  "COLUNA_COM_CARDS",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface FieldIssue {
  path: string;
  message: string;
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    issues?: FieldIssue[];
  };
}
