import { NOTE_KINDS } from "@yu-book/shared";
import type { NoteKind } from "@yu-book/shared";
import { useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useBoards } from "../lib/kanban";
import { useContadores, useTags } from "../lib/notas";
import type { Filtros } from "../lib/notas";
import { useSecao } from "../lib/secoes";
import { casaTermo } from "../lib/tags";
import { useWorkspaceAtivo } from "../lib/workspace";
import {
  ICONE_TIPO,
  IconeBoard,
  IconeEstrela,
  IconeInfo,
  IconeInicio,
  IconeLink,
  IconeLixeira,
  IconeNotas,
  IconeSeta,
  IconeTag,
} from "./Icones";
import { SeletorTema } from "./SeletorTema";
import { SeletorWorkspace } from "./SeletorWorkspace";

interface NavegacaoProps {
  filtros: Filtros;
  onFiltros: (f: Filtros) => void;
  onNovaNota: () => void;
  onAbrirGaveta: () => void;
  /** Abre o modal de atalhos — o mesmo do Ctrl+/ (RNF-01). */
  onAbrirAtalhos: () => void;
  /** Quantos itens esperam na fila de "ver depois" (RF-16). */
  linksParaVer: number;
}

function Item({
  ativo,
  onClick,
  children,
  contagem,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
  contagem?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={ativo ? "true" : undefined}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm
                  transition-colors ${
                    ativo ? "bg-ink-700 text-titulo" : "text-ink-400 hover:bg-ink-800 hover:text-ink-200"
                  }`}
    >
      {children}
      {contagem !== undefined && (
        <span className="ml-auto text-xs tabular-nums text-ink-400">{contagem}</span>
      )}
    </button>
  );
}

/**
 * Cabeçalho de seção não recolhível (Boards). O recuo à esquerda é o mesmo que
 * a seta das seções recolhíveis ocupa, para todos os títulos se alinharem.
 */
function Titulo({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-5 pl-6 pr-2 text-[10px] font-medium uppercase tracking-wider text-ink-400">
      {children}
    </p>
  );
}

/**
 * Seção recolhível da navegação.
 *
 * Recolher esconde os itens, então o cabeçalho precisa continuar dizendo o que
 * ficou escondido: `resumo` é o que aparece no lugar deles quando a seção está
 * fechada — sem isso, um filtro ativo sumiria da vista sem deixar de valer.
 */
function Secao({
  titulo,
  chave,
  contagem,
  resumo,
  children,
}: {
  titulo: string;
  chave: string;
  contagem?: number;
  resumo?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [aberta, alternar] = useSecao(chave);
  const id = `secao-${chave}`;

  return (
    <section className="mt-4">
      <button
        type="button"
        onClick={alternar}
        aria-expanded={aberta}
        aria-controls={id}
        className="flex w-full items-center gap-1 rounded px-2 py-1 text-[10px] font-medium
                   uppercase tracking-wider text-ink-400 transition-colors hover:bg-ink-800
                   hover:text-ink-200"
      >
        <IconeSeta aberta={aberta} />
        <span>{titulo}</span>
        {!aberta && resumo}
        {contagem !== undefined && <span className="ml-auto tabular-nums">{contagem}</span>}
      </button>
      <div id={id} hidden={!aberta}>
        {children}
      </div>
    </section>
  );
}

export function Navegacao({
  filtros,
  onFiltros,
  onNovaNota,
  onAbrirGaveta,
  onAbrirAtalhos,
  linksParaVer,
}: NavegacaoProps) {
  const { user, logout } = useAuth();
  const { ativoId, ativo } = useWorkspaceAtivo();
  const { data: contadores } = useContadores(ativoId);
  const { data: tags } = useTags();
  const { data: boards } = useBoards(ativoId);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const emNotas = pathname.startsWith("/n");
  const noInicio = pathname === "/";

  /**
   * Filtro de nota escolhido fora da tela de notas leva de volta para elas —
   * senão o clique não teria efeito visível.
   */
  const aplicar = (extra: Partial<Filtros>) => {
    onFiltros({
      ...filtros,
      kind: null,
      favorite: false,
      trash: false,
      tags: [],
      ...extra,
    });
    if (!emNotas) navigate("/n");
  };

  const nenhumFiltro =
    !filtros.kind && !filtros.favorite && !filtros.trash && filtros.tags.length === 0;

  const tipoAtivo = emNotas ? filtros.kind : null;
  const IconeTipoAtivo = tipoAtivo ? ICONE_TIPO[tipoAtivo] : null;
  const tagsAtivas = emNotas ? filtros.tags.length : 0;

  return (
    <nav className="flex h-full flex-col p-3">
      <div className="mb-3 flex items-center justify-between px-2">
        <h1 className="text-sm font-semibold text-titulo">Yu-book</h1>
        <button
          type="button"
          onClick={onNovaNota}
          title="Nova nota (Ctrl+N)"
          aria-label="Nova nota"
          className="rounded bg-accent-500 px-2 py-0.5 text-sm font-medium text-white
                     transition hover:bg-accent-400"
        >
          +
        </button>
      </div>

      {/* RF-01: o contexto da aplicação inteira vive aqui, no topo. */}
      <SeletorWorkspace />

      <div className="mt-3">
        {/* RF-02: a porta de entrada da aplicação. */}
        <Item ativo={noInicio} onClick={() => navigate("/")}>
          <IconeInicio />
          Início
        </Item>
        <Item ativo={emNotas && nenhumFiltro} onClick={() => aplicar({})} contagem={contadores?.total}>
          <IconeNotas />
          Todas as notas
        </Item>
        <Item
          ativo={emNotas && filtros.favorite}
          onClick={() => aplicar({ favorite: true })}
          contagem={contadores?.favorites}
        >
          <IconeEstrela />
          Favoritas
        </Item>
      </div>

      <Secao
        titulo="Tipos"
        chave="tipos"
        resumo={
          IconeTipoAtivo && (
            <span className="flex items-center gap-1 text-accent-400" title={`Filtrando: ${tipoAtivo}`}>
              <IconeTipoAtivo className="size-3" />
              <span className="normal-case tracking-normal">{tipoAtivo}</span>
            </span>
          )
        }
      >
        {NOTE_KINDS.map((tipo: NoteKind) => {
          const IconeDoTipo = ICONE_TIPO[tipo];
          return (
            <Item
              key={tipo}
              ativo={emNotas && filtros.kind === tipo}
              onClick={() => aplicar({ kind: tipo })}
              contagem={contadores?.byKind[tipo]}
            >
              <IconeDoTipo />
              <span className="capitalize">{tipo}</span>
            </Item>
          );
        })}
      </Secao>

      <div className="flex items-center justify-between">
        <Titulo>Boards</Titulo>
        <button
          type="button"
          onClick={() => navigate("/b")}
          title="Todos os boards (Ctrl+Shift+B)"
          aria-current={pathname === "/b" ? "true" : undefined}
          className="mt-5 rounded px-2 text-[10px] uppercase tracking-wider text-ink-400
                     hover:text-ink-200"
        >
          ver todos
        </button>
      </div>

      {/* RF-11: os boards do workspace ativo. Sem workspace ativo, todos. */}
      {boards?.length === 0 && (
        <p className="px-2 py-1 text-xs text-ink-400/70">
          {ativo ? `Nenhum board em ${ativo.name}.` : "Nenhum board ainda."}
        </p>
      )}
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

      {tags && tags.length > 0 && (
        /* As tags são muitas e sem ordem fixa: viram um cartão à parte, que se
           fecha inteiro quando o que importa na tela é outra coisa. */
        <div className="mt-4 rounded-lg border border-ink-700 bg-ink-800/40">
          <CartaoTags
            tags={tags}
            ativas={emNotas ? filtros.tags : []}
            quantidadeAtiva={tagsAtivas}
            onAlternarTag={(nome) => {
              onFiltros({
                ...filtros,
                trash: false,
                tags: filtros.tags.includes(nome)
                  ? filtros.tags.filter((n) => n !== nome)
                  : [...filtros.tags, nome],
              });
              if (!emNotas) navigate("/n");
            }}
          />
        </div>
      )}

      <div className="mt-auto pt-4">
        {/* RF-16: a gaveta é sobreposta, então aqui é só a porta de entrada. */}
        <Item ativo={false} onClick={onAbrirGaveta} contagem={linksParaVer || undefined}>
          <IconeLink />
          <span title="Ctrl+Shift+L">Links</span>
        </Item>
        <Item
          ativo={emNotas && filtros.trash}
          onClick={() => aplicar({ trash: true })}
          contagem={contadores?.trash}
        >
          <IconeLixeira />
          Lixeira
        </Item>
        <div className="mt-2 flex items-center gap-1 px-2">
          <span className="min-w-0 flex-1 truncate text-xs text-ink-400">{user?.name}</span>
          <button
            type="button"
            onClick={onAbrirAtalhos}
            title="Atalhos de teclado (Ctrl+/)"
            className="flex items-center rounded px-1.5 py-0.5 text-ink-400 transition
                       hover:bg-ink-800 hover:text-ink-200"
          >
            <IconeInfo className="size-3.5" />
            <span className="sr-only">Atalhos de teclado</span>
          </button>
          <SeletorTema />
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded px-1.5 py-0.5 text-xs text-ink-400 transition hover:bg-ink-800
                       hover:text-ink-200"
          >
            sair
          </button>
        </div>
      </div>
    </nav>
  );
}

/** Conteúdo do cartão de tags — separado só para ter o seu próprio recolhido. */
function CartaoTags({
  tags,
  ativas,
  quantidadeAtiva,
  onAlternarTag,
}: {
  tags: { id: string; name: string; noteCount: number }[];
  ativas: string[];
  quantidadeAtiva: number;
  onAlternarTag: (nome: string) => void;
}) {
  const [aberto, alternar] = useSecao("tags");
  const [busca, setBusca] = useState("");
  const listaRef = useRef<HTMLDivElement>(null);

  /**
   * RF-13 / RF-14: filtra sem acento e sem caixa, mas **uma tag ativa nunca
   * some**. Esconder um filtro que está valendo faria a tela mentir sobre o
   * que a lista de notas está mostrando.
   */
  const visiveis = useMemo(
    () => tags.filter((t) => ativas.includes(t.name) || casaTermo(t.name, busca)),
    [tags, ativas, busca],
  );

  return (
    <>
      <button
        type="button"
        onClick={alternar}
        aria-expanded={aberto}
        aria-controls="secao-tags"
        className="flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-medium
                   uppercase tracking-wider text-ink-400 transition-colors hover:text-ink-200"
      >
        <IconeSeta aberta={aberto} />
        <IconeTag className="size-3.5" />
        <span>Tags</span>
        {/* Fechado, o cartão ainda avisa que há filtro de tag valendo. */}
        {!aberto && quantidadeAtiva > 0 && (
          <span className="rounded-full bg-accent-500 px-1.5 text-[10px] text-white">
            {quantidadeAtiva}
          </span>
        )}
        <span className="ml-auto tabular-nums">{tags.length}</span>
      </button>

      <div id="secao-tags" hidden={!aberto} className="px-2 pb-2">
        {/* RF-12: o campo fica dentro do cartão, acima da lista. Não rouba foco
            ao abrir — abrir o cartão é para olhar, não necessariamente digitar. */}
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            // RF-16: primeiro limpa; já vazio, o Esc devolve o foco à lista.
            // Sem nenhum dos dois para fazer, deixa o Esc seguir para quem
            // tiver algo aberto na tela.
            const primeira = listaRef.current?.querySelector("button");
            if (!busca && !primeira) return;
            e.stopPropagation();
            e.preventDefault();
            if (busca) setBusca("");
            else primeira?.focus();
          }}
          placeholder="filtrar tags…"
          aria-label="Filtrar tags"
          className="mb-1.5 w-full rounded bg-ink-800 px-2 py-1 text-[11px] text-ink-200
                     outline-none placeholder:text-ink-400/60 focus:ring-1 focus:ring-accent-400"
        />

        {/* RF-15: só faz sentido dizer o recorte quando existe um recorte. */}
        {busca && (
          <p className="mb-1 text-[10px] tabular-nums text-ink-400">
            {visiveis.length} de {tags.length}
          </p>
        )}

        <div ref={listaRef} className="flex flex-wrap gap-1">
          {visiveis.map((t) => {
            const ativa = ativas.includes(t.name);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onAlternarTag(t.name)}
                aria-pressed={ativa}
                className={`rounded px-1.5 py-0.5 text-[11px] transition ${
                  ativa ? "bg-accent-500 text-white" : "bg-ink-800 text-ink-400 hover:text-ink-200"
                }`}
              >
                {t.name}
                <span className="ml-1 opacity-60">{t.noteCount}</span>
              </button>
            );
          })}
        </div>

        {/* RF-17: vazio explicado é melhor que área em branco. */}
        {visiveis.length === 0 && (
          <p className="py-1 text-[11px] text-ink-400/70">nenhuma tag com «{busca}»</p>
        )}
      </div>
    </>
  );
}
