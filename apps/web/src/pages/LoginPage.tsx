import { loginSchema, registerSchema } from "@yu-book/shared";
import { useState } from "react";
import type { FormEvent } from "react";
import { ZodError } from "zod";
import { Aviso } from "../components/base/Aviso";
import { Botao } from "../components/base/Botao";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

type Mode = "login" | "register";

// O `outline-none` tem substituto: a borda que acende no foco (RNF-08).
const inputClass =
  "w-full rounded-controle border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-200 " +
  "outline-none transition-colors placeholder:text-ink-400/60 focus:border-accent-400";

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
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm animate-surgir rounded-dialogo bg-superficie p-8 shadow-e3">
        <header className="mb-8 flex items-center gap-3">
          {/* A marca é enfeite: o nome vem escrito ao lado, no `h1`. */}
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-controle
                       bg-linear-to-br from-accent-500 to-ia-500 text-sm font-semibold
                       text-white shadow-e1"
          >
            Yu
          </span>
          <div>
            <h1 className="text-2xl font-semibold text-titulo">Yu-book</h1>
            <p className="mt-0.5 text-sm text-ink-400">
              {mode === "login" ? "Entre para continuar." : "Crie sua conta."}
            </p>
          </div>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "register" && (
            <div>
              <label htmlFor="name" className="mb-1 block text-xs text-ink-400">
                Nome
              </label>
              <input id="name" name="name" autoComplete="name" className={inputClass} />
            </div>
          )}

          <div>
            <label htmlFor="email" className="mb-1 block text-xs text-ink-400">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-xs text-ink-400">
              Senha
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              className={inputClass}
            />
          </div>

          {error && <Aviso tom="erro">{error}</Aviso>}

          <Botao type="submit" variante="primario" tamanho="m" carregando={busy} className="w-full">
            {mode === "login" ? "Entrar" : "Criar conta"}
          </Botao>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
          className="mt-6 w-full text-center text-xs text-ink-400 hover:text-ink-200"
        >
          {mode === "login" ? "Ainda não tem conta? Criar" : "Já tenho conta"}
        </button>
      </div>
    </main>
  );
}
