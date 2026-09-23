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
  /** RF-06: sem chave configurada, ou o provedor não respondeu. */
  "PROVEDOR_INDISPONIVEL",
  /** RF-07: o teto de tempo da chamada ao provedor estourou. */
  "PROVEDOR_DEMOROU",
  /** RF-06: o provedor recusou por crédito — é a cota dele, não o teto daqui. */
  "COTA_EXCEDIDA",
  /** O teto diário do Yu-book cortou, antes de qualquer chamada sair. */
  "TETO_DIARIO_ATINGIDO",
  /** A tarefa de IA não tem modelo padrão escolhido. */
  "MODELO_NAO_ESCOLHIDO",
  /**
   * O modelo escolhido para o chat não sabe chamar ferramenta. Separado de
   * `MODELO_NAO_ESCOLHIDO` porque o que se pede a quem está na tela é outro:
   * lá é escolher um modelo, aqui é trocar por um que suporte `tools` — e a
   * bandeira `supportsTools` do favorito diz quais são, desde a Etapa A.
   */
  "MODELO_SEM_FERRAMENTA",
  /** RN-06: o modelo alterou um [[wikilink]] — a resposta foi descartada. */
  "RESPOSTA_INVALIDA",
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
