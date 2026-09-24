import { useLocation, useNavigate } from "react-router-dom";
import { useBoards } from "../../../lib/kanban";
import { useWorkspaceAtivo } from "../../../lib/workspace";
import { IconeBoard } from "../../Icones";
import { Item, Titulo } from "../partes";

/** Área Boards. RF-11 da Fase 2: os boards do workspace ativo; sem ativo, todos. */
export function ContextoBoards() {
  const { ativo, ativoId } = useWorkspaceAtivo();
  const { data: boards } = useBoards(ativoId);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <>
      <Item ativo={pathname === "/b"} onClick={() => navigate("/b")}>
        <IconeBoard />
        Todos os boards
      </Item>

      <Titulo>{ativo ? ativo.name : "Boards"}</Titulo>
      {boards?.length === 0 && (
        <p className="px-2.5 py-1 text-xs text-ink-400/70">
          {ativo ? `Nenhum board em ${ativo.name}.` : "Nenhum board ainda."}
        </p>
      )}
      <div className="space-y-0.5">
        {boards?.map((b) => (
          <Item
            key={b.id}
            ativo={pathname.startsWith(`/b/${b.id}`)}
            onClick={() => navigate(`/b/${b.id}`)}
            contagem={b.cardCount}
          >
            {/* A cor do workspace vem no próprio ícone: uma marca só, não duas. */}
            <IconeBoard className="size-3.5" style={{ color: b.workspaceColor }} />
            <span className="truncate">{b.name}</span>
          </Item>
        ))}
      </div>
    </>
  );
}
