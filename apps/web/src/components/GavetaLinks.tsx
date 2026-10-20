import type { Link, LinkFolder, LinkKind } from "@yu-book/shared";
import { normalizarUrl } from "@yu-book/shared";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { CollisionDetection, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ordenar,
  useAtualizarLink,
  useCriarPasta,
  useExcluirPasta,
  useMoverLink,
  useMoverPasta,
  usePastasDeLinks,
  useRebuscarTitulo,
  useRenomearPasta,
} from "../lib/links";
import { DIAS_PARA_ENVELHECER, diasDesde, idadeRelativa } from "../lib/tempo";
import { Aviso } from "@yu-book/cliente/base/Aviso";
import { Botao, BotaoIcone } from "@yu-book/cliente/base/Botao";
import { Dialogo } from "@yu-book/cliente/base/Dialogo";
import { Menu } from "@yu-book/cliente/base/Menu";
import type { ItemMenu } from "@yu-book/cliente/base/Menu";
import { Tecla } from "@yu-book/cliente/base/Tecla";
import { BlocoDominio } from "./BlocoDominio";
import {
  IconeAlerta,
  IconeBusca,
  IconeCheck,
  IconeChevron,
  IconeEstrela,
  IconeFechar,
  IconeLapis,
  IconeLixeira,
  IconeMais,
  IconeOpcoes,
  IconePasta,
  IconeRecarregar,
  IconeRelogio,
} from "@yu-book/cliente/icones";
import { MiniaturaLink } from "./MiniaturaLink";

/** RNF-16: a página aberta não pode ter referência à janela do Yu-book. */
const ALVO = { target: "_blank", rel: "noopener noreferrer" } as const;

/** Ids de soltura que não são favoritos: o tile de uma pasta e a raiz do caminho. */
const PREFIXO_PASTA = "pasta:";
const RAIZ = "raiz";

/**
 * Soltar sobre uma pasta (ou sobre a raiz do caminho) vence a reordenação:
 * com o ponteiro dentro dela, é ela o alvo. Fora disso — e no teclado, que não
 * tem ponteiro —, o centro mais próximo, como antes.
 */
const colisao: CollisionDetection = (args) => {
  const sob = pointerWithin(args).find((c) => {
    const id = String(c.id);
    return id === RAIZ || id.startsWith(PREFIXO_PASTA);
  });
  return sob ? [sob] : closestCenter(args);
};

/**
 * Parece um link para salvar? Sem espaço, com ponto e aceito por
 * `normalizarUrl` — "react.dev" sim, "react" não. O texto continua filtrando
 * de qualquer jeito; isto só decide se o campo oferece salvar.
 */
function pareceUrl(texto: string): boolean {
  const t = texto.trim();
  return !/\s/.test(t) && t.includes(".") && normalizarUrl(t) !== null;
}

/**
 * Para que lado o menu do card abre: a gaveta corta o que passa da borda, e o
 * menu (208 px) é mais largo que o card. Na metade esquerda da grade ele
 * cresce para a direita; na direita, para a esquerda. Medido ao passar o
 * ponteiro ou o foco, antes do clique.
 */
function useLadoDoMenu() {
  const [lado, setLado] = useState<"baixo" | "baixo-fim">("baixo-fim");
  const medir = (e: { currentTarget: HTMLElement }) => {
    const card = e.currentTarget.getBoundingClientRect();
    const grade = e.currentTarget.closest("ul")?.getBoundingClientRect();
    if (grade) setLado(card.left - grade.left < grade.width / 2 ? "baixo" : "baixo-fim");
  };
  return { lado, medir };
}

/** O gatilho "⋯" dos cards: 24px no canto, visível no hover e com o foco dentro. */
function GatilhoOpcoes({ rotulo, ...p }: { rotulo: string } & Record<string, unknown>) {
  return (
    <button
      {...p}
      type="button"
      aria-label={rotulo}
      title="Ações"
      className="grid size-6 place-items-center rounded-etiqueta bg-ink-800/90 text-ink-400
                 shadow-e1 hover:text-ink-200 aria-expanded:text-ink-200"
    >
      <IconeOpcoes className="size-3.5" />
    </button>
  );
}

