import {
  ACEITA_ARQUIVO,
  formatarBytes,
  MAX_ARQUIVOS_CARD,
  MAX_BYTES_ARQUIVO,
} from "@yu-book/shared";
import type { CardFileWithUrl } from "@yu-book/shared";
import { useRef, useState } from "react";
import { ApiError } from "../lib/api";
import { useArquivosDoCard, useEnviarArquivo, useExcluirArquivo } from "../lib/arquivos";
import { Esqueleto } from "./base/Bloco";
import { Botao, BotaoIcone } from "./base/Botao";
import { Dialogo } from "./base/Dialogo";
import { IconeBaixar, IconeLixeira, IconeMais } from "./Icones";

interface AnexosDoCardProps {
  cardId: string;
  boardId: string;
  /** O erro vai para o `Aviso` do painel, que é o lugar de erro da tela. */
  onErro: (mensagem: string) => void;
}

const LIMITE_MB = MAX_BYTES_ARQUIVO / 1024 / 1024;

function extensao(nome: string): string {
  const ponto = nome.lastIndexOf(".");
  return ponto < 0 ? "arq" : nome.slice(ponto + 1).slice(0, 4);
}

/** Abre a URL assinada: a imagem na aba, o resto baixa — decide o objeto. */
function abrir(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Anexos do card (frente de cards, Parte 2).
 *
 * A seção inteira é a zona de soltar: arrastar arquivo sobre ela acende a
 * borda. Os arquivos sobem **um por vez**, na ordem — o servidor confere o teto
 * de anexos antes de cada um, e subir em paralelo passaria dele.
 *
 * As imagens leem direto do bucket pela URL assinada, sem passar pela API. O
 * que não é imagem é linha com nome e tamanho, e abrir baixa com o nome
 * original, porque o objeto foi gravado com `attachment`.
 */
export function AnexosDoCard({ cardId, boardId, onErro }: AnexosDoCardProps) {
  const { data, isLoading, isError } = useArquivosDoCard(cardId);
  const enviar = useEnviarArquivo(cardId, boardId);
  const excluir = useExcluirArquivo(cardId, boardId);
  const entrada = useRef<HTMLInputElement>(null);
  const secao = useRef<HTMLElement>(null);
  const [sobre, setSobre] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [ampliado, setAmpliado] = useState<CardFileWithUrl | null>(null);

  if (isError) {
    return (
      <section aria-label="Anexos">
        <p className="mb-1 rotulo">Anexos</p>
        <p className="text-xs text-ink-400">Não foi possível carregar os anexos.</p>
      </section>
    );
  }

  if (isLoading || !data) {
    return (
      <section aria-label="Anexos">
        <p className="mb-1 rotulo">Anexos</p>
        <Esqueleto linhas={1} alturaLinha={16} />
      </section>
    );
  }

  if (!data.available) {
    return (
      <section aria-label="Anexos">
        <p className="mb-1 rotulo">Anexos</p>
        <p className="text-xs text-ink-400">
          Anexos indisponíveis: o armazenamento não está configurado no servidor.
        </p>
      </section>
    );
  }

  const arquivos = data.files;
  const imagens = arquivos.filter((a) => a.isImage);
  const outros = arquivos.filter((a) => !a.isImage);
  const cheio = arquivos.length >= MAX_ARQUIVOS_CARD;

  async function subir(lista: FileList | File[]) {
    setEnviando(true);
    try {
      for (const arquivo of Array.from(lista)) {
        // O tamanho se confere aqui também: 25 MB atravessando a rede para
        // voltar recusado é espera que a pessoa não precisa ter.
        if (arquivo.size > MAX_BYTES_ARQUIVO) {
          onErro(`"${arquivo.name}" passa de ${LIMITE_MB} MB.`);
          continue;
        }
        try {
          await enviar.mutateAsync(arquivo);
        } catch (e) {
          onErro(
            e instanceof ApiError ? e.message : `Não foi possível anexar "${arquivo.name}".`,
          );
          // Teto atingido: os próximos seriam recusados do mesmo jeito.
          if (e instanceof ApiError && e.status === 422) break;
        }
      }
    } finally {
      setEnviando(false);
    }
  }

  function apagar(arquivo: CardFileWithUrl) {
    if (!confirm(`Excluir o anexo "${arquivo.name}"?`)) return;
    excluir.mutate(arquivo.id, {
      // O botão que tinha o foco sumiu com o anexo; sem isto o foco cai no
      // `body`, e o Esc deixa de fechar o painel.
      onSuccess: () => {
        setAmpliado(null);
        secao.current?.focus();
      },
      onError: (e) =>
        onErro(e instanceof ApiError ? e.message : "Não foi possível excluir o anexo."),
    });
  }

  const temArquivo = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  return (
    <section
      ref={secao}
      tabIndex={-1}
      aria-label="Anexos"
      onDragOver={(e) => {
        if (!temArquivo(e)) return;
        // Sempre, mesmo cheio: sem isto o navegador abre o arquivo no lugar da
        // página, e o que o autosave ainda não gravou se perde.
        e.preventDefault();
        if (cheio) {
          e.dataTransfer.dropEffect = "none";
          return;
        }
        setSobre(true);
      }}
      onDragLeave={(e) => {
        // Atravessar um filho dispara `dragleave` no pai; só conta a saída real.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSobre(false);
      }}
      onDrop={(e) => {
        if (!temArquivo(e)) return;
        e.preventDefault();
        setSobre(false);
        if (cheio) {
          onErro(`Um card aceita até ${MAX_ARQUIVOS_CARD} anexos.`);
          return;
        }
        void subir(e.dataTransfer.files);
      }}
      // A borda existe sempre, transparente: acender não pode mudar o tamanho da seção.
      className={`-m-1.5 rounded-controle border border-dashed p-1.5 outline-none
                  transition-colors ${
        sobre ? "border-accent-400 bg-accent-500/5" : "border-transparent"
      }`}
    >
      <div className="mb-1 flex items-center gap-2">
        <p className="rotulo">
          Anexos {arquivos.length > 0 && <span className="tabular-nums">{arquivos.length}</span>}
        </p>
        <Botao
          variante="fantasma"
          className="ml-auto"
          icone={<IconeMais className="size-3.5" />}
          carregando={enviando}
          disabled={cheio}
          title={cheio ? `Um card aceita até ${MAX_ARQUIVOS_CARD} anexos` : undefined}
          onClick={() => entrada.current?.click()}
        >
          Anexar
        </Botao>
        <input
          ref={entrada}
          type="file"
          multiple
          accept={ACEITA_ARQUIVO}
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const lista = e.target.files;
            if (lista?.length) void subir(Array.from(lista));
            // Limpo, para escolher o mesmo arquivo de novo depois de um erro.
            e.target.value = "";
          }}
        />
      </div>

      {arquivos.length === 0 && (
        <p className="text-xs text-ink-400">
          Solte arquivos aqui ou use Anexar · até {LIMITE_MB} MB · imagem, PDF, texto, Office ou
          zip.
        </p>
      )}

      {imagens.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {imagens.map((img) => (
            <li key={img.id}>
              <button
                type="button"
                onClick={() => setAmpliado(img)}
                aria-label={`Ampliar ${img.name}`}
                title={img.name}
                className="block aspect-square w-full overflow-hidden rounded-controle border
                           border-ink-700 bg-ink-800 transition-colors hover:border-accent-400"
              >
                <img src={img.url} alt="" loading="lazy" className="size-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {outros.length > 0 && (
        <ul className={`space-y-1 ${imagens.length > 0 ? "mt-2" : ""}`}>
          {outros.map((arq) => (
            <li
              key={arq.id}
              className="flex items-center gap-2 rounded-controle border border-ink-700
                         bg-superficie px-2 py-1 text-xs"
            >
              <span
                aria-hidden="true"
                className="shrink-0 rounded-etiqueta bg-ink-700 px-1 font-mono text-miudo uppercase
                           text-ink-400"
              >
                {extensao(arq.name)}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink-200" title={arq.name}>
                {arq.name}
              </span>
              <span className="shrink-0 tabular-nums text-ink-400">
                {formatarBytes(arq.sizeBytes)}
              </span>
              <BotaoIcone
                rotulo={`Baixar ${arq.name}`}
                tamanho="p"
                icone={<IconeBaixar className="size-3.5" />}
                onClick={() => abrir(arq.url)}
              />
              <BotaoIcone
                rotulo={`Excluir ${arq.name}`}
                tamanho="p"
                icone={<IconeLixeira className="size-3.5" />}
                onClick={() => apagar(arq)}
              />
            </li>
          ))}
        </ul>
      )}

      {ampliado && (
        // Por **fora** do `Dialogo`, como em `Conversa.tsx`: a caixa do diálogo
        // tem `tabIndex={-1}` e ganha o foco no clique, e um wrapper dentro
        // dela não veria o Esc. Daqui ele pega toda tecla do portal, que sobe
        // pela árvore do React até o painel do card — e `defaultPrevented`
        // diz ao painel que o Esc já fechou a imagem.
        <div
          className="contents"
          onKeyDown={(e) => {
            if (e.key === "Escape") e.preventDefault();
          }}
        >
          <Dialogo
            aberto
            onFechar={() => setAmpliado(null)}
            rotulo={`Anexo ${ampliado.name}`}
            largura="max-w-5xl"
          >
            <div className="p-4">
              <img
                src={ampliado.url}
                alt={ampliado.name}
                className="mx-auto max-h-[64vh] w-auto rounded-controle object-contain"
              />
              <div className="mt-3 flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm text-ink-200" title={ampliado.name}>
                  {ampliado.name}
                  <span className="ml-2 text-xs tabular-nums text-ink-400">
                    {formatarBytes(ampliado.sizeBytes)}
                  </span>
                </p>
                <Botao
                  icone={<IconeBaixar className="size-3.5" />}
                  onClick={() => abrir(ampliado.url)}
                >
                  Abrir original
                </Botao>
                <Botao
                  variante="perigo"
                  icone={<IconeLixeira className="size-3.5" />}
                  carregando={excluir.isPending}
                  onClick={() => apagar(ampliado)}
                >
                  Excluir
                </Botao>
                <Botao variante="fantasma" onClick={() => setAmpliado(null)}>
                  Fechar
                </Botao>
              </div>
            </div>
          </Dialogo>
        </div>
      )}
    </section>
  );
}
