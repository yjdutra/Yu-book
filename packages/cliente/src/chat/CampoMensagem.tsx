import { useEffect, useLayoutEffect, useRef } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { Aviso } from "../base/Aviso";
import { juntarDitado, useDitado } from "../ditado";
import { IconeEnviar, IconeMicrofone, IconeParar } from "../Icones";

/**
 * O compositor do chat, só o desenho (Fase 5 da frente de agenda): o campo que
 * cresce até um teto, a linha de baixo com o que quem usa puser à esquerda
 * (agente, anexos) e, à direita, o microfone e o botão redondo de enviar — que
 * vira parar enquanto a resposta chega. O que se envia, as menções e o
 * contexto são de quem usa; a voz é daqui, porque é igual nos dois fronts.
 *
 * Os dois botões redondos são `<button>` próprios, e não `BotaoIcone`: o
 * primitivo é quadrado de canto `controle` e não tem o gradiente; uma variante
 * dele só para este lugar custaria bytes nos dois apps sem outro consumidor.
 *
 * **O ditado nunca envia.** O trecho final entra no campo, com espaço, e quem
 * fala revê antes de mandar. Enquanto ouve, o campo mostra o parcial ao vivo e
 * fica só de leitura — digitar e ditar ao mesmo tempo disputariam o texto.
 * `Enter` ali encerra o ditado (guardando o que já foi dito); `Esc` descarta,
 * com o foco em qualquer ponto do compositor — inclusive no microfone. Enviar
 * no meio do ditado manda o que se vê, parcial incluído, e encerra a escuta.
 */