interface FavoritoProps {
  link: Link;
  destacado: boolean;
  /** Com busca, o arraste desliga: a ordem vista não é a de nenhum recipiente. */
  fixo: boolean;
  /** O nome da pasta, mostrado só na busca (que achata as pastas). */
  pasta: string | null;
  acoes: ItemMenu[];
  onExcluir: (link: Link) => void;
  /** Acabou de soltar um arraste: o clique que vem junto não abre o link. */
  recemSolto: () => boolean;
}

function Favorito({ link, destacado, fixo, pasta, acoes, onExcluir, recemSolto }: FavoritoProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: link.id,
    disabled: fixo,
  });
  const { lado, medir } = useLadoDoMenu();

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`group relative ${isDragging ? "z-10 opacity-40" : ""}`}
      onPointerEnter={medir}
      onFocus={medir}
    >
      <a
        href={link.url}
        {...ALVO}
        {...attributes}
        {...listeners}
        onKeyDown={(e) => {
          if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            onExcluir(link);
            return;
          }
          // Composto com o do `KeyboardSensor`, e não no lugar dele: um
          // `onKeyDown` escrito depois de `{...listeners}` o sobrescrevia, e o
          // arraste dos favoritos por teclado nunca começava.
          (listeners?.onKeyDown as ((ev: React.KeyboardEvent) => void) | undefined)?.(e);
        }}
        // O item arrastado segue o ponteiro, e o soltar cai em cima dele: sem
        // isto, todo arraste terminava abrindo o link numa aba nova.
        onClick={(e) => {
          if (recemSolto()) e.preventDefault();
        }}
        title={link.url}
        className={`flex h-full flex-col items-center gap-1.5 rounded-cartao border px-2 pb-2.5
                    pt-3 text-center outline-none transition focus-visible:ring-2
                    focus-visible:ring-accent-400 ${fixo ? "" : "cursor-grab"} ${
                      destacado
                        ? "border-accent-400 bg-accent-500/10"
                        : "border-ink-700 hover:border-ink-400"
                    }`}
      >
        <BlocoDominio domain={link.domain} tamanho="md" />
        <span className="line-clamp-2 break-words text-xs text-ink-200">{link.title}</span>
        <span className="w-full truncate text-miudo text-ink-400">
          {pasta ? `${pasta} · ${link.domain}` : link.domain}
        </span>
      </a>

      {/* Irmão do link, nunca dentro dos listeners do arraste (INV do kanban). */}
      <span
        className="absolute right-1 top-1 opacity-0 transition group-hover:opacity-100
                   group-focus-within:opacity-100 has-aria-expanded:opacity-100"
      >
        <Menu
          rotulo={`Ações de ${link.title}`}
          lado={lado}
          gatilho={(p) => <GatilhoOpcoes {...p} rotulo={`Ações de ${link.title}`} />}
          itens={acoes}
        />
      </span>
    </li>
  );
}

interface PastaProps {
  pasta: LinkFolder;
  total: number;
  onAbrir: () => void;
  acoes: ItemMenu[];
}

/** O tile da pasta: abre com clique e recebe o favorito solto sobre ele. */
function Pasta({ pasta, total, onAbrir, acoes }: PastaProps) {
  const { setNodeRef, isOver } = useDroppable({ id: PREFIXO_PASTA + pasta.id });
  const { lado, medir } = useLadoDoMenu();
  return (
    <li ref={setNodeRef} className="group relative" onPointerEnter={medir} onFocus={medir}>
      <button
        type="button"
        onClick={onAbrir}
        className={`flex h-full w-full flex-col items-center gap-1.5 rounded-cartao border px-2
                    pb-2.5 pt-3 text-center outline-none transition focus-visible:ring-2
                    focus-visible:ring-accent-400 ${
                      isOver
                        ? "border-accent-400 bg-accent-500/15"
                        : "border-ink-700 bg-ink-900/60 hover:border-ink-400"
                    }`}
      >
        <span
          aria-hidden="true"
          className={`grid size-12 place-items-center rounded-cartao transition ${
            isOver ? "bg-accent-500/25 text-accent-300" : "bg-ink-800 text-ink-200"
          }`}
        >
          <IconePasta className="size-6" />
        </span>
        <span className="line-clamp-2 break-words text-xs font-medium text-ink-200">
          {pasta.name}
        </span>
        <span className="text-miudo tabular-nums text-ink-400">
          {total === 1 ? "1 link" : `${total} links`}
        </span>
      </button>
      <span
        className="absolute right-1 top-1 opacity-0 transition group-hover:opacity-100
                   group-focus-within:opacity-100 has-aria-expanded:opacity-100"
      >
        <Menu
          rotulo={`Ações da pasta ${pasta.name}`}
          lado={lado}
          gatilho={(p) => <GatilhoOpcoes {...p} rotulo={`Ações da pasta ${pasta.name}`} />}
          itens={acoes}
        />
      </span>
    </li>
  );
}

