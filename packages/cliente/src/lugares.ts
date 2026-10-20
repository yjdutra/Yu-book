import type { EventPlace, PlaceDetail, PlaceSuggestion } from "@yu-book/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, apiStream } from "./api";

/* ---------------------------------------------------------------
   Lugares do Google para o local do evento, pela API (a chave não
   sai dela). Só `import type` de shared: o `MIN_BUSCA_DE_LUGAR` é
   repetido aqui de propósito (ver `contrato-compartilhado`).
   --------------------------------------------------------------- */

const MIN_BUSCA = 3;
const ESPERA_MS = 300;

/** O texto depois de parar de digitar: uma chamada por pausa, não por tecla. */
function useAssentado(valor: string): string {
  const [assentado, setAssentado] = useState(valor);
  useEffect(() => {
    const id = setTimeout(() => setAssentado(valor), ESPERA_MS);
    return () => clearTimeout(id);
  }, [valor]);
  return assentado;
}

/**
 * As sugestões para o que se digita. `sessao` é o token que o Google cobra
 * uma vez por busca — o mesmo até escolher, e um novo depois. `ativo` falso
 * (o campo sem foco, ou o texto já escolhido) não busca nada.
 */
export function useSugestoesDeLugar(texto: string, sessao: string, ativo: boolean) {
  const q = useAssentado(texto.trim());
  return useQuery({
    queryKey: ["lugares", "sugestoes", sessao, q],
    queryFn: () =>
      api.get<PlaceSuggestion[]>(
        `/places/autocomplete?q=${encodeURIComponent(q)}&session=${encodeURIComponent(sessao)}`,
      ),
    enabled: ativo && q.length >= MIN_BUSCA,
    staleTime: 5 * 60_000,
    // Sem chave no servidor é 503 de propósito: tentar de novo não muda nada.
    retry: false,
  });
}

/** O detalhe do lugar escolhido; fecha a sessão de cobrança do autocomplete. */
export function detalharLugar(placeId: string, sessao: string): Promise<PlaceDetail> {
  return api.get<PlaceDetail>(
    `/places/${encodeURIComponent(placeId)}?session=${encodeURIComponent(sessao)}`,
  );
}

/**
 * A imagem do mapa em volta do lugar, no tema da tela. Vem da API com o
 * token (a `<img>` não manda cabeçalho), e vira um `blob:` que se solta
 * quando o lugar ou o tema mudam.
 */
export function useMapaDoLugar(place: EventPlace | null) {
  const tema =
    typeof document !== "undefined" && document.documentElement.dataset.tema === "claro"
      ? "claro"
      : "escuro";
  const consulta = useQuery({
    queryKey: ["lugares", "mapa", place?.lat, place?.lng, tema],
    queryFn: async () => {
      const resposta = await apiStream(
        `/places/map?lat=${place?.lat}&lng=${place?.lng}&tema=${tema}`,
      );
      return resposta.blob();
    },
    enabled: place !== null,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: false,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!consulta.data) return void setUrl(null);
    const novo = URL.createObjectURL(consulta.data);
    setUrl(novo);
    return () => URL.revokeObjectURL(novo);
  }, [consulta.data]);
  return { url, carregando: consulta.isPending && place !== null, erro: consulta.error };
}
