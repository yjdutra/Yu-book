import { ApiError } from "@yu-book/cliente/api";
import { useAuth } from "@yu-book/cliente/auth";
import { Aviso } from "@yu-book/cliente/base/Aviso";
import { Botao } from "@yu-book/cliente/base/Botao";
import { loginSchema, registerSchema } from "@yu-book/shared";
import { useState } from "react";
import type { FormEvent } from "react";
import { ZodError } from "zod";
import { Marca } from "../components/Marca";

type Mode = "login" | "register";

// 16px de fonte (`text-base`): abaixo disso o navegador do celular amplia a
// página ao focar o campo. O `outline-none` tem substituto: a borda que acende
// no foco (RNF-08).
const inputClass =
  "h-12 w-full rounded-cartao border border-ink-700 bg-superficie px-4 text-base text-ink-200 " +
  "shadow-e1 outline-none transition-colors placeholder:text-ink-400/60 focus:border-accent-400";

/**
 * O mesmo fluxo do login do web — mesmos schemas, o mesmo `AuthProvider`,
 * ramificando por `code` —, com o desenho de celular: a marca no alto, campos
 * e botão grandes, e a troca de modo no pé, ao alcance do polegar.
 */
export function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const form = new FormData(event.currentTarget);
    const raw = {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      name: String(form.get("name") ?? ""),
    };

    try {
      // Mesmo schema Zod da API: erro de formato aparece antes da requisição.
      if (mode === "register") {
        await register(registerSchema.parse(raw));
      } else {
        await login(loginSchema.parse({ email: raw.email, password: raw.password }));
      }
    } catch (caught) {
      if (caught instanceof ZodError) {
        setError(caught.issues[0]?.message ?? "Dados inválidos");
      } else if (caught instanceof ApiError) {
        setError(
          caught.code === "SIGNUP_DISABLED"
            ? "Cadastro fechado nesta instância."
            : caught.issues[0]?.message ?? caught.message,
        );
      } else {
        setError("Não foi possível conectar à API.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative isolate min-h-dvh">
      <div aria-hidden="true" className="veu-topo absolute inset-x-0 top-0 -z-10 h-96" />
      <main
        className="mx-auto flex min-h-dvh w-full max-w-sm flex-col px-6
                   pb-[calc(env(safe-area-inset-bottom)+1.5rem)]
                   pt-[calc(env(safe-area-inset-top)+4rem)]"
      >
        <header className="animate-surgir">
          <Marca className="size-16 drop-shadow-lg" />
          <h1 className="mt-6 text-3xl font-semibold tracking-tight text-titulo">Yu-book</h1>
          <p className="mt-1.5 text-base text-ink-400">
            {mode === "login" ? "Entre para continuar." : "Crie sua conta."}
          </p>
        </header>

        <form onSubmit={handleSubmit} className="mt-10 space-y-5">
          {mode === "register" && (
            <div>
              <label htmlFor="name" className="mb-1.5 block text-sm text-ink-400">
                Nome
              </label>
              <input
                id="name"
                name="name"
                autoComplete="name"
                autoCapitalize="words"
                enterKeyHint="next"
                className={inputClass}
              />
            </div>
          )}

          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm text-ink-400">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm text-ink-400">
              Senha
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              enterKeyHint="go"
              className={inputClass}
            />
          </div>

          {error && <Aviso tom="erro">{error}</Aviso>}

          <Botao
            type="submit"
            variante="primario"
            tamanho="g"
            carregando={busy}
            className="w-full"
          >
            {mode === "login" ? "Entrar" : "Criar conta"}
          </Botao>
        </form>

        <div className="mt-auto pt-8">
          <button
            type="button"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(null);
            }}
            className="min-h-11 w-full rounded-controle text-center text-sm text-ink-400
                       transition-colors hover:text-ink-200"
          >
            {mode === "login" ? "Ainda não tem conta? Criar" : "Já tenho conta"}
          </button>
        </div>
      </main>
    </div>
  );
}
