import { useNavigate } from "react-router-dom";
import { useConversas } from "../../../lib/chat";
import { useBoards } from "../../../lib/kanban";
import { FILTROS_VAZIOS, useNotas } from "../../../lib/notas";
import { useAcoesChat } from "../../../lib/sessaoChat";
import { useWorkspaceAtivo } from "../../../lib/workspace";
import { IconeAssistente, IconeBoard, IconeEstrela } from "../../Icones";
import { Item, Titulo } from "../partes";

const MAX_FAVORITAS = 5;
const MAX_CONVERSAS = 3;

/**
 * Área Início: atalhos para o que se abre sempre — as favoritas e os boards do
 * workspace. O painel central (dashboard) responde "o que precisa de mim
 * agora"; este responde "onde eu costumo ir".
 */
export function ContextoInicio() {
  const navigate = useNavigate();
  const { ativoId } = useWorkspaceAtivo();
  const { data: boards } = useBoards(ativoId);
  const { data: paginas } = useNotas({ ...FILTROS_VAZIOS, favorite: true, workspaceId: ativoId });
  const favoritas = paginas?.pages[0]?.items.slice(0, MAX_FAVORITAS) ?? [];
  const { data: conversas } = useConversas();
  const { selecionar } = useAcoesChat();
  const recentes = (conversas ?? []).slice(0, MAX_CONVERSAS);

  return (
    <>
      <Titulo
        acao={
          <button
            type="button"
            onClick={() => navigate("/n?favoritas=1")}
            className="rounded-etiqueta px-1.5 text-miudo text-ink-400 hover:text-ink-200"
          >
            ver todas
          </button>
        }
      >
        Favoritas
      </Titulo>
      {favoritas.length === 0 ? (
        <p className="px-2.5 py-1 text-xs text-ink-400/70">Nenhuma nota favorita ainda.</p>
      ) : (
        <div className="space-y-0.5">
          {favoritas.map((n) => (
            <Item key={n.id} ativo={false} onClick={() => navigate(`/n/${n.id}`)}>
              <IconeEstrela className="size-3.5 text-amber-400" />
              <span className="truncate">{n.title}</span>
            </Item>
          ))}
        </div>
      )}

      <Titulo>Boards</Titulo>
      {boards?.length === 0 && (
        <p className="px-2.5 py-1 text-xs text-ink-400/70">Nenhum board ainda.</p>
      )}
      <div className="space-y-0.5">
        {boards?.map((b) => (
          <Item
            key={b.id}
            ativo={false}
            onClick={() => navigate(`/b/${b.id}`)}
            contagem={b.cardCount}
          >
            <IconeBoard className="size-3.5" style={{ color: b.workspaceColor }} />
            <span className="truncate">{b.name}</span>
          </Item>
        ))}
      </div>

      {recentes.length > 0 && (
        <>
          <Titulo>Conversas recentes</Titulo>
          <div className="space-y-0.5">
            {recentes.map((c) => (
              <Item
                key={c.id}
                ativo={false}
                onClick={() => {
                  selecionar(c.id);
                  navigate("/assistente");
                }}
              >
                <IconeAssistente className="size-3.5 text-accent-400" />
                <span className="truncate">{c.title}</span>
              </Item>
            ))}
          </div>
        </>
      )}
    </>
  );
}