export function CampoMensagem({
  valor,
  onMudar,
  onEnviar,
  onParar,
  respondendo,
  podeEnviar,
  desabilitado = false,
  campoRef,
  onKeyDown,
  placeholder,
  rotulo = "Sua pergunta",
  descritoPor,
  acima,
  esquerda,
  dica,
  enviarComEnter = true,
  teto = 200,
  toque = false,
}: {
  valor: string;
  onMudar: (valor: string) => void;
  /**
   * Recebe o texto **à vista**: com o ditado ouvindo, é o `valor` mais o
   * parcial, que ainda não passou por `onMudar` — quem envia não o conhece.
   */
  onEnviar: (texto: string) => void;
  onParar: () => void;
  /** A resposta está chegando: o botão de enviar vira parar. */
  respondendo: boolean;
  /** Há texto e nada bloqueia — o botão de enviar acende. */
  podeEnviar: boolean;
  desabilitado?: boolean;
  campoRef?: RefObject<HTMLTextAreaElement | null>;
  /**
   * Roda antes do `Enter` que envia. Quem tratar a tecla (o menu do `@`)
   * chama `preventDefault`, e o campo não envia.
   */
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  rotulo?: string;
  descritoPor?: string;
  /** Dentro do cartão, acima do campo: os anexos em pílulas. */
  acima?: ReactNode;
  /** Na linha de baixo, à esquerda: o seletor de agente, um botão de anexar. */
  esquerda?: ReactNode;
  /** Abaixo do cartão, miúda: a dica de atalho. */
  dica?: ReactNode;
  /** No toque o `Enter` do teclado virtual é quebra de linha; envia o botão. */
  enviarComEnter?: boolean;
  /** Altura máxima do campo, em px; dali em diante ele rola. */
  teto?: number;
  /** Botões do tamanho do dedo (44px) e letra de 16px, que o celular não amplia. */
  toque?: boolean;
}) {
  const interno = useRef<HTMLTextAreaElement>(null);
  const ref = campoRef ?? interno;
  /// O ditado entrega o trecho final depois, por callback: precisa do texto de
  /// agora, não do que havia quando começou a ouvir.
  const valorRef = useRef(valor);
  valorRef.current = valor;

  const ditado = useDitado({
    aoFinal: (trecho) => onMudar(juntarDitado(valorRef.current, trecho)),
  });
  const { ouvindo, parcial, suportado } = ditado;
  const exibido = ouvindo && parcial ? juntarDitado(valor, parcial) : valor;

  /// O campo bloqueado (sem modelo, agente excluído) não pode seguir ouvindo.
  useEffect(() => {
    if (desabilitado) ditado.cancelar();
  }, [desabilitado, ditado.cancelar]);

  /// Cresce com o texto até o teto. Em efeito de layout, antes da pintura —
  /// senão o campo pisca na altura velha a cada tecla.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, teto)}px`;
    el.style.overflowY = el.scrollHeight > teto ? "auto" : "hidden";
  }, [exibido, teto, ref]);

  function enviar() {
    /// O que se vê é o que vai: o parcial ainda não chegou a `onMudar`, e
    /// cancelar antes de ler o descartaria. Cancelar, e não `parar`: o trecho
    /// final que o navegador entregaria depois cairia no campo já enviado.
    const texto = exibido;
    if (ouvindo) ditado.cancelar();
    onEnviar(texto);
  }

  /// O `Esc` do ditado com o foco fora do campo — no microfone, no enviar. O
  /// do campo para antes (`teclas`); este chega pelo borbulhar. `preventDefault`
  /// junto do `stopPropagation`: quem está em volta e confere `defaultPrevented`
  /// (o painel do assistente do web) também o deixa passar.
  function escDoDitado(e: KeyboardEvent<HTMLDivElement>) {
    if (!ouvindo || e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    ditado.cancelar();
  }

  function teclas(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (ouvindo && (e.key === "Escape" || e.key === "Enter")) {
      // A tecla é do ditado: o Esc não fecha o painel em volta, o Enter não envia.
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Enter") ditado.parar();
      else ditado.cancelar();
      return;
    }
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    // Enter envia; Shift+Enter quebra linha. É a convenção que todo campo de
    // conversa usa, e contrariá-la surpreende antes de ensinar. Durante a
    // composição de um acento (IME), o Enter é dela.
    if (enviarComEnter && e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      enviar();
    }
  }

  const botao = toque ? "size-11" : "size-8";
  const icone = toque ? "size-5" : "size-4";

  return (
    <div onKeyDown={escDoDitado}>
      {/* O anel de foco do campo vai no cartão inteiro, com o mesmo traço do
          global (`data-anel="cartao"` em `tema.css`): o contorno do campo
          cortaria o cartão arredondado ao meio. */}
      <div
        className="rounded-dialogo border border-ink-700/80 bg-superficie shadow-e2 transition
                   duration-150 focus-within:shadow-brilho-ia
                   has-[textarea:focus-visible]:outline-2
                   has-[textarea:focus-visible]:outline-offset-2
                   has-[textarea:focus-visible]:outline-accent-400"
      >
        {acima && <div className="flex flex-wrap gap-1 px-3 pt-2.5">{acima}</div>}
        <textarea
          ref={ref}
          value={exibido}
          onChange={(e) => {
            if (!ouvindo) onMudar(e.target.value);
          }}
          onKeyDown={teclas}
          rows={1}
          data-anel="cartao"
          readOnly={ouvindo}
          disabled={desabilitado}
          aria-label={rotulo}
          aria-describedby={descritoPor}
          placeholder={ouvindo ? "Fale agora…" : placeholder}
          className={`block w-full resize-none bg-transparent px-4 pt-3 pb-1 leading-relaxed
                      text-ink-200 outline-none placeholder:text-ink-400 disabled:opacity-50
                      ${toque ? "text-base" : "text-[0.9375rem]"}`}
        />
        <div className="flex items-center gap-1.5 px-2 pb-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {esquerda}
            {/* Montada sempre: região viva que nasce preenchida passa calada. */}
            <span
              aria-live="polite"
              className="inline-flex min-w-0 items-center gap-1.5 text-xs text-red-300"
            >
              {ouvindo && (
                <>
                  <span
                    aria-hidden="true"
                    className="size-2 animate-pulse rounded-full bg-red-400"
                  />
                  <span className="truncate">Ouvindo…</span>
                </>
              )}
            </span>
          </div>

          {suportado && (
            <button
              type="button"
              onClick={() => {
                if (ouvindo) {
                  ditado.parar();
                } else {
                  ditado.limparErro();
                  ditado.iniciar();
                  /// O foco vai ao campo, onde `Enter` encerra e `Esc` descarta.
                  /// No toque, não: focar o campo abriria o teclado virtual
                  /// por cima do que se está ditando.
                  if (!toque) ref.current?.focus();
                }
              }}
              disabled={desabilitado}
              aria-pressed={ouvindo}
              aria-label="Ditar por voz"
              title={
                ouvindo
                  ? "Parar de ouvir"
                  : "Ditar por voz. O áudio vai ao serviço de reconhecimento do navegador " +
                    "(no Chrome, o Google); o texto entra no campo, sem enviar."
              }
              className={`inline-flex ${botao} shrink-0 items-center justify-center rounded-full
                          transition duration-150 disabled:cursor-not-allowed disabled:opacity-50
                          ${
                            ouvindo
                              ? "bg-red-500/15 text-red-300 ring-2 ring-red-400/60"
                              : "text-ink-400 hover:bg-ink-800 hover:text-ink-200"
                          }`}
            >
              <IconeMicrofone className={icone} />
            </button>
          )}

          {respondendo ? (
            <button
              type="button"
              onClick={onParar}
              aria-label="Parar a resposta"
              title="Parar a resposta"
              className={`inline-flex ${botao} shrink-0 items-center justify-center rounded-full
                          bg-ink-200 text-ink-950 shadow-e1 transition duration-150
                          hover:bg-titulo`}
            >
              <IconeParar className={icone} />
            </button>
          ) : (
            <button
              type="button"
              onClick={enviar}
              disabled={!podeEnviar}
              aria-label="Enviar"
              title="Enviar"
              className={`inline-flex ${botao} shrink-0 items-center justify-center rounded-full
                          transition duration-150 disabled:cursor-not-allowed
                          ${
                            podeEnviar
                              ? `bg-linear-to-br from-accent-500 to-ia-500 text-white shadow-e1
                                 hover:shadow-brilho-ia`
                              : "bg-ink-800 text-ink-400"
                          }`}
            >
              <IconeEnviar className={icone} />
            </button>
          )}
        </div>
      </div>

      {ditado.erro && (
        <Aviso tom="alerta" urgente onFechar={ditado.limparErro} className="mt-2">
          {ditado.erro}
        </Aviso>
      )}
      {dica && <p className="mt-1.5 px-1 text-center text-miudo text-ink-400">{dica}</p>}
    </div>
  );
}
