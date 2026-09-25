import type { AiHealth } from "@yu-book/shared";
import { env } from "../../env.js";
import { AppError } from "../../lib/errors.js";
import { pedirDoProvedor, rotuloPublico, temChave } from "./openrouter.service.js";

/**
 * Regra do módulo de IA (RF-01). O provedor é um só — OpenRouter —, e por isso
 * não existe interface abstrata aqui: com uma implementação, ela seria cerimônia
 * que ninguém exercita.
 */

/// Checagem de chave é leve; não vale esperar os 8 s do orçamento padrão.
const ORCAMENTO_SAUDE_MS = 5_000;

/**
 * RF-08: diz se o provedor responde, **sem executar inferência**.
 *
 * Não recebe `userId`, como as leituras do painel do OpenRouter
 * (`openrouter-painel.service.ts`). Não toca em dado de usuário: o que ela
 * responde é sobre o servidor, igual para todo mundo.
 * A rota continua exigindo autenticação.
 */
export async function saude(opcoes: { chave?: string | undefined } = {}): Promise<AiHealth> {
  /// Objeto, e não parâmetro com valor padrão como em `buscarTitulo`: um padrão
  /// é aplicado quando o argumento é `undefined`, então `saude(undefined)` cairia
  /// na chave do ambiente e o teste de "sem chave" passaria testando outra coisa.
  /// O `in` distingue "não informei" de "informei que não há".
  const chave = "chave" in opcoes ? opcoes.chave : env.OPENROUTER_API_KEY;
  const checkedAt = new Date().toISOString();

  /// Sem chave não há o que perguntar, e **nenhuma conexão é aberta** (CA-02).
  if (!temChave(chave)) {
    return { provider: "openrouter", configured: false, reachable: false, label: null, checkedAt };
  }

  try {
    const dados = await pedirDoProvedor<{ data?: { label?: unknown } }>("/key", {
      orcamentoMs: ORCAMENTO_SAUDE_MS,
      chave,
    });
    /// Redigido por `rotuloPublico`: o padrão do provedor é o prefixo da chave.
    return {
      provider: "openrouter",
      configured: true,
      reachable: true,
      label: rotuloPublico(dados.data?.label),
      checkedAt,
    };
  } catch (erro) {
    /// Só `AppError` vira "fora do ar". Qualquer outra exceção — a guarda que
    /// impede a suíte de falar com o provedor de verdade, por exemplo — precisa
    /// subir: um defeito nosso não pode se disfarçar de provedor indisponível.
    if (!(erro instanceof AppError)) throw erro;
    return { provider: "openrouter", configured: true, reachable: false, label: null, checkedAt };
  }
}
