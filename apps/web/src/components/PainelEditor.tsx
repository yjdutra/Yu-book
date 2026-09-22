import { NOTE_KINDS } from "@yu-book/shared";
import type { NoteDetail, NoteKind, UpdateNoteInput } from "@yu-book/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { ApiError } from "../lib/api";
import {
  useAtualizarNota,
  useExcluirDefinitivo,
  useExcluirNota,
  useNota,
  useRestaurarNota,
  useWorkspaces,
} from "../lib/notas";
import { useAutosave } from "../lib/useAutosave";
import type { EstadoSalvamento } from "../lib/useAutosave";
import { useFormatarNota } from "../lib/ia";
import { useModoNota } from "../lib/modoNota";
import { Editor } from "./Editor";
import type { FocoDoCorpo } from "./Editor";
import { SeletorModo } from "./ModoNota";
import { IconeCopiar, IconeFormatar } from "./Icones";
import { RotuloTipo } from "./RotuloTipo";

/** Campos extras de aula (RF-45). Ficam em `meta`, sem migration por campo. */
const CAMPOS_META: Record<string, { chave: string; rotulo: string }[]> = {
  aula: [
    { chave: "modulo", rotulo: "Módulo" },
    { chave: "numero", rotulo: "Aula nº" },
    { chave: "instrutor", rotulo: "Instrutor" },
    { chave: "gravacao", rotulo: "Link da gravação" },
  ],
};

