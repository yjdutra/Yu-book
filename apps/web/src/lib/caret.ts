/**
 * Coordenadas do cursor dentro de um textarea.
 *
 * O DOM não expõe isso. A técnica padrão é espelhar o textarea num div com os
 * mesmos estilos, cortar o texto até o cursor e medir onde um marcador cai.
 */
const PROPRIEDADES = [
  "boxSizing",
  "width",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontFamily",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
  "textIndent",
  "textTransform",
  "whiteSpace",
  "wordBreak",
  "overflowWrap",
] as const;

export interface PosicaoCursor {
  topo: number;
  esquerda: number;
  altura: number;
}

export function posicaoDoCursor(campo: HTMLTextAreaElement, indice: number): PosicaoCursor {
  const espelho = document.createElement("div");
  const estilo = window.getComputedStyle(campo);

  for (const prop of PROPRIEDADES) {
    espelho.style[prop] = estilo[prop];
  }
  espelho.style.position = "absolute";
  espelho.style.visibility = "hidden";
  espelho.style.whiteSpace = "pre-wrap";
  espelho.style.overflowWrap = "break-word";
  espelho.style.height = "auto";

  espelho.textContent = campo.value.slice(0, indice);

  // Um span vazio no fim marca exatamente onde o cursor está.
  const marcador = document.createElement("span");
  marcador.textContent = campo.value.slice(indice) || ".";
  espelho.appendChild(marcador);

  document.body.appendChild(espelho);
  const topo = marcador.offsetTop;
  const esquerda = marcador.offsetLeft;
  const altura = Number.parseFloat(estilo.lineHeight) || 18;
  document.body.removeChild(espelho);

  return {
    topo: topo - campo.scrollTop,
    esquerda: esquerda - campo.scrollLeft,
    altura,
  };
}

/**
 * Detecta um `[[` aberto imediatamente antes do cursor (RF-22).
 * Devolve o termo já digitado e onde o `[[` começa.
 */
export function wikilinkEmDigitacao(
  texto: string,
  cursor: number,
): { termo: string; inicio: number } | null {
  const antes = texto.slice(0, cursor);
  const match = /\[\[([^\][\n]*)$/.exec(antes);
  if (!match) return null;
  return { termo: match[1] ?? "", inicio: match.index };
}
