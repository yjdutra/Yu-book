import { chaveDaFonteDoChat } from "@yu-book/shared";
import type { ChatSource } from "@yu-book/shared";
import { Etiqueta } from "../base/Etiqueta";
import { IconeGlobo } from "../Icones";

/** A fonte que mora no acervo e abre pelo id — a da web abre pelo endereço, sem a casca. */
export type FonteDoAcervo = Exclude<ChatSource, { kind: "web" }>;

/**
 * O endereço de uma fonte da web, se ele for navegável.
 *
 * O servidor só grava `http(s)` — `open_page` recusa o resto, e a citação da
 * busca vem do provedor —, mas o `href` é o último ponto antes do clique, e um
 * `javascript:` ali executaria no Yu-book. A tela confere de novo: o que não
 * for `http(s)` vira rótulo, não link.
 */
function enderecoNavegavel(url: string): URL | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/** O domínio, sem `www.` — é o que diz de onde veio, e cabe na pílula. */
export function dominioDe(url: string): string {
  return enderecoNavegavel(url)?.hostname.replace(/^www\./, "") ?? url;
}

function FonteWeb({ fonte }: { fonte: Extract<ChatSource, { kind: "web" }> }) {
  const dominio = dominioDe(fonte.url);
  const titulo = fonte.title.trim();
  // O título da página vem depois do domínio: truncado, ele some primeiro, e a
  // origem continua à vista.
  const texto = titulo && titulo !== fonte.url && titulo !== dominio
    ? `${dominio} · ${titulo}`
    : dominio;
  const icone = <IconeGlobo className="size-3" />;
  // Sem favicon, de propósito: buscá-lo seria o navegador chamando o site de
  // terceiro (ou um serviço de ícones) só por a resposta ter sido exibida.
  if (!enderecoNavegavel(fonte.url)) {
    return (
      <Etiqueta icone={icone} titulo={fonte.url}>
        {texto}
      </Etiqueta>
    );
  }
  return (
    <Etiqueta
      como="a"
      href={fonte.url}
      tom="destaque"
      icone={icone}
      titulo={titulo ? `${titulo}\n${fonte.url}` : fonte.url}
    >
      {texto}
    </Etiqueta>
  );
}

/**
 * O que um turno do chat — ou um passo de rotina — consultou (RN-05).
 *
 * Nota e quadro têm rota própria. **Card não tem rota sem o quadro**
 * (`/b/:boardId/c/:cardId`), e a fonte carrega só o id do card — então o chip
 * de um card não navega, e por isso ele não é um botão: um controle que não
 * faz nada é pior do que um rótulo honesto.
 *
 * A fonte da web (Etapa G) é link externo, com o domínio e o globo: a
 * diferença para a do acervo não fica só na cor (RNF-09). Ela não passa por
 * `onAbrir` — sair do Yu-book não é navegação da casca.
 *
 * **A repetição sai aqui**, pela `chaveDaFonteDoChat` — a mesma com que a API
 * deduplica o histórico gravado. A fala em curso chega somada, evento a
 * evento: buscar e depois ler a mesma nota é o caminho normal do laço, e a
 * sessão não deduplica para não levar o módulo `chat` de `shared` ao bundle
 * inicial (`lib/sessaoChat.tsx`, no `case "fontes"`).
 */
export function Fontes({
  fontes,
  onAbrir,
  className = "mt-2",
}: {
  fontes: ChatSource[];
  onAbrir: (f: FonteDoAcervo) => void;
  className?: string;
}) {
  const vistas = new Set<string>();
  const unicas: { chave: string; fonte: ChatSource }[] = [];
  for (const fonte of fontes) {
    const chave = chaveDaFonteDoChat(fonte);
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    unicas.push({ chave, fonte });
  }
  if (unicas.length === 0) return null;
  return (
    <div className={`${className} flex flex-wrap items-center gap-1.5`}>
      <span className="text-miudo text-ink-400">consultou</span>
      {unicas.map(({ chave, fonte: f }) =>
        f.kind === "web" ? (
          <FonteWeb key={chave} fonte={f} />
        ) : f.kind === "card" ? (
          <Etiqueta key={chave}>{f.title}</Etiqueta>
        ) : (
          <Etiqueta
            key={chave}
            tom="destaque"
            como="button"
            onClick={() => onAbrir(f)}
            titulo={f.kind === "note" ? "Abrir a nota" : "Abrir o quadro"}
          >
            {f.title}
          </Etiqueta>
        ),
      )}
    </div>
  );
}