/** "Favoritos" no caminho da pasta aberta: volta, e tira da pasta o favorito solto nele. */
function RaizDoCaminho({ onVoltar }: { onVoltar: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: RAIZ });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onVoltar}
      title="Solte aqui para tirar da pasta"
      className={`flex items-center gap-1 rounded-controle px-1.5 py-1 text-xs font-medium
                  transition ${
                    isOver
                      ? "bg-accent-500/20 text-accent-300 ring-1 ring-accent-400"
                      : "text-ink-400 hover:text-ink-200"
                  }`}
    >
      <IconeChevron direcao="esquerda" className="size-3.5" />
      Favoritos
    </button>
  );
}

/** Um nome para pasta, digitado no lugar: Enter grava, Esc ou sair do campo desiste. */
function CampoNome({
  inicial,
  rotulo,
  onGravar,
  onDesistir,
}: {
  inicial: string;
  rotulo: string;
  onGravar: (nome: string) => void;
  onDesistir: () => void;
}) {
  const [nome, setNome] = useState(inicial);
  return (
    <input
      autoFocus
      value={nome}
      maxLength={60}
      onChange={(e) => setNome(e.target.value)}
      onBlur={onDesistir}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          // O Esc fecha só o campo, não a gaveta.
          e.stopPropagation();
          onDesistir();
        }
        if (e.key !== "Enter") return;
        const limpo = nome.trim();
        if (limpo) onGravar(limpo);
        else onDesistir();
      }}
      aria-label={rotulo}
      placeholder="Nome da pasta"
      className="w-full rounded-controle bg-ink-900 px-2 py-1.5 text-xs text-ink-200 outline-none
                 placeholder:text-ink-400/60 focus:ring-1 focus:ring-accent-400"
    />
  );
}

interface GavetaLinksProps {
  aberta: boolean;
  onFechar: () => void;
  links: Link[];
  onSalvar: (url: string, kind: LinkKind) => void;
  onRemover: (link: Link) => void;
  /** Link que acabou de ser reconhecido como repetido (RN-02). */
  destacado: string | null;
  erroCaptura: string | null;
  onLimparErro: () => void;
  /**
   * O link removido há pouco, à espera do desfazer (RF-28). Com a gaveta
   * aberta, o desfazer mora aqui dentro: o diálogo prende o foco e esconde o
   * resto da tela do leitor de tela, e o aviso flutuante ficaria inalcançável
   * justo quando mais se usa — ao apagar com Delete, daqui de dentro.
   */
  desfazivel: Link | null;
  onDesfazer: () => void;
}

