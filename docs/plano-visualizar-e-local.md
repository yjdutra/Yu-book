# Plano — Modo de visualização e local do evento com Google Maps

Pedido de 2026-10-20. Duas features no celular: tocar num evento ou tarefa **mostra** o item
(hoje abre direto o formulário de edição), e o evento ganha um **lugar de verdade** — buscado no
Google, com mapa e "Como chegar". Ciclo de sempre: plano da fase → desenvolver → testes pontuais →
próxima fase; teste geral no fim.

## O que já existe

`event.location` é texto livre (até 200) e vai de ponta a ponta: formulário do móvel, chat
(`create_event`/`update_event`), MCP e o formatador compartilhado. Nada disso muda de forma: o
texto continua sendo **o nome do local**, e é o que o modelo lê e escreve.

## Decisões

- **Lugar estruturado só no evento.** Tarefa não tem "onde": ganha o modo de visualização, não o
  local. O lugar escolhido no Google grava, ao lado do texto, `placeId`, endereço e coordenadas.
  Editar o texto à mão sem escolher uma sugestão desfaz o vínculo (o lugar vira só texto).
- **O Google é chamado pelo servidor, nunca pelo aparelho.** A chave (`GOOGLE_MAPS_API_KEY`) fica
  na API, opcional como a do YouTube: sem ela o local segue texto livre e o "Abrir no Google
  Maps" busca pelo texto (link público, sem chave). Saída de host fixo — `places.googleapis.com`
  e `maps.googleapis.com` —, como o bucket (INV-08); o endereço nunca vem de fora.
- **Places API (New):** `places:autocomplete` com token de sessão (cobra a sessão, não cada
  tecla), `pt-BR`/`BR`, e o detalhe só com `id,displayName,formattedAddress,location`.
- **Mapa:** imagem do Static Maps pela API (a chave não sai), buscada pelo app com o token e
  mostrada por `blob:`. Sem SDK do Maps no front, sem iframe, sem biblioteca nova.
- **"Como chegar":** link universal do Google Maps (`/maps/dir/?api=1&destination=…`), que no
  celular abre o app de mapas. Não custa chamada.
- **Chat e MCP:** o modelo continua escrevendo só o texto. O formatador passa a mostrar o
  endereço quando houver, para o modelo responder "onde é".
- **Web:** fica como está — a agenda se edita no celular (decisão da frente de agenda).

## Fases

| Fase | Entrega | Pacotes |
|---|---|---|
| F1 | Lugar no evento: colunas, contrato, regra do vínculo, formatador, testes | shared, api |
| F2 | Busca de lugar e mapa estático pela API, com dublê na suíte | shared, api |
| F3 | Modo de visualização de evento e tarefa no móvel | movel |
| F4 | Campo de local com sugestões do Google, mapa e "Como chegar" | cliente, movel |
| Final | Portões, suítes da API e do MCP, telas no navegador | todos |
