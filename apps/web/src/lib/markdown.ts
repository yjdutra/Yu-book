import { normalizarTitulo } from "@yu-book/shared";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import { Marked } from "marked";

// Subconjunto de linguagens em vez do pacote inteiro: o bundle completo do
// highlight.js passa de 1 MB.
for (const [nome, def] of [
  ["typescript", typescript],
  ["javascript", typescript],
  ["python", python],
  ["sql", sql],
  ["bash", bash],
  ["json", json],
  ["xml", xml],
  ["html", xml],
  ["css", css],
] as const) {
  hljs.registerLanguage(nome, def);
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Extensão para `[[titulo]]` (RF-21).
 *
 * O `titulo` vai escapado para o HTML e normalizado para o atributo de dados —
 * a mesma normalização do banco, senão um link válido apareceria como quebrado.
 */
const wikilink = {
  name: "wikilink",
  level: "inline" as const,
  start(src: string) {
    return src.indexOf("[[");
  },
  tokenizer(src: string) {
    const match = /^\[\[([^\][\n]+?)\]\]/.exec(src);
    if (!match) return undefined;
    return { type: "wikilink", raw: match[0], text: (match[1] ?? "").trim() };
  },
  renderer(token: { text: string }) {
    const titulo = escapar(token.text);
    return `<a class="wikilink" data-wikilink="${escapar(normalizarTitulo(token.text))}" href="#">${titulo}</a>`;
  },
};

const marked = new Marked({ gfm: true, breaks: true });

marked.use({
  extensions: [wikilink],
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const idioma = lang && hljs.getLanguage(lang) ? lang : null;
      const corpo = idioma
        ? hljs.highlight(text, { language: idioma }).value
        : escapar(text);
      return `<pre><code class="hljs language-${idioma ?? "plain"}">${corpo}</code></pre>`;
    },
  },
});

/**
 * RNF-19: o resultado passa por DOMPurify antes de virar DOM. Uma nota pode
 * conter HTML bruto (o Markdown permite) e o conteúdo é do próprio usuário,
 * mas texto colado de terceiros também acaba em nota — sanitizar é barato.
 */
export function renderMarkdown(md: string): string {
  const bruto = marked.parse(md, { async: false }) as string;

  return DOMPurify.sanitize(bruto, {
    ADD_ATTR: ["data-wikilink", "target", "rel"],
    ADD_TAGS: ["input"], // checkbox de lista de tarefas do GFM
    FORBID_TAGS: ["style", "form", "iframe", "object", "embed"],
    FORBID_ATTR: ["style", "onerror", "onload", "onclick"],
  });
}

/** Títulos usados por `[[…]]`, para marcar os não resolvidos (RF-24). */
export function marcarNaoResolvidos(container: HTMLElement, existentes: Set<string>): void {
  for (const el of container.querySelectorAll<HTMLAnchorElement>("a.wikilink")) {
    const alvo = el.dataset.wikilink ?? "";
    el.classList.toggle("wikilink-quebrado", !existentes.has(alvo));
  }
}