export function GavetaLinks({
  aberta,
  onFechar,
  links,
  onSalvar,
  onRemover,
  destacado,
  erroCaptura,
  onLimparErro,
  desfazivel,
  onDesfazer,
}: GavetaLinksProps) {
  const atualizar = useAtualizarLink();
  const mover = useMoverLink();
  const rebuscar = useRebuscarTitulo();
  const { data: pastas = [] } = usePastasDeLinks();
  const criarPasta = useCriarPasta();
  const renomearPasta = useRenomearPasta();
  const moverPasta = useMoverPasta();
  const excluirPasta = useExcluirPasta();

  const [aba, setAba] = useState<LinkKind>("favorito");
  /** Um campo só: filtra sempre e, quando o texto é URL, oferece salvar. */
  const [campo, setCampo] = useState("");
  const [pastaAberta, setPastaAberta] = useState<string | null>(null);
  const [renomeando, setRenomeando] = useState<Link | null>(null);
  const [rascunho, setRascunho] = useState("");
  /** `"nova"` cria; um id renomeia aquela pasta. */
  const [nomeandoPasta, setNomeandoPasta] = useState<string | null>(null);
  const [erroPasta, setErroPasta] = useState<string | null>(null);
  const campoRef = useRef<HTMLInputElement>(null);
  /**
   * Durante o arraste por teclado as setas movem o favorito — e borbulham até
   * `teclasDaGaveta`, que trocaria de aba e desmontaria a grade no meio do
   * gesto. Ref, não estado: só é lido dentro do handler.
   */
  const arrastando = useRef(false);
  const soltouEm = useRef(0);
  // O clique do soltar pode chegar antes ou depois do `onDragEnd`: vale os dois.
  const recemSolto = () => arrastando.current || Date.now() - soltouEm.current < 400;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Espaço pega e solta; Enter fica livre para abrir o link.
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );

  // O foco inicial é do `Dialogo` (`focoInicial`). Montada por `&&`, a gaveta
  // nunca vê `aberta` falso (INV-53): este reset só vale para a prop viva.
  useEffect(() => {
    if (!aberta) return;
    setCampo("");
    setRenomeando(null);
    setPastaAberta(null);
  }, [aberta]);

  // A pasta aberta que deixou de existir (excluída) volta à raiz.
  useEffect(() => {
    if (pastaAberta && !pastas.some((p) => p.id === pastaAberta)) setPastaAberta(null);
  }, [pastas, pastaAberta]);

  const termo = campo.trim().toLowerCase();
  const buscando = termo.length > 0;
  const ehUrl = pareceUrl(campo);
  const nomeDaPasta = useMemo(() => new Map(pastas.map((p) => [p.id, p.name])), [pastas]);
  const pasta = pastas.find((p) => p.id === pastaAberta) ?? null;

  /**
   * Sem busca, os favoritos do recipiente aberto (a raiz ou a pasta); com
   * busca, todos os que casam, achatados — a pasta some como nível.
   */
  const visiveis = useMemo(() => {
    const lista = ordenar(links, aba);
    if (buscando) {
      return lista.filter(
        (l) => l.title.toLowerCase().includes(termo) || l.domain.toLowerCase().includes(termo),
      );
    }
    return aba === "favorito" ? lista.filter((l) => l.folderId === pastaAberta) : lista;
  }, [links, aba, termo, buscando, pastaAberta]);

  const pastasVisiveis = aba === "favorito" && !buscando && !pastaAberta ? pastas : [];
  const totalNaPasta = (id: string) => links.filter((l) => l.folderId === id).length;
  const contagemDepois = links.filter((l) => l.kind === "depois").length;

  function salvarDoCampo(kind: LinkKind) {
    if (!ehUrl) return;
    onSalvar(campo.trim(), kind);
    setCampo("");
    setAba(kind);
  }

  function aoTerminarArrasto(evento: DragEndEvent) {
    arrastando.current = false;
    soltouEm.current = Date.now();
    const { active, over } = evento;
    if (!over || active.id === over.id || buscando) return;
    const id = String(active.id);
    const sobre = String(over.id);

    // Soltou numa pasta: entra no fim dela.
    if (sobre.startsWith(PREFIXO_PASTA)) {
      const folderId = sobre.slice(PREFIXO_PASTA.length);
      mover.mutate({ id, position: totalNaPasta(folderId), folderId });
      return;
    }
    // Soltou no "Favoritos" do caminho: sai da pasta, para o fim da raiz.
    if (sobre === RAIZ) {
      const naRaiz = links.filter((l) => l.kind === "favorito" && l.folderId === null).length;
      mover.mutate({ id, position: naRaiz, folderId: null });
      return;
    }

    const destino = visiveis.findIndex((l) => l.id === sobre);
    if (destino < 0) return;
    mover.mutate({ id, position: destino });
  }

  // O Esc é do `Dialogo` (e do `fecharTudo` global); aqui só as setas.
  /**
   * RF-05: colar uma URL com a gaveta aberta salva na aba visível. No
   * documento, e não num elemento: com o foco na própria caixa do diálogo
   * (um clique em área vazia), o evento não passaria por nenhum filho.
   * A gaveta só existe montada enquanto está aberta.
   */
  useEffect(() => {
    function colar(e: ClipboardEvent) {
      const alvo = e.target as HTMLElement | null;
      if (alvo?.tagName === "INPUT" || alvo?.tagName === "TEXTAREA") return;
      const texto = e.clipboardData?.getData("text/plain").trim();
      if (texto) {
        e.preventDefault();
        onSalvar(texto, aba);
      }
    }
    document.addEventListener("paste", colar);
    return () => document.removeEventListener("paste", colar);
  }, [aba, onSalvar]);

  function teclasDaGaveta(e: React.KeyboardEvent) {
    // RF-18: setas trocam de aba, exceto quando o cursor está num campo.
    const alvo = e.target as HTMLElement;
    if (alvo.tagName === "INPUT" || arrastando.current) return;
    if (e.key === "ArrowLeft") setAba("favorito");
    if (e.key === "ArrowRight") setAba("depois");
  }

  function gravarPasta(nome: string) {
    const alvo = nomeandoPasta;
    setNomeandoPasta(null);
    setErroPasta(null);
    const falhou = (erro: unknown) =>
      setErroPasta(erro instanceof Error ? erro.message : "Não deu para salvar a pasta.");
    if (alvo === "nova") criarPasta.mutate(nome, { onError: falhou });
    else if (alvo) renomearPasta.mutate({ id: alvo, name: nome }, { onError: falhou });
  }

  function acoesDoFavorito(link: Link): ItemMenu[] {
    const outras = pastas.filter((p) => p.id !== link.folderId);
    return [
      {
        rotulo: "Renomear",
        icone: <IconeLapis className="size-3.5" />,
        aoEscolher: () => {
          setRascunho(link.title);
          setRenomeando(link);
        },
      },
      ...outras.map((p) => ({
        rotulo: `Mover para “${p.name}”`,
        icone: <IconePasta className="size-3.5" />,
        aoEscolher: () =>
          mover.mutate({ id: link.id, position: totalNaPasta(p.id), folderId: p.id }),
      })),
      ...(link.folderId
        ? [
            {
              rotulo: "Tirar da pasta",
              icone: <IconeEstrela className="size-3.5" />,
              aoEscolher: () =>
                mover.mutate({
                  id: link.id,
                  position: links.filter((l) => l.kind === "favorito" && !l.folderId).length,
                  folderId: null,
                }),
            },
          ]
        : []),
      {
        rotulo: "Mover para ver depois",
        icone: <IconeRelogio className="size-3.5" />,
        aoEscolher: () => atualizar.mutate({ id: link.id, input: { kind: "depois" } }),
      },
      {
        rotulo: "Excluir",
        icone: <IconeLixeira className="size-3.5" />,
        atalho: "Del",
        aoEscolher: () => onRemover(link),
      },
    ];
  }

  function acoesDaPasta(p: LinkFolder, indice: number): ItemMenu[] {
    return [
      {
        rotulo: "Renomear",
        icone: <IconeLapis className="size-3.5" />,
        aoEscolher: () => setNomeandoPasta(p.id),
      },
      {
        rotulo: "Mover para antes",
        icone: <IconeChevron direcao="esquerda" className="size-3.5" />,
        desabilitado: indice === 0,
        aoEscolher: () => moverPasta.mutate({ id: p.id, position: indice - 1 }),
      },
      {
        rotulo: "Mover para depois",
        icone: <IconeChevron direcao="direita" className="size-3.5" />,
        desabilitado: indice === pastas.length - 1,
        aoEscolher: () => moverPasta.mutate({ id: p.id, position: indice + 1 }),
      },
      {
        rotulo: "Excluir pasta (os links ficam)",
        icone: <IconeLixeira className="size-3.5" />,
        aoEscolher: () => excluirPasta.mutate(p.id),
      },
    ];
  }

  const abas = [
    ["favorito", "Favoritos", links.filter((l) => l.kind === "favorito").length],
    ["depois", "Ver depois", contagemDepois],
  ] as const;

  const vazio =
    visiveis.length === 0 && pastasVisiveis.length === 0 && nomeandoPasta !== "nova";

  return (
    <Dialogo
      aberto={aberta}
      posicao="lateral"
      largura="max-w-md"
      rotulo="Gaveta de links"
      focoInicial={campoRef}
      onFechar={onFechar}
    >
      <div className="flex min-h-0 flex-1 flex-col" onKeyDown={teclasDaGaveta}>
        <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-3">
          <h2 className="text-sm font-semibold text-titulo">Links</h2>
          <BotaoIcone
            rotulo="Fechar a gaveta"
            icone={<IconeFechar className="size-3.5" />}
            onClick={onFechar}
          />
        </div>

        {/* O campo único: busca sempre; com URL, salva (Enter na aba visível). */}
        <form
          className="shrink-0 px-4"
          onSubmit={(e) => {
            e.preventDefault();
            salvarDoCampo(aba);
          }}
        >
          {/* O anel de foco é o padrão do campo (RNF-08), não um do contêiner. */}
          <label className="flex items-center gap-2 rounded-controle bg-ink-900 px-2.5">
            <IconeBusca className="size-3.5 shrink-0 text-ink-400" />
            <input
              ref={campoRef}
              value={campo}
              onChange={(e) => setCampo(e.target.value)}
              onKeyDown={(e) => {
                // Esc com texto limpa o campo; vazio, fecha a gaveta como sempre.
                if (e.key === "Escape" && campo) {
                  e.stopPropagation();
                  setCampo("");
                }
              }}
              placeholder="Buscar, ou colar uma URL para salvar"
              aria-label="Buscar links ou colar uma URL"
              aria-describedby={ehUrl ? "gaveta-salvar" : undefined}
              className="min-w-0 flex-1 bg-transparent py-2 text-sm text-ink-200 outline-none
                         placeholder:text-ink-400/60"
            />
            {campo && (
              <button
                type="button"
                onClick={() => {
                  setCampo("");
                  campoRef.current?.focus();
                }}
                aria-label="Limpar"
                className="grid size-6 place-items-center rounded-etiqueta text-ink-400
                           hover:text-ink-200"
              >
                <IconeFechar className="size-3" />
              </button>
            )}
          </label>
          {ehUrl && (
            <div id="gaveta-salvar" className="mt-2 flex items-center gap-2 text-xs text-ink-400">
              <span className="min-w-0 flex-1 truncate">
                Salvar <span className="text-ink-200">{normalizarUrl(campo)?.domain}</span> em
              </span>
              <Botao
                icone={<IconeEstrela className="size-3.5" />}
                variante={aba === "favorito" ? "primario" : "secundario"}
                onClick={() => salvarDoCampo("favorito")}
              >
                Favoritos
              </Botao>
              <Botao
                icone={<IconeRelogio className="size-3.5" />}
                variante={aba === "depois" ? "primario" : "secundario"}
                onClick={() => salvarDoCampo("depois")}
              >
                Ver depois
              </Botao>
            </div>
          )}
          <button type="submit" className="sr-only">
            Salvar na aba atual
          </button>
        </form>

        <div className="mt-3 flex shrink-0 items-center gap-2 border-b border-ink-700 px-4 pb-3">
          <div role="group" aria-label="Lista" className="flex rounded-controle bg-ink-900 p-0.5">
            {abas.map(([valor, rotulo, total]) => (
              <button
                key={valor}
                type="button"
                onClick={() => setAba(valor)}
                aria-pressed={aba === valor}
                className={`rounded-controle px-2.5 py-1 text-xs font-medium transition ${
                  aba === valor
                    ? "bg-superficie text-titulo shadow-e1"
                    : "text-ink-400 hover:text-ink-200"
                }`}
              >
                {rotulo}
                <span className="ml-1.5 tabular-nums opacity-70">{total}</span>
              </button>
            ))}
          </div>
          {aba === "favorito" && !pastaAberta && !buscando && (
            <Botao
              variante="fantasma"
              icone={<IconeMais className="size-3.5" />}
              onClick={() => setNomeandoPasta("nova")}
              className="ml-auto"
            >
              Pasta
            </Botao>
          )}
        </div>

        {erroCaptura && (
          <Aviso tom="erro" onFechar={onLimparErro} className="mx-4 mt-3 shrink-0">
            {erroCaptura}
          </Aviso>
        )}
        {erroPasta && (
          <Aviso tom="erro" onFechar={() => setErroPasta(null)} className="mx-4 mt-3 shrink-0">
            {erroPasta}
          </Aviso>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={colisao}
          onDragStart={() => {
            arrastando.current = true;
          }}
          onDragCancel={() => {
            arrastando.current = false;
            soltouEm.current = Date.now();
          }}
          onDragEnd={aoTerminarArrasto}
        >
          {aba === "favorito" && pasta && !buscando && (
            <nav
              aria-label="Caminho"
              className="flex shrink-0 items-center gap-1 px-3 pt-3 text-xs"
            >
              <RaizDoCaminho onVoltar={() => setPastaAberta(null)} />
              <span aria-hidden="true" className="text-ink-700">
                /
              </span>
              <span className="flex min-w-0 items-center gap-1.5 font-semibold text-titulo">
                <IconePasta className="size-3.5 shrink-0 text-ink-400" />
                <span className="truncate">{pasta.name}</span>
              </span>
            </nav>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {vazio && (
              <p className="py-10 text-center text-sm text-ink-400">
                {buscando
                  ? ehUrl
                    ? "Nada salvo com esse endereço ainda."
                    : `Nada com “${campo.trim()}”.`
                  : pasta
                    ? "Pasta vazia. Arraste um favorito para cá, ou use o “⋯” dele."
                    : aba === "favorito"
                      ? "Sem favoritos. Arraste um link para dentro da janela."
                      : "Fila vazia. Arraste aqui o que quiser ver depois."}
              </p>
            )}

            {aba === "favorito" && !vazio && (
              <SortableContext items={visiveis.map((l) => l.id)} strategy={rectSortingStrategy}>
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
                  {nomeandoPasta === "nova" && (
                    <li className="flex items-center rounded-cartao border border-dashed border-ink-700 p-2">
                      <CampoNome
                        inicial=""
                        rotulo="Nome da nova pasta"
                        onGravar={gravarPasta}
                        onDesistir={() => setNomeandoPasta(null)}
                      />
                    </li>
                  )}
                  {pastasVisiveis.map((p, i) =>
                    nomeandoPasta === p.id ? (
                      <li
                        key={p.id}
                        className="flex items-center rounded-cartao border border-ink-700 p-2"
                      >
                        <CampoNome
                          inicial={p.name}
                          rotulo={`Novo nome da pasta ${p.name}`}
                          onGravar={gravarPasta}
                          onDesistir={() => setNomeandoPasta(null)}
                        />
                      </li>
                    ) : (
                      <Pasta
                        key={p.id}
                        pasta={p}
                        total={totalNaPasta(p.id)}
                        onAbrir={() => setPastaAberta(p.id)}
                        acoes={acoesDaPasta(p, i)}
                      />
                    ),
                  )}
                  {visiveis.map((link) =>
                    renomeando?.id === link.id ? (
                      <li key={link.id} className="flex items-center">
                        <input
                          autoFocus
                          value={rascunho}
                          onChange={(e) => setRascunho(e.target.value)}
                          onBlur={() => setRenomeando(null)}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            const title = rascunho.trim();
                            if (title) atualizar.mutate({ id: link.id, input: { title } });
                            setRenomeando(null);
                          }}
                          aria-label={`Novo nome de ${link.title}`}
                          className="w-full rounded-controle bg-ink-900 px-2 py-1 text-xs
                                     text-ink-200 outline-none focus:ring-1 focus:ring-accent-400"
                        />
                      </li>
                    ) : (
                      <Favorito
                        key={link.id}
                        link={link}
                        destacado={destacado === link.id}
                        fixo={buscando}
                        pasta={buscando && link.folderId ? (nomeDaPasta.get(link.folderId) ?? null) : null}
                        acoes={acoesDoFavorito(link)}
                        onExcluir={onRemover}
                        recemSolto={recemSolto}
                      />
                    ),
                  )}
                </ul>
              </SortableContext>
            )}

          {aba === "depois" && visiveis.length > 0 && (
            <ul className="divide-y divide-ink-700/60">
              {visiveis.map((link) => {
                const velho = diasDesde(link.createdAt) >= DIAS_PARA_ENVELHECER;
                return (
                  <li
                    key={link.id}
                    className={`group flex items-center gap-3 py-2 ${
                      destacado === link.id ? "bg-accent-500/10" : ""
                    }`}
                  >
                    {/* RNF-10: item velho tem símbolo, não só cor — e a idade em texto. */}
                    <span className="flex w-4 shrink-0 justify-center text-amber-300">
                      {velho && <IconeAlerta className="size-3.5" />}
                    </span>
                    <MiniaturaLink link={link} />

                    <a
                      href={link.url}
                      {...ALVO}
                      title={link.url}
                      className="min-w-0 flex-1 rounded-etiqueta outline-none focus-visible:ring-2
                                 focus-visible:ring-accent-400"
                      onKeyDown={(e) => {
                        if (e.key === "Delete" || e.key === "Backspace") {
                          e.preventDefault();
                          onRemover(link);
                        }
                      }}
                    >
                      <span className="block truncate text-sm text-ink-200">{link.title}</span>
                      <span className="block truncate text-miudo text-ink-400">
                        {link.domain}
                      </span>
                    </a>

                    <span
                      className={`shrink-0 text-miudo tabular-nums ${
                        velho ? "text-amber-300" : "text-ink-400"
                      }`}
                    >
                      {idadeRelativa(link.createdAt)}
                      {velho && <span className="sr-only"> (antigo)</span>}
                    </span>

                    <span
                      className="flex shrink-0 gap-0.5 opacity-0 transition group-hover:opacity-100
                                 group-focus-within:opacity-100"
                    >
                      {link.semTitulo && (
                        <button
                          type="button"
                          onClick={() => rebuscar.mutate(link.id)}
                          aria-label={`Buscar o título de ${link.domain}`}
                          title="Tentar ler o título da página"
                          className="rounded-etiqueta p-1 text-ink-400 hover:text-ink-200"
                        >
                          <IconeRecarregar className="size-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onRemover(link)}
                        aria-label={`Concluir ${link.title}`}
                        title="Concluir — remove da fila"
                        className="rounded-etiqueta p-1 text-ink-400 hover:text-emerald-300"
                      >
                        <IconeCheck className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          atualizar.mutate({ id: link.id, input: { kind: "favorito" } })
                        }
                        aria-label={`Mover ${link.title} para favoritos`}
                        title="Mover para favoritos"
                        className="rounded-etiqueta p-1 text-ink-400 hover:text-amber-300"
                      >
                        <IconeEstrela className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemover(link)}
                        aria-label={`Excluir ${link.title}`}
                        title="Excluir"
                        className="rounded-etiqueta p-1 text-ink-400 hover:text-red-300"
                      >
                        <IconeFechar className="size-3.5" />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          </div>
        </DndContext>

        {/* RF-28: o desfazer, aqui dentro enquanto a gaveta está aberta. */}
        {desfazivel && (
          <Aviso tom="info" className="mx-4 mb-2 shrink-0">
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">“{desfazivel.title}” saiu da gaveta</span>
              <Botao variante="fantasma" onClick={onDesfazer} className="-my-1">
                Desfazer
              </Botao>
            </span>
          </Aviso>
        )}

        <div
          className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 border-t border-ink-700 px-4 py-2
                     text-miudo text-ink-400"
        >
          <span className="flex items-center gap-1.5">
            <Tecla combo="←" />
            <Tecla combo="→" /> trocar de aba
          </span>
          <span className="flex items-center gap-1.5">
            <Tecla combo="Enter" /> abrir
          </span>
          <span className="flex items-center gap-1.5">
            <Tecla combo="Espaço" /> arrastar
          </span>
          <span className="flex items-center gap-1.5">
            <Tecla combo="Del" /> remover
          </span>
          <span className="flex items-center gap-1.5">
            <Tecla combo="Esc" /> fechar
          </span>
        </div>
      </div>
    </Dialogo>
  );
}
