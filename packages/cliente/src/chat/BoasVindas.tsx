import type { ReactNode } from "react";
import { AvatarIA } from "./AvatarIA";

/**
 * A conversa vazia sem agente: o avatar grande no gradiente da IA, a saudação
 * pelo primeiro nome e o que dá para pedir. Com agente escolhido, quem desenha
 * mostra a apresentação dele no lugar — as premissas importam mais que a
 * saudação nessa hora.
 *
 * `compacto` é o painel lateral do web e a tela estreita: alinhado à esquerda,
 * um degrau menor.
 */
export function BoasVindas({
  nome,
  descricao,
  compacto = false,
  children,
}: {
  /** O primeiro nome de quem usa; vazio, a saudação fica sem nome. */
  nome?: string;
  descricao?: ReactNode;
  compacto?: boolean;
  /** As sugestões (`Sugestoes`), abaixo do texto. */
  children?: ReactNode;
}) {
  return (
    <div
      className={
        compacto
          ? "flex flex-col items-start pt-2"
          : "flex flex-col items-center pt-[8vh] text-center"
      }
    >
      <AvatarIA tamanho="g" />
      <h2
        className={`font-semibold tracking-tight text-titulo ${
          compacto ? "mt-4 text-lg" : "mt-5 text-2xl"
        }`}
      >
        Como posso ajudar{nome ? `, ${nome}` : ""}?
      </h2>
      {descricao && (
        <p className={`mt-1.5 text-sm text-ink-400 ${compacto ? "" : "max-w-md"}`}>{descricao}</p>
      )}
      {children && <div className={compacto ? "mt-5" : "mt-7 max-w-xl"}>{children}</div>}
    </div>
  );
}
