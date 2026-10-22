import { Aviso } from "@yu-book/cliente/base/Aviso";

/**
 * O aviso de quando o gasto sai do OpenRouter, e não dos créditos mensais do
 * plano do Claude (docs/plano-provedor-anthropic.md). A Anthropic é o padrão da
 * tela; escolher um modelo do outro provedor — no catálogo, no quadro de
 * tarefas ou no editor do agente — mostra esta mesma frase, num lugar só.
 *
 * `onde` diz o que está usando o OpenRouter ("a tarefa chat", "este agente"),
 * para a frase apontar o que mudar.
 */
export function AvisoOpenRouter({
  onde,
  plural = false,
  className,
}: {
  onde?: string;
  plural?: boolean;
  className?: string;
}) {
  const sujeito = onde ? `${onde.charAt(0).toUpperCase()}${onde.slice(1)}` : "Estes modelos";
  const verbo = onde && !plural ? "usa" : "usam";
  return (
    <Aviso tom="alerta" className={className}>
      {sujeito} {verbo} o
      OpenRouter: o gasto sai da sua conta lá,{" "}
      <strong>não dos créditos do plano do Claude</strong>. O teto diário do Yu-book vale igual.
    </Aviso>
  );
}
