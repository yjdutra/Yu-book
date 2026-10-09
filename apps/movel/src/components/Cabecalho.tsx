import { useAuth } from "@yu-book/cliente/auth";
import { primeiroNome, saudacao } from "../lib/saudacao";
import { Conta } from "./Conta";

/**
 * Cabeçalho de toda área: no Início, a saudação com o nome; nas outras, o
 * nome da área. O avatar da conta mora sempre à direita.
 */
export function Cabecalho({ titulo, inicio }: { titulo: string; inicio: boolean }) {
  const { user } = useAuth();

  return (
    <header className="flex items-center justify-between gap-4 pb-6">
      {inicio ? (
        <h1 className="min-w-0">
          <span className="block text-sm text-ink-400">{saudacao(new Date().getHours())},</span>
          <span className="block truncate text-2xl font-semibold tracking-tight text-titulo">
            {primeiroNome(user?.name ?? "")}
          </span>
        </h1>
      ) : (
        <h1 className="truncate text-2xl font-semibold tracking-tight text-titulo">{titulo}</h1>
      )}
      <Conta />
    </header>
  );
}
