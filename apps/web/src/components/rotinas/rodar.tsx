import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { execucaoEmAndamento, useRodarRotina, useRotinas } from "../../lib/rotinas";
import { Aviso } from "../base/Aviso";

/** Onde se acompanha uma execução. */
export const rotaDaExecucao = (routineId: string | null, runId: string) =>
  routineId
    ? `/assistente/rotinas/${routineId}/execucoes/${runId}`
    : `/assistente/execucoes/${runId}`;

interface ErroAoRodar {
  code: string;
  mensagem: string;
}

/**
 * "Rodar agora", o mesmo na galeria e no editor: inicia e leva à tela que
 * acompanha. A recusa fica na tela, com o que fazer — ramificada pelo `code`,
 * nunca pela mensagem.
 */
export function useRodar() {
  const navigate = useNavigate();
  const rodar = useRodarRotina();
  const [erro, setErro] = useState<ErroAoRodar | null>(null);
  const [rodando, setRodando] = useState<string | null>(null);

  async function iniciar(routineId: string) {
    setErro(null);
    setRodando(routineId);
    try {
      const { runId } = await rodar.mutateAsync(routineId);
      navigate(rotaDaExecucao(routineId, runId));
    } catch (e) {
      setErro(
        e instanceof ApiError
          ? { code: e.code, mensagem: e.message }
          : { code: "INTERNAL_ERROR", mensagem: "Não foi possível iniciar a rotina." },
      );
    } finally {
      setRodando(null);
    }
  }

  return { iniciar, rodando, erro, limpar: () => setErro(null) };
}

/** A recusa de "Rodar agora", com o caminho para resolver. */
export function AvisoAoRodar({ erro, onFechar }: { erro: ErroAoRodar; onFechar: () => void }) {
  const { data: rotinas } = useRotinas();
  const viva = execucaoEmAndamento(rotinas);
  return (
    <Aviso tom={erro.code === "SEM_IDEIA" ? "alerta" : "erro"} onFechar={onFechar}>
      {erro.code === "SEM_IDEIA"
        ? "Nenhuma ideia para pegar: a coluna de entrada está vazia, ou todas as ideias " +
          "dela já passaram por esta rotina."
        : erro.mensagem}
      {erro.code === "ROTINA_EM_ANDAMENTO" && viva?.lastRun && (
        <>
          {" "}
          <Link
            to={rotaDaExecucao(viva.id, viva.lastRun.id)}
            className="font-medium underline underline-offset-2"
          >
            Acompanhar «{viva.name}»
          </Link>
        </>
      )}
      {erro.code === "TETO_DIARIO_ATINGIDO" && (
        <>
          {" "}
          <Link to="/ajustes/gasto" className="font-medium underline underline-offset-2">
            Ver o gasto do dia
          </Link>
        </>
      )}
    </Aviso>
  );
}
