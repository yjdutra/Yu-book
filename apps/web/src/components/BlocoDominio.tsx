/**
 * Identidade visual do link (RF-12).
 *
 * Não é favicon: baixar e guardar a imagem exigiria storage de objetos, que o
 * projeto não tem, e pedir a um serviço de terceiros entregaria a ele a lista
 * de tudo que você salva. A inicial do domínio identifica; a cor só ajuda a
 * reconhecer de relance (RNF-10).
 */

/** RN-06: mesma função, mesmo domínio, mesma cor — sempre. */
function matiz(dominio: string): number {
  let hash = 0;
  for (let i = 0; i < dominio.length; i++) {
    hash = (hash * 31 + dominio.charCodeAt(i)) % 360;
  }
  return hash;
}

interface BlocoDominioProps {
  domain: string;
  /** `md` na grade de favoritos, `sm` na fila. */
  tamanho?: "sm" | "md";
}

export function BlocoDominio({ domain, tamanho = "sm" }: BlocoDominioProps) {
  const h = matiz(domain);
  const inicial = (domain[0] ?? "?").toUpperCase();

  return (
    <span
      aria-hidden="true"
      style={{
        // Par escuro/claro fixo na mesma matiz: o contraste não depende do
        // domínio sorteado, então RNF-11 vale para qualquer link (CA-27).
        backgroundColor: `hsl(${h} 40% 20%)`,
        color: `hsl(${h} 80% 85%)`,
        borderColor: `hsl(${h} 40% 32%)`,
      }}
      className={`flex shrink-0 items-center justify-center rounded border font-semibold ${
        tamanho === "md" ? "size-12 text-lg" : "size-7 text-xs"
      }`}
    >
      {inicial}
    </span>
  );
}
