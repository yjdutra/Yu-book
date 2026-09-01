import { z } from "zod";

/**
 * Mesmo padrão de `apps/api/src/env.ts`: valida no import e derruba o processo
 * se faltar variável. Falhar no boot é melhor que falhar na primeira chamada de
 * tool, quando o erro chega ao modelo como texto e ele tenta contornar.
 */
const envSchema = z.object({
  YUBOOK_API_URL: z.string().url().default("http://localhost:3333"),
  /**
   * A credencial fixa do servidor. Obrigatória em stdio e **proibida** em HTTP
   * — a validação condicional está no `superRefine` abaixo, e o motivo é o
   * assunto inteiro desta fase.
   */
  YUBOOK_EMAIL: z.string().email("YUBOOK_EMAIL inválido").optional(),
  YUBOOK_PASSWORD: z.string().min(1, "YUBOOK_PASSWORD não pode ser vazio").optional(),
  /**
   * Destrava a escrita contra uma API que não seja local. Opcional de
   * propósito: o padrão é o seguro, e sair dele custa uma decisão escrita.
   */
  YUBOOK_ESCRITA_REMOTA: z.string().optional(),
  /**
   * Qual transporte subir. `stdio` é o do desenvolvimento — um processo por
   * pessoa, iniciado pelo cliente MCP. `http` é o do serviço hospedado, que
   * atende muitos clientes e por isso não pode ter identidade no ambiente.
   */
  MCP_TRANSPORTE: z.enum(["stdio", "http"]).default("stdio"),
  /** Só no transporte http. A Railway injeta. */
  PORT: z.coerce.number().int().positive().default(3335),
  /**
   * Hosts aceitos pelo transporte http. Sem isto, um site qualquer pode fazer o
   * navegador de quem está na mesma rede falar com este servidor — é o ataque
   * de DNS rebinding, e o SDK só se defende se a lista existir.
   *
   * **Só o cabeçalho `Host`**, e comparando apenas o hostname. O
   * `hostHeaderValidation` do SDK 1.30 não olha `Origin`; quem fazia isso eram
   * as opções `allowedOrigins` do transporte, deprecadas na mesma versão.
   */
  MCP_HOSTS_PERMITIDOS: z.string().optional(),
  /**
   * Sessão parada por mais que isto é fechada pela varredura. Existe porque o
   * SDK **não** fecha a sessão quando o cliente some — ver `http.ts`.
   */
  MCP_SESSAO_TTL_MS: z.coerce.number().int().positive().default(30 * 60 * 1000),
  /** Teto duro de sessões vivas. Sem ele, o vazamento vira negação de serviço. */
  MCP_SESSOES_MAX: z.coerce.number().int().positive().default(100),
  /**
   * Chave de que saem a cifra dos envelopes e a assinatura dos tokens. Mesmo
   * padrão de tamanho do `JWT_SECRET` da API: curto demais derruba o boot, de
   * propósito.
   */
  MCP_SEGREDO: z.string().min(32, "MCP_SEGREDO precisa de pelo menos 32 caracteres").optional(),
  /**
   * O endereço público deste servidor. **Nunca derivar do header `Host`**: um
   * atacante manda `Host: evil.com` e o servidor anuncia o `token_endpoint`
   * dele no metadata de descoberta.
   */
  MCP_URL_PUBLICA: z.string().url().optional(),
  /** Desligamento global da escrita, sem deploy de código. */
  MCP_ESCRITA_HABILITADA: z.string().default("1"),
}).superRefine((valores, ctx) => {
  const erro = (path: string, message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

  if (valores.MCP_TRANSPORTE === "stdio") {
    // Em stdio a credencial no ambiente está certa: um processo, um usuário, e
    // o processo é seu. Não há navegador para um fluxo OAuth.
    if (!valores.YUBOOK_EMAIL) erro("YUBOOK_EMAIL", "obrigatório no transporte stdio");
    if (!valores.YUBOOK_PASSWORD) erro("YUBOOK_PASSWORD", "obrigatório no transporte stdio");
    return;
  }

  // Em HTTP, credencial de conta no ambiente de um servidor que atende muitos
  // clientes é **uma identidade só para todo mundo** — exatamente o que esta
  // fase existe para remover. Recusar o boot é melhor que subir errado.
  if (valores.YUBOOK_EMAIL || valores.YUBOOK_PASSWORD) {
    erro(
      "YUBOOK_EMAIL",
      "proibidos no transporte http: a identidade vem de quem chamou, não do ambiente. Remova " +
        "YUBOOK_EMAIL e YUBOOK_PASSWORD.",
    );
  }
  if (!valores.MCP_SEGREDO) erro("MCP_SEGREDO", "obrigatório no transporte http");
  if (!valores.MCP_URL_PUBLICA) erro("MCP_URL_PUBLICA", "obrigatório no transporte http");
});

/** Hosts em que escrever não custa nada se o modelo entender errado. */
const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

function ehLocal(url: string): boolean {
  try {
    return HOSTS_LOCAIS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Lista separada por vírgula, no mesmo formato do `CORS_ORIGIN` da API. */
function listaOuIndefinido(valor: string | undefined): string[] | undefined {
  if (!valor) return undefined;
  const itens = valor
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return itens.length > 0 ? itens : undefined;
}

const resultado = envSchema.safeParse(process.env);

if (!resultado.success) {
  // stderr, nunca stdout: em stdio o stdout é o canal do protocolo.
  console.error("Ambiente inválido para o servidor MCP do Yu-book:");
  for (const issue of resultado.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

const YUBOOK_API_URL = resultado.data.YUBOOK_API_URL.replace(/\/+$/, "");

export const env = {
  ...resultado.data,
  // Barra final atrapalha a concatenação de caminho.
  YUBOOK_API_URL,
  /**
   * Enquanto o servidor só lia, apontar para produção era inofensivo. Com tools
   * de escrita, um pedido mal interpretado cria dado de verdade no segundo
   * cérebro, e não existe desfazer deste lado. Por isso a escrita nasce
   * desligada fora de um host local: quem quiser escrever remoto declara.
   */
  escritaLiberada: ehLocal(YUBOOK_API_URL) || resultado.data.YUBOOK_ESCRITA_REMOTA === "1",
  apiEhLocal: ehLocal(YUBOOK_API_URL),
  ehHttp: resultado.data.MCP_TRANSPORTE === "http",
  hostsPermitidos: listaOuIndefinido(resultado.data.MCP_HOSTS_PERMITIDOS),
  /** Sem barra final: as URLs de metadata são montadas a partir dela. */
  urlPublica: resultado.data.MCP_URL_PUBLICA?.replace(/\/+$/, ""),
  escritaHabilitada: resultado.data.MCP_ESCRITA_HABILITADA !== "0",
};