/** RF-16 / RNF-09: estado com texto próprio, não só cor. */
function IndicadorSalvamento({ estado }: { estado: EstadoSalvamento }) {
  if (estado.tipo === "ocioso") return null;

  if (estado.tipo === "erro") {
    // RF-17: erro é persistente, não um toast que some.
    return (
      <span
        role="alert"
        className="rounded bg-red-500/15 px-2 py-1 text-xs text-red-300"
        title={estado.mensagem}
      >
        ⚠ não salvo — tentativa {estado.tentativas}/3
      </span>
    );
  }

  const texto =
    estado.tipo === "salvando"
      ? "salvando…"
      : estado.tipo === "salvo"
        ? `salvo ${estado.em.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
        : "editando";

  return (
    <span aria-live="polite" className="text-xs tabular-nums text-ink-400">
      {texto}
    </span>
  );
}

interface PainelEditorProps {
  notaId: string;
  onAbrirNota: (id: string) => void;
  onCriarPorTitulo: (titulo: string) => void;
  onFechar: () => void;
  /** RF-39: abrir o board com o painel do card aberto. */
  onAbrirCard: (boardId: string, cardId: string) => void;
  /** Nota criada sem nome: campo de título vazio e focado (RNF-06). */
  autoFocoTitulo: boolean;
  /** Nota criada a partir de `[[titulo]]`: o nome já está certo, foco no corpo. */
  autoFocoCorpo: boolean;
  refTitulo: RefObject<HTMLInputElement | null>;
  refCorpo: RefObject<FocoDoCorpo | null>;
}

interface Rascunho {
  title: string;
  contentMd: string;
}

export function PainelEditor({
  notaId,
  onAbrirNota,
  onCriarPorTitulo,
  onFechar,
  onAbrirCard,
  autoFocoTitulo,
  autoFocoCorpo,
  refTitulo,
  refCorpo,
}: PainelEditorProps) {
  const { data: nota, isLoading } = useNota(notaId);
  const { data: workspaces } = useWorkspaces();
  const atualizar = useAtualizarNota();
  const excluir = useExcluirNota();
  const restaurar = useRestaurarNota();
  const excluirDefinitivo = useExcluirDefinitivo();

  const [modo, setModo] = useModoNota();
  const [rascunho, setRascunho] = useState<Rascunho>({ title: "", contentMd: "" });
  const [metaAberto, setMetaAberto] = useState(false);
  const [erroTitulo, setErroTitulo] = useState<string | null>(null);
  const [tagsTexto, setTagsTexto] = useState("");
  /** RF-30: sucesso some sozinho; erro fica na tela até ser resolvido. */
  const [copia, setCopia] = useState<"ocioso" | "copiado" | "erro">("ocioso");
  const timerCopiaRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const carregadaRef = useRef<string | null>(null);

  /** RF-11: o texto de antes da formatação, enquanto o desfazer vale. */
  const [desfazer, setDesfazer] = useState<string | null>(null);
  const [erroFormatar, setErroFormatar] = useState<string | null>(null);
  const timerDesfazerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formatar = useFormatarNota();

  /**
   * O rascunho de agora, para a resposta da formatação poder comparar com o que
   * está na tela (RF-15). A variável do fechamento seria a de quando o pedido
   * saiu, que é exatamente o que não serve aqui.
   */
  const rascunhoRef = useRef(rascunho);
  useEffect(() => {
    rascunhoRef.current = rascunho;
  }, [rascunho]);

  useEffect(() => () => {
    if (timerCopiaRef.current) clearTimeout(timerCopiaRef.current);
    if (timerDesfazerRef.current) clearTimeout(timerDesfazerRef.current);
  }, []);

  // Carrega o rascunho ao trocar de nota. Sem a guarda por id, cada refetch
  // sobrescreveria o que está sendo digitado.
  useEffect(() => {
    if (!nota || carregadaRef.current === nota.id) return;
    carregadaRef.current = nota.id;

    // Nota recém-criada: o campo abre vazio para você só digitar, em vez de
    // ter que apagar o título provisório. Selecionar o texto não resolveria —
    // num input controlado, o próximo render desfaz a seleção.
    setRascunho({ title: autoFocoTitulo ? "" : nota.title, contentMd: nota.contentMd });
    setTagsTexto(nota.tags.map((t) => t.name).join(", "));
    setErroTitulo(null);
    setMetaAberto(false);

    // O foco precisa esperar os dados chegarem: enquanto a nota carrega, este
    // painel renderiza o estado de carregamento e o input ainda não existe.
    if (autoFocoTitulo) requestAnimationFrame(() => refTitulo.current?.focus());
    else if (autoFocoCorpo) requestAnimationFrame(() => refCorpo.current?.focus());
  }, [nota, autoFocoTitulo, autoFocoCorpo, refTitulo, refCorpo]);

  const salvar = useCallback(
    async (valor: Rascunho) => {
      // Título vazio (nota nova ainda sem nome) não vai no payload: o corpo
      // continua sendo salvo e a nota mantém o título provisório no banco,
      // em vez de o autosave falhar em loop na validação.
      const titulo = valor.title.trim();
      const input: UpdateNoteInput = titulo
        ? { title: titulo, contentMd: valor.contentMd }
        : { contentMd: valor.contentMd };

      try {
        await atualizar.mutateAsync({ id: notaId, input });
        setErroTitulo(null);
      } catch (erro) {
        // RN-01: título duplicado é erro do usuário, não falha de rede — não
        // faz sentido a retentativa do autosave insistir nele.
        if (erro instanceof ApiError && erro.code === "TITULO_DUPLICADO") {
          setErroTitulo(erro.message);
          return;
        }
        throw erro;
      }
    },
    [atualizar, notaId],
  );

  const iguais = useCallback(
    (a: Rascunho, b: Rascunho) => a.title === b.title && a.contentMd === b.contentMd,
    [],
  );

  const { estado, salvarAgora } = useAutosave({
    valor: rascunho,
    chave: notaId,
    salvar,
    iguais,
  });

  const camposMeta = useMemo(() => (nota ? (CAMPOS_META[nota.kind] ?? []) : []), [nota]);

  if (isLoading || !nota) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-ink-400">
        <span className="animate-pulse">Carregando nota…</span>
      </div>
    );
  }

  function aplicar(input: UpdateNoteInput) {
    atualizar.mutate({ id: notaId, input });
  }

  /**
   * RF-29: a nota inteira como Markdown — o título vira `# titulo` e o corpo vai
   * exatamente como está, sem uma vírgula reescrita.
   *
   * Copia o rascunho, não o que está no banco: é o que está na tela, e entre uma
   * tecla e o autosave existem 800 ms em que os dois divergem.
   */
  // Arrow, e não `function`: declaração de função é içada para o topo do escopo,
  // e o TypeScript perde ali o estreitamento de `nota` que a guarda acima fez.
  const copiar = async () => {
    if (timerCopiaRef.current) clearTimeout(timerCopiaRef.current);

    const titulo = rascunho.title.trim() || nota.title;
    const texto = `# ${titulo}\n\n${rascunho.contentMd}`;

    try {
      // Fora de https e de localhost o objeto simplesmente NÃO EXISTE — não é
      // uma promessa que rejeita, é `undefined`. Os dois casos caem no catch.
      if (!navigator.clipboard?.writeText) throw new Error("sem área de transferência");
      await navigator.clipboard.writeText(texto);
      setCopia("copiado");
      timerCopiaRef.current = setTimeout(() => setCopia("ocioso"), 2000);
    } catch {
      setCopia("erro");
    }
  };

  /**
   * RF-10: formata o corpo por IA e aplica no rascunho.
   *
   * Aplicar em `rascunho` e deixar o autosave gravar é o que faz isto custar
   * **uma** requisição: só o corpo muda, então a cirurgia de cache de
   * `useAtualizarNota` não invalida nada (INV-23). E o RF-13 sai de graça —
   * título, tags e workspace nem são enviados, então não podem ser alterados.
   *
   * O desfazer mora aqui, e não na casca como o da gaveta de links: sair da
   * nota desmonta este painel e cancela a chance de desfazer. É a escolha
   * certa — o CA-05 exige devolver o texto *daquela* nota, e escrever texto
   * antigo numa nota que você não está mais vendo seria pior que perder o
   * desfazer.
   */
  const aoFormatar = async () => {
    if (formatar.isPending) return;
    const antes = rascunho.contentMd;
    setErroFormatar(null);

    try {
      const resultado = await formatar.mutateAsync({ id: notaId, contentMd: antes });

      // RF-15: editou enquanto ia e voltava? Recusa, em vez de engolir o que
      // você acabou de escrever.
      if (rascunhoRef.current.contentMd !== antes) {
        setErroFormatar(
          "Você editou a nota enquanto ela era formatada — o resultado foi descartado.",
        );
        return;
      }

      setRascunho((r) => ({ ...r, contentMd: resultado.contentMd }));
      if (timerDesfazerRef.current) clearTimeout(timerDesfazerRef.current);
      setDesfazer(antes);
      timerDesfazerRef.current = setTimeout(() => setDesfazer(null), 8000);
    } catch (erro) {
      setErroFormatar(
        erro instanceof ApiError ? erro.message : "Não foi possível formatar a nota.",
      );
    }
  };

  const aoDesfazerFormatacao = () => {
    if (desfazer === null) return;
    // Volta pelo mesmo caminho: o autosave grava a volta, como grava a ida.
    setRascunho((r) => ({ ...r, contentMd: desfazer }));
    setDesfazer(null);
    if (timerDesfazerRef.current) clearTimeout(timerDesfazerRef.current);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-ink-800 px-6 pb-3 pt-4">
        <div className="flex items-start gap-3">
          {/* RF-20: título é campo próprio, não o primeiro `#` do corpo. */}
          <input
            ref={refTitulo}
            value={rascunho.title}
            onChange={(e) => setRascunho((r) => ({ ...r, title: e.target.value }))}
            onKeyDown={(e) => {
              // RNF-06: Enter no título leva o foco para o corpo.
              if (e.key === "Enter") {
                e.preventDefault();
                refCorpo.current?.focus();
              }
            }}
            placeholder="Título da nota"
            aria-label="Título da nota"
            aria-invalid={erroTitulo ? "true" : undefined}
            className="min-w-0 flex-1 bg-transparent text-xl font-semibold text-titulo outline-none
                       placeholder:text-ink-400/50"
          />

          <div className="flex shrink-0 items-center gap-2 pt-1">
            <SeletorModo modo={modo} onModo={setModo} />

            {/* RF-10: sem atalho de teclado, pelo mesmo motivo do botão de
                copiar — e porque atalho dentro do editor exige entrar nos dois
                mapas (a textarea e o keymap do CodeMirror) ou não existe direito. */}
            <button
              type="button"
              onClick={() => void aoFormatar()}
              disabled={formatar.isPending}
              title="Formatar a nota com IA"
              aria-label="Formatar a nota com IA"
              className="rounded px-1.5 py-1 text-ink-400 transition-colors hover:text-ink-200
                         disabled:cursor-not-allowed disabled:opacity-40"
            >
              <IconeFormatar
                className={`size-3.5 ${formatar.isPending ? "animate-pulse" : ""}`}
              />
            </button>
            {/* Chamada de modelo leva segundos. Sem sinal visível, o botão
                apagado parece travado — e o `aria-live` abaixo só fala com
                leitor de tela. Texto, no idioma do `IndicadorSalvamento`. */}
            {/* RNF-09: o próprio texto visível é a região anunciada. A faixa de
                desfazer abaixo já é `role="status"`, então um `sr-only` aqui
                faria o leitor de tela dizer "nota formatada" duas vezes. */}
            {formatar.isPending && (
              <span role="status" className="animate-pulse text-xs text-ink-400">
                formatando…
              </span>
            )}

            {/* RF-28: sem atalho de teclado de propósito — `Ctrl+Shift+C` é
                "inspecionar elemento" no Chrome e no Firefox, e `preventDefault`
                não cancela isso. */}
            <button
              type="button"
              onClick={() => void copiar()}
              title="Copiar a nota inteira como Markdown"
              aria-label="Copiar a nota inteira como Markdown"
              className={`rounded px-1.5 py-1 transition-colors ${
                copia === "copiado" ? "text-emerald-300" : "text-ink-400 hover:text-ink-200"
              }`}
            >
              <IconeCopiar className="size-3.5" />
            </button>
            {/* RNF-09: o resultado é anunciado, não só colorido. */}
            <span aria-live="polite" className="sr-only">
              {copia === "copiado" ? "Nota copiada." : ""}
            </span>

            <IndicadorSalvamento estado={estado} />
            <button
              type="button"
              onClick={() => aplicar({ isFavorite: !nota.isFavorite })}
              aria-pressed={nota.isFavorite}
              aria-label={nota.isFavorite ? "Desmarcar favorita" : "Marcar como favorita"}
              className={`rounded px-1.5 text-sm ${
                nota.isFavorite ? "text-amber-400" : "text-ink-400 hover:text-ink-200"
              }`}
            >
              ★
            </button>
            <button
              type="button"
              onClick={onFechar}
              aria-label="Fechar nota"
              className="rounded px-1.5 text-sm text-ink-400 hover:text-ink-200"
            >
              ×
            </button>
          </div>
        </div>

        {/* RF-11: some sozinho em 8 s. É informação, não erro — `status`. */}
        {desfazer !== null && (
          <p role="status" className="mt-1 flex items-center gap-2 text-xs text-ink-400">
            Nota formatada.
            <button
              type="button"
              onClick={aoDesfazerFormatacao}
              className="rounded px-1 text-accent-400 hover:text-accent-500"
            >
              desfazer
            </button>
          </p>
        )}

        {/* RF-16: erro de IA fica na tela até você fechar, como o de cópia. */}
        {erroFormatar && (
          <p role="alert" className="mt-1 flex items-center gap-2 text-xs text-red-300">
            {erroFormatar}
            <button
              type="button"
              onClick={() => setErroFormatar(null)}
              aria-label="Fechar aviso de formatação"
              className="rounded px-1 text-red-300"
            >
              ×
            </button>
          </p>
        )}

        {erroTitulo && (
          <p role="alert" className="mt-1 text-xs text-red-300">
            {erroTitulo}
          </p>
        )}

        {/* RF-30: erro de cópia não é toast — fica até você fechar. */}
        {copia === "erro" && (
          <p role="alert" className="mt-1 flex items-center gap-2 text-xs text-red-300">
            Não foi possível copiar. O navegador negou o acesso à área de transferência.
            <button
              type="button"
              onClick={() => setCopia("ocioso")}
              aria-label="Fechar aviso de cópia"
              className="rounded px-1 text-red-300"
            >
              ×
            </button>
          </p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={nota.kind}
            onChange={(e) => aplicar({ kind: e.target.value as NoteKind })}
            aria-label="Tipo da nota"
            className="rounded bg-ink-800 px-1.5 py-1 text-xs text-ink-200 outline-none
                       focus:ring-1 focus:ring-accent-400"
          >
            {NOTE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>

          <select
            value={nota.workspaceId ?? ""}
            onChange={(e) => aplicar({ workspaceId: e.target.value || null })}
            aria-label="Workspace da nota"
            className="rounded bg-ink-800 px-1.5 py-1 text-xs text-ink-200 outline-none
                       focus:ring-1 focus:ring-accent-400"
          >
            <option value="">sem workspace</option>
            {workspaces?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>

          {/* RF-39/40: tags criadas ao digitar, sem tela de cadastro. */}
          <input
            value={tagsTexto}
            onChange={(e) => setTagsTexto(e.target.value)}
            onBlur={() => {
              const tags = tagsTexto.split(",").map((t) => t.trim()).filter(Boolean);
              const atuais = nota.tags.map((t) => t.name);
              if (JSON.stringify(tags.map((t) => t.toLowerCase())) !== JSON.stringify(atuais)) {
                aplicar({ tags });
              }
            }}
            placeholder="tags, separadas, por vírgula"
            aria-label="Tags da nota"
            className="min-w-40 flex-1 rounded bg-ink-800 px-2 py-1 text-xs text-ink-200
                       outline-none placeholder:text-ink-400/60 focus:ring-1
                       focus:ring-accent-400"
          />

          {camposMeta.length > 0 && (
            <button
              type="button"
              onClick={() => setMetaAberto((v) => !v)}
              aria-expanded={metaAberto}
              className="rounded px-1.5 py-1 text-xs text-ink-400 hover:text-ink-200"
            >
              {metaAberto ? "▾" : "▸"} dados da aula
            </button>
          )}

          {nota.deletedAt ? (
            <span className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={() => restaurar.mutate(nota.id)}
                className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-200
                           hover:border-accent-400"
              >
                Restaurar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Excluir "${nota.title}" definitivamente? Não dá para desfazer.`)) {
                    excluirDefinitivo.mutate(nota.id, { onSuccess: onFechar });
                  }
                }}
                className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-300
                           hover:bg-red-500/10"
              >
                Excluir de vez
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => excluir.mutate(nota.id, { onSuccess: onFechar })}
              className="ml-auto rounded px-2 py-1 text-xs text-ink-400 hover:text-red-300"
            >
              Excluir
            </button>
          )}
        </div>

        {/* RF-46: painel recolhível, fechado por padrão, para não disputar
            espaço com a escrita. */}
        {metaAberto && camposMeta.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2 rounded bg-ink-900/60 p-3">
            {camposMeta.map((campo) => (
              <label key={campo.chave} className="text-xs text-ink-400">
                {campo.rotulo}
                <input
                  defaultValue={String(nota.meta[campo.chave] ?? "")}
                  onBlur={(e) => {
                    const valor = e.target.value.trim();
                    if (valor === String(nota.meta[campo.chave] ?? "")) return;
                    aplicar({ meta: { ...nota.meta, [campo.chave]: valor } });
                  }}
                  className="mt-1 w-full rounded bg-ink-800 px-2 py-1 text-ink-200 outline-none
                             focus:ring-1 focus:ring-accent-400"
                />
              </label>
            ))}
          </div>
        )}
      </header>

      <Editor
        nota={nota}
        conteudo={rascunho.contentMd}
        onConteudo={(contentMd) => setRascunho((r) => ({ ...r, contentMd }))}
        onSalvarAgora={salvarAgora}
        onAbrirNota={onAbrirNota}
        onCriarPorTitulo={onCriarPorTitulo}
        refCorpo={refCorpo}
        modo={modo}
      />

      {/* RF-26 e RF-38: quem aponta para esta nota — outras notas e cards. */}
      {(nota.backlinks.length > 0 || nota.cards.length > 0) && (
        <footer className="flex shrink-0 gap-6 border-t border-ink-800 px-6 py-3">
          {nota.backlinks.length > 0 && (
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-medium uppercase tracking-wider text-ink-400">
                Referenciada por ({nota.backlinks.length})
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {nota.backlinks.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => onAbrirNota(b.id)}
                    className="flex items-center gap-1.5 rounded border border-ink-700 px-2 py-1
                               text-xs text-ink-200 transition hover:border-accent-400"
                  >
                    {b.title}
                    <RotuloTipo tipo={b.kind} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {nota.cards.length > 0 && (
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-medium uppercase tracking-wider text-ink-400">
                Em cards ({nota.cards.length})
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {nota.cards.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onAbrirCard(c.boardId, c.id)}
                    className="flex items-center gap-1.5 rounded border border-ink-700 px-2 py-1
                               text-xs text-ink-200 transition hover:border-accent-400"
                  >
                    {c.title}
                    <span className="text-[10px] text-ink-400">
                      {c.boardName} · {c.columnName}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </footer>
      )}
    </div>
  );
}
