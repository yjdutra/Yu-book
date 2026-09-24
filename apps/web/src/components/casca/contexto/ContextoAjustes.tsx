import { useLocation, useNavigate } from "react-router-dom";
import { SECOES_DE_AJUSTES } from "../../ajustes/comum";
import { Item, Titulo } from "../partes";

/** Área Ajustes: as seções da tela de IA. */
export function ContextoAjustes() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <>
      <Titulo>Inteligência artificial</Titulo>
      <div className="space-y-0.5">
        {SECOES_DE_AJUSTES.map((s) => (
          <Item
            key={s.caminho}
            ativo={pathname.startsWith(`/ajustes/${s.caminho}`)}
            onClick={() => navigate(`/ajustes/${s.caminho}`)}
          >
            {s.titulo}
          </Item>
        ))}
      </div>
    </>
  );
}
