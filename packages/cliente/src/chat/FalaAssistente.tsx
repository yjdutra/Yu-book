import { useMemo } from "react";
import type { ReactNode } from "react";
import { renderMarkdown } from "../markdown";
import { AvatarIA } from "./AvatarIA";

/**
 * Os átomos visuais do chat (Fase 5 da frente de agenda) moram aqui, em
 * `chat/`, e são os mesmos no web e no móvel: só desenham, sem rota nem dado
 * de um app. Quem os usa traz o estado (a sessão) e as ações (abrir, desfazer).
 *
 * Este arquivo importa o renderizador de Markdown: só superfície carregada sob
 * demanda o importa, nunca o que vive no chunk inicial.
 */

/**
 * O texto de uma fala, em Markdown. Sanitizado por DOMPurify dentro de
 * `renderMarkdown` (INV-09) — texto de modelo é entrada não confiável como
 * qualquer outra —, e é só por isso que o `dangerouslySetInnerHTML` é aceitável.
 * Memorizado pelo texto: na fala gravada ele não muda; na em curso, muda a
 * cada pedaço, e renderiza de novo a cada pedaço, como deve.
 */
export function TextoDaFala({ markdown }: { markdown: string }) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown]);
  return (
    <div
      className="preview preview-fala text-ink-200"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * Uma fala do assistente: avatar à esquerda e o texto **sem caixa** em volta —
 * a resposta é para ler, e o balão fica para quem perguntou.
 *
 * - `markdown`: o texto da resposta;
 * - `status`: a linha do passo em curso (`StatusDaResposta`), **depois** do
 *   texto — sozinha antes do primeiro pedaço, e no pé dele quando o modelo
 *   volta a usar uma ferramenta. O nó é o mesmo nos dois casos: a região viva
 *   não remonta quando o texto chega;
 * - `children`: o que vem com ela — fontes, o que foi criado, avisos de corte;
 * - `acoes`: copiar, virar nota… Aparecem com o ponteiro em cima ou o foco
 *   dentro, e **sempre** no toque, onde não há "em cima". Escondidas só por
 *   opacidade: continuam no Tab e no leitor de tela;
 * - `marca`: o modelo que respondeu (RF-25), sempre à vista, discreto.
 */
export function FalaAssistente({
  avatar,
  status,
  markdown,
  children,
  acoes,
  marca,
}: {
  avatar?: ReactNode;
  status?: ReactNode;
  markdown?: string;
  children?: ReactNode;
  acoes?: ReactNode;
  marca?: ReactNode;
}) {
  return (
    <div className="group/fala flex gap-3">
      <div className="pt-0.5">{avatar ?? <AvatarIA />}</div>
      <div className="min-w-0 flex-1">
        {markdown && <TextoDaFala markdown={markdown} />}
        {status}
        {children}
        {(acoes || marca) && (
          <div className="mt-1.5 flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
            {/* A marca primeiro: fica parada onde está, e as ações aparecem
                depois dela, sem empurrá-la. */}
            {marca && <span className="min-w-0 truncate text-miudo text-ink-400">{marca}</span>}
            {acoes && (
              <div
                className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150
                           group-hover/fala:opacity-100 group-focus-within/fala:opacity-100
                           pointer-coarse:opacity-100"
              >
                {acoes}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
