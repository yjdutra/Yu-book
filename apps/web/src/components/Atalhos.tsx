import { useRef } from "react";
import { Botao } from "./base/Botao";
import { Dialogo } from "./base/Dialogo";
import { Tecla } from "./base/Tecla";

const ATALHOS: { grupo: string; tecla: string; descricao: string }[] = [
  { grupo: "Geral", tecla: "Ctrl+K", descricao: "Buscar em notas e cards" },
  { grupo: "Geral", tecla: "Ctrl+N", descricao: "Nova nota" },
  { grupo: "Geral", tecla: "Ctrl+Shift+B", descricao: "Ir para os boards" },
  { grupo: "Geral", tecla: "Ctrl+Shift+L", descricao: "Abrir a gaveta de links" },
  { grupo: "Geral", tecla: "Ctrl+Shift+Y", descricao: "Abrir/fechar o painel do assistente" },
  { grupo: "Geral", tecla: "Ctrl+\\", descricao: "Recolher/mostrar o painel lateral" },
  { grupo: "Geral", tecla: "Ctrl+/", descricao: "Mostrar/esconder esta lista" },
  { grupo: "Geral", tecla: "Esc", descricao: "Fechar o que estiver aberto" },
  { grupo: "Geral", tecla: "Esc", descricao: "No painel do assistente, fechá-lo" },

  { grupo: "Nota", tecla: "Ctrl+S", descricao: "Salvar agora (sem esperar o autosave)" },
  { grupo: "Nota", tecla: "Ctrl+B", descricao: "Negrito" },
  { grupo: "Nota", tecla: "Ctrl+I", descricao: "Itálico" },
  { grupo: "Nota", tecla: "Ctrl+K", descricao: "Link (dentro do editor)" },
  { grupo: "Nota", tecla: "Ctrl+`", descricao: "Código" },
  { grupo: "Nota", tecla: "[[", descricao: "Vincular a outra nota" },
  { grupo: "Nota", tecla: "Enter", descricao: "Do título, pular para o corpo" },

  { grupo: "Board", tecla: "N", descricao: "Novo card na coluna com foco" },
  { grupo: "Board", tecla: "Espaço", descricao: "Pegar e soltar o card com foco" },
  { grupo: "Board", tecla: "↑ ↓ ← →", descricao: "Mover o card pego entre posições e colunas" },
  { grupo: "Board", tecla: "Esc", descricao: "Cancelar o movimento e devolver o card" },
  { grupo: "Board", tecla: "Enter", descricao: "Abrir o card" },

  { grupo: "Links", tecla: "arrastar", descricao: "Solte um link em qualquer lugar da janela" },
  { grupo: "Links", tecla: "← →", descricao: "Trocar entre favoritos e ver depois" },
  { grupo: "Links", tecla: "Enter", descricao: "Abrir o link em nova aba" },
  { grupo: "Links", tecla: "Del", descricao: "Remover o link com foco" },
  { grupo: "Links", tecla: "Ctrl+V", descricao: "Colar uma URL na aba visível" },
];

const GRUPOS = ["Geral", "Nota", "Board", "Links"] as const;

export function Atalhos({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  // O foco começa no título, não no primeiro botão: o único botão é "Fechar",
  // no fim de uma lista mais alta que a tela, e focá-lo rolaria a caixa até lá.
  const titulo = useRef<HTMLHeadingElement>(null);

  return (
    <Dialogo aberto={aberto} onFechar={onFechar} rotulo="Atalhos de teclado" focoInicial={titulo}>
      <div className="p-5">
        <h2 ref={titulo} tabIndex={-1} className="text-sm font-semibold text-titulo">
          Atalhos
        </h2>
        {GRUPOS.map((grupo) => (
          <section key={grupo}>
            <h3 className="rotulo mt-4">{grupo}</h3>
            <dl className="mt-2 space-y-2">
              {ATALHOS.filter((a) => a.grupo === grupo).map((a) => (
                <div key={`${a.tecla}-${a.descricao}`} className="flex items-baseline gap-3">
                  <dt className="w-28 shrink-0">
                    <Tecla combo={a.tecla} />
                  </dt>
                  <dd className="text-sm text-ink-400">{a.descricao}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <Botao onClick={onFechar} className="mt-5 w-full">
          Fechar
        </Botao>
      </div>
    </Dialogo>
  );
}
