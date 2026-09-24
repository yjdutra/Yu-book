import { MAX_TAGS_CARD, normalizarTag, normalizarTitulo } from "@yu-book/shared";
import { useId, useMemo, useRef, useState } from "react";
import { casaTermo } from "../lib/tags";
import type { TagDoBoard } from "../lib/tags";
import { IconeFechar } from "./Icones";

interface Opcao {
  nome: string;
  quantidade: number;
  /** `true` quando a opção é "criar «texto»" e não uma tag já existente. */
  nova: boolean;
}

interface SeletorDeTagsProps {
  tags: string[];
  /** As tags já em uso no board (RF-03), com quantas vezes cada uma aparece. */
  sugestoes: TagDoBoard[];
  onMudar: (tags: string[]) => void;
}

/**
 * RF-02 a RF-06: as etiquetas do card.
 *
 * A tag é criada ao digitar — não existe tela de cadastro. O que a lista
 * oferece são as tags que **este board** já usa, porque tag de card é local ao
 * board (RN-04): sugerir o acervo inteiro do usuário seria ruído.
 *
 * O teclado e o `onMouseDown` com `preventDefault` seguem o autocomplete de
 * `[[wikilink]]` do editor de notas (`Editor.tsx`) — mesmo gesto, mesmo
 * comportamento.
 */
export function SeletorDeTags({ tags, sugestoes, onMudar }: SeletorDeTagsProps) {
  const [texto, setTexto] = useState("");
  const [aberto, setAberto] = useState(false);
  const [indice, setIndice] = useState(0);
  const campoRef = useRef<HTMLInputElement>(null);
  const idLista = useId();

  const cheio = tags.length >= MAX_TAGS_CARD;

  const opcoes = useMemo<Opcao[]>(() => {
    const aplicadas = new Set(tags.map(normalizarTitulo));

    const existentes = sugestoes
      .filter((s) => !aplicadas.has(normalizarTitulo(s.nome)) && casaTermo(s.nome, texto))
      .map((s) => ({ ...s, nova: false }))
      .slice(0, 8);

    // "Criar" fica no fim quando há correspondência e vira a primeira (e única)
    // opção quando não há — que é o caso de RF-04. Colocá-la sempre no topo
    // faria `Enter` criar `ban` em vez de aplicar `banco de dados`.
    const novo = normalizarTag(texto);
    const inedito =
      novo &&
      !aplicadas.has(normalizarTitulo(novo)) &&
      !sugestoes.some((s) => normalizarTitulo(s.nome) === normalizarTitulo(novo));

    return inedito ? [...existentes, { nome: novo, quantidade: 0, nova: true }] : existentes;
  }, [tags, sugestoes, texto]);

  const escolhida = opcoes[Math.min(indice, opcoes.length - 1)];

  function aplicar(bruto: string) {
    const tag = normalizarTag(bruto);
    setTexto("");
    setIndice(0);
    if (!tag || cheio) return;

    const chave = normalizarTitulo(tag);
    if (tags.some((t) => normalizarTitulo(t) === chave)) return;

    // RN-02: o board manda na grafia. Digitar `revisao` num board que já tem
    // `revisão` aplica `revisão`, senão o catálogo ganharia duas entradas para
    // a mesma coisa.
    const doBoard = sugestoes.find((s) => normalizarTitulo(s.nome) === chave);
    onMudar([...tags, doBoard?.nome ?? tag]);
  }

  function remover(nome: string) {
    onMudar(tags.filter((t) => t !== nome));
    campoRef.current?.focus();
  }

  function teclas(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      // Só engole o Esc quando de fato há o que fechar aqui — senão o painel do
      // card deixaria de fechar com Esc enquanto o foco estivesse neste campo.
      if (!aberto && !texto) return;
      e.stopPropagation();
      e.preventDefault();
      setAberto(false);
      setTexto("");
      return;
    }

    if (e.key === "Backspace" && !texto && tags.length > 0) {
      e.preventDefault();
      onMudar(tags.slice(0, -1));
      return;
    }

    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && opcoes.length > 0) {
      e.preventDefault();
      setAberto(true);
      const passo = e.key === "ArrowDown" ? 1 : -1;
      setIndice((i) => (i + passo + opcoes.length) % opcoes.length);
      return;
    }

    // A vírgula confirma junto com o Enter: é como se digita tag na nota, e o
    // dedo já vem com o hábito.
    if (e.key === "Enter" || e.key === ",") {
      if (!texto.trim()) return;
      e.preventDefault();
      aplicar(escolhida?.nome ?? texto);
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        {tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-etiqueta bg-ink-700 py-0.5 pl-1.5 pr-0.5
                       text-miudo text-ink-200"
          >
            {tag}
            <button
              type="button"
              onClick={() => remover(tag)}
              aria-label={`Remover a tag ${tag}`}
              className="rounded-etiqueta p-0.5 text-ink-400 hover:text-red-300"
            >
              <IconeFechar className="size-3" />
            </button>
          </span>
        ))}
      </div>

      <div className="relative">
        <input
          ref={campoRef}
          value={texto}
          disabled={cheio}
          onChange={(e) => {
            setTexto(e.target.value);
            setAberto(true);
            setIndice(0);
          }}
          onFocus={() => setAberto(true)}
          onBlur={() => setAberto(false)}
          onKeyDown={teclas}
          placeholder={cheio ? `Limite de ${MAX_TAGS_CARD} tags` : "+ tag"}
          aria-label="Tags do card"
          role="combobox"
          aria-expanded={aberto && opcoes.length > 0}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-activedescendant={
            aberto && escolhida ? `${idLista}-${opcoes.indexOf(escolhida)}` : undefined
          }
          className="w-full rounded-controle bg-ink-800 px-2 py-1 text-xs text-ink-200 outline-none
                     placeholder:text-ink-400/60 focus:ring-1 focus:ring-accent-400
                     disabled:cursor-not-allowed disabled:text-ink-400"
        />

        {aberto && opcoes.length > 0 && (
          <ul
            id={idLista}
            role="listbox"
            aria-label="Tags deste board"
            className="absolute z-(--z-popover) mt-1 max-h-48 w-full overflow-y-auto
                       overflow-x-hidden rounded-cartao border border-ink-700/70 bg-superficie
                       py-1 shadow-e3 animate-surgir"
          >
            {opcoes.map((opcao, i) => (
              <li key={`${opcao.nome}-${opcao.nova}`}>
                <button
                  type="button"
                  id={`${idLista}-${i}`}
                  role="option"
                  aria-selected={opcao === escolhida}
                  // O clique não pode tirar o foco do campo antes de aplicar.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    aplicar(opcao.nome);
                  }}
                  onMouseEnter={() => setIndice(i)}
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs ${
                    opcao === escolhida ? "bg-accent-500 text-white" : "text-ink-200"
                  }`}
                >
                  {opcao.nova ? (
                    <span className="truncate">
                      criar <span className="font-medium">«{opcao.nome}»</span>
                    </span>
                  ) : (
                    <>
                      <span className="truncate">{opcao.nome}</span>
                      <span className="ml-auto shrink-0 tabular-nums opacity-60">
                        {opcao.quantidade}
                      </span>
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
