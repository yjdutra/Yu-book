# PRD — Yu-book Fase 3: Gaveta de links

**Versão:** v0.1 (draft) · **Autor:** Yuri · **Data:** 2026-08-14 · **Status:** rascunho

Contexto anterior: [PROPOSTA.md](../PROPOSTA.md) (escopo geral), [README.md](../README.md) (Fases 0, 1
e 2 concluídas), [docs/prd-fase-1-notas.md](prd-fase-1-notas.md) e
[docs/prd-fase-2-kanban.md](prd-fase-2-kanban.md).

> Esta fase **não** estava na proposta original. Ela entra no lugar da agenda no Google Calendar,
> que foi adiada por ser pontual e menos aguardada — ver seção 7 da PROPOSTA.

---

## 1. Contexto e problema

Duas coisas acontecem o dia inteiro e hoje não têm lugar no Yu-book.

A primeira: existe um punhado de sites que você abre toda hora — a plataforma da Cod3rs, o GitHub,
o Railway, a documentação de alguma coisa. Eles vivem espalhados entre a barra de favoritos do
navegador (que some quando você troca de perfil ou de máquina) e a memória muscular de digitar o
endereço. Não é um problema grave; é atrito constante.

A segunda é mais concreta: você esbarra num vídeo, num artigo, numa thread que **quer ver, mas não
agora**. Hoje o destino disso é uma aba aberta que fica de pé por três dias até o navegador ser
fechado, ou uma mensagem enviada para você mesmo no WhatsApp. As duas soluções perdem o link.

O que falta não é um gerenciador de bookmarks com pastas, tags e busca — isso o navegador já faz e
você não usa. O que falta é **uma gaveta**: arrastar o link para dentro dela e esquecer, e depois
achar o que guardou em um lugar só. Duas listas com propósitos opostos: uma que você quer que dure
(favoritos) e uma que você quer **esvaziar** (ver depois).

A diferença entre as duas não é de estrutura, é de intenção. Por isso são **uma** entidade `Link`
com um campo `kind` — o mesmo princípio que faz aula, projeto e trilha serem uma `Note` só
(seção 1 da PROPOSTA). Mover um link de uma lista para a outra é trocar uma palavra, não migrar
registro.

Prazo-alvo: **1,5 a 2 dias de trabalho**.

---

## 2. Objetivos

- **O1** — Guardar um link sem interromper o que você está fazendo: arrastar da outra janela, soltar
  em cima do Yu-book, pronto. Sem abrir tela, sem preencher formulário, sem escolher pasta.
- **O2** — Reconhecer o que foi guardado sem abrir: um link do YouTube aparece com o nome do vídeo,
  não com `watch?v=dQw4w9WgXcQ`.
- **O3** — Chegar aos sites de sempre em um atalho, de qualquer tela, sem tirar as mãos do teclado.
- **O4** — Fazer a fila de "ver depois" encolher: consumir um item e removê-lo é **um** clique, e a
  idade de cada item fica visível para que a fila não vire um depósito silencioso.

### 2.1 Métricas de sucesso

| | Métrica | Baseline | Alvo | Prazo |
|---|---|---|---|---|
| **M1** | Tempo entre soltar o link e ele aparecer na gaveta | não existe | ≤ 100 ms (aparência otimista, RF-08) | entrega |
| **M2** | p95 de `POST /links`, incluindo a busca do título | não existe | ≤ 2,2 s (orçamento de 2 s + folga) | entrega |
| **M3** | Links de "ver depois" salvos com título de verdade, não com o domínio | não existe | ≥ 80% | 1 mês após deploy |
| **M4** | Links guardados nas 2 primeiras semanas de uso real | 0 | ≥ 15 | 2 semanas após deploy |
| **M5** | Itens de "ver depois" removidos por terem sido consumidos, no primeiro mês | 0 | ≥ 60% dos que entraram | 1 mês após deploy |
| **M6** | Idade média da fila de "ver depois" ao fim do primeiro mês | não existe | ≤ 14 dias | 1 mês após deploy |

M5 e M6 são as que importam: elas dizem se a fila está sendo consumida ou se virou o mesmo depósito
que a barra de favoritos do navegador — caso em que a funcionalidade falhou, ainda que funcione.

---

## 3. Não-objetivos

- **NO1** — Pastas, hierarquia, tags ou coleções de links. Duas listas, sem subdivisão.
- **NO2** — Busca de links na paleta `Ctrl+K`. A gaveta tem filtro próprio (RF-19) e cabe numa
  tela; misturar link com nota e card na paleta é ruído. Entra depois, se fizer falta.
- **NO3** — Ícone real do site (favicon). Baixar e guardar imagem exige storage de objetos, que o
  projeto não tem (NO6 da Fase 1); buscar de um serviço de terceiros entregaria seu histórico de
  navegação a ele. A identidade visual é uma inicial em bloco colorido (RF-12).
- **NO4** — Miniatura, resumo ou pré-visualização do conteúdo.
- **NO5** — Importar favoritos do navegador, extensão de navegador, bookmarklet.
- **NO6** — Vínculo entre link e nota/card. Se o link importa para um projeto, ele vira uma linha na
  nota — que é o que o Markdown já faz.
- **NO7** — Arquivamento ou lixeira de link. Excluir é definitivo, com desfazer imediato (RN-05).
- **NO8** — Contador de acessos, "mais usados", ordenação automática por frequência.
- **NO9** — Escopo por workspace. A gaveta é uma só (RN-01).
- **NO10** — Expiração automática de "ver depois". Nada some sozinho (RN-04).
- **NO11** — Compartilhar link, exportar lista, RSS.
- **NO12** — Layout responsivo. Continua desktop-only, como o resto.

---

## 4. Personas e usuários-alvo

**Usuário único: você.** Dois momentos de uso, com exigências opostas:

| Momento | Frequência | O que exige |
|---|---|---|
| **Capturando** — no meio de outra coisa, esbarrou num vídeo | várias vezes por dia | zero cliques além do arrastar; nada pode roubar o foco do que estava sendo feito |
| **Consumindo** — sentou para limpar a fila, ou precisa de um site de sempre | diária | abrir em um clique, remover em um clique, saber de relance o que é velho |

O momento de captura é o crítico: se salvar um link exigir abrir uma tela e preencher um campo,
você não vai fazer — vai deixar a aba aberta, como faz hoje.

---

## 5. Requisitos funcionais

### 5.1 Captura

- **RF-01** — Arrastar um link de qualquer lugar (outra janela do navegador, outra aba, a barra de
  endereço) para **qualquer ponto** da janela do Yu-book revela duas zonas de soltura: `Favoritos`
  e `Ver depois`.
- **RF-02** — As zonas de soltura só aparecem quando o que está sendo arrastado é uma URL. Arrastar
  um card do kanban (Fase 2) não as invoca.
- **RF-03** — Soltar em uma das zonas salva o link naquela lista e fecha a sobreposição.
- **RF-04** — Sair da janela com o arrasto, ou soltar fora das zonas, cancela sem salvar nada.
- **RF-05** — A gaveta aberta aceita colar (`Ctrl+V`) uma URL, que vai para a aba visível no momento.
- **RF-06** — A gaveta tem um campo para colar ou digitar uma URL manualmente, com um botão para
  cada lista.
- **RF-07** — O sistema aceita apenas URLs `http` e `https`. Qualquer outro esquema é recusado com
  uma mensagem, sem salvar.
- **RF-08** — O link aparece na lista **imediatamente** após soltar, com o domínio como nome
  provisório, antes de a API responder.
- **RF-09** — Quando a API responde, o nome provisório é substituído pelo título real da página.
- **RF-10** — Se salvar falhar, o item some da lista e um erro persistente é exibido com a URL, para
  que ela não se perca.

### 5.2 Título e identidade visual

- **RF-11** — Ao salvar, o servidor busca o título da página (`<title>` ou `og:title`) e o usa como
  nome do link. Sem título disponível, o nome é o domínio.
- **RF-12** — Cada link exibe um bloco com a inicial do domínio e uma cor derivada dele — sempre a
  mesma cor para o mesmo domínio (RN-06).
- **RF-13** — O sistema permite renomear qualquer link.
- **RF-14** — O sistema permite pedir a rebusca do título de um link salvo com o domínio como nome.

### 5.3 A gaveta

- **RF-15** — `Ctrl+Shift+L` abre e fecha a gaveta sobre qualquer tela; `Esc` fecha.
- **RF-16** — A coluna de navegação tem um item que abre a gaveta, com a contagem de "ver depois".
- **RF-17** — A gaveta tem duas abas: `Favoritos` e `Ver depois`, esta com a contagem de itens.
- **RF-18** — A gaveta é operável só pelo teclado: `Tab`/setas navegam, `Enter` abre o link,
  `Delete` remove, `←`/`→` trocam de aba.
- **RF-19** — A gaveta filtra por texto conforme a digitação, sobre nome e domínio, na aba visível.
- **RF-20** — Abrir um link o abre em uma nova aba, sem tirar o Yu-book do lugar.

### 5.4 Favoritos

- **RF-21** — Favoritos são exibidos em grade, na ordem definida por você.
- **RF-22** — O sistema permite reordenar favoritos por arrasto, com a mesma acessibilidade por
  teclado do kanban (`Espaço` pega, setas movem, `Espaço` solta, `Esc` cancela).
- **RF-23** — O sistema permite excluir um favorito.

### 5.5 Ver depois

- **RF-24** — A lista é ordenada do mais recente para o mais antigo.
- **RF-25** — Cada item exibe há quanto tempo está parado ("hoje", "há 3 dias", "há 2 meses").
- **RF-26** — Itens parados há mais de 30 dias recebem destaque visual distinto (RN-04).
- **RF-27** — Cada item tem uma ação de concluir (`✓`) que o remove da lista em um clique, sem
  diálogo de confirmação.
- **RF-28** — Após concluir ou excluir, um aviso temporário oferece desfazer por 8 segundos; desfazer
  recria o link com o mesmo nome e a mesma lista (RN-05).
- **RF-29** — Abrir um item **não** o remove: a remoção é sempre explícita.

### 5.6 Entre as duas listas

- **RF-30** — O sistema permite mover um link de `Ver depois` para `Favoritos` e vice-versa, em uma
  ação.
- **RF-31** — Um link movido para `Favoritos` entra no fim da grade.

---

## 6. Requisitos não-funcionais

### 6.1 Segurança da busca de título

Este é o único ponto do projeto em que **o servidor abre uma conexão para um endereço escolhido por
quem chama**. A aplicação está exposta na internet, então o requisito abaixo não é opcional.

- **RNF-01 Sem alcance interno** — Antes de conectar, o servidor resolve o nome e **recusa** endereços
  de laço (`127.0.0.0/8`, `::1`), rede privada (`10/8`, `172.16/12`, `192.168/16`, `fc00::/7`),
  link-local (`169.254/16`, incluindo o endereço de metadados de nuvem `169.254.169.254`) e
  qualquer coisa que não seja IP público.
- **RNF-02 Redirecionamento também é conexão** — Cada salto de redirecionamento é validado pela
  mesma regra, no máximo 3 saltos. Redirecionar para `localhost` é recusado como se fosse o destino
  original.
- **RNF-03 Orçamento de tempo** — 2 segundos no total. Estourou, salva com o domínio.
- **RNF-04 Orçamento de tamanho** — Lê no máximo 512 KB do corpo e só de `Content-Type` HTML.
  Um arquivo de 2 GB oferecido como resposta não pode derrubar a API.
- **RNF-05 Falha nunca perde o link** — Nenhum erro da busca de título (DNS, TLS, 404, timeout,
  destino recusado) impede o link de ser salvo.
- **RNF-06 O título é dado de terceiro** — Vai para o banco cortado em 200 caracteres e é
  renderizado como texto, nunca como HTML.

### 6.2 Interação

- **RNF-07 A captura não interrompe** — Arrastar, soltar e voltar ao que estava fazendo não muda de
  tela, não move o foco do editor e não fecha o que estiver aberto.
- **RNF-08 Sem modal bloqueante** — Nenhuma ação da gaveta abre diálogo de confirmação. A rede de
  proteção é o desfazer (RF-28).
- **RNF-09 Foco previsível** — `Esc` na gaveta devolve o foco ao elemento anterior. Remover um item
  move o foco para o seguinte.
- **RNF-10 Cor nunca sozinha** — Idade, destaque de item velho e lista de origem são legíveis sem
  depender de cor.
- **RNF-11 Contraste** — WCAG AA, como no resto: 4,5:1 para texto, 3:1 para interface. Vale também
  para o texto sobre os blocos coloridos gerados por domínio (RN-06).

### 6.3 Desempenho

- **RNF-12** — `GET /links`: p95 ≤ 80 ms. A consulta usa índice por `(user_id, kind)`.
- **RNF-13** — A gaveta carrega de cache e revalida em segundo plano; abrir não espera rede.
- **RNF-14** — O volume esperado é de dezenas de favoritos e até algumas centenas em "ver depois".
  Sem paginação: a lista inteira vem de uma vez. [SUPOSIÇÃO S-04]

### 6.4 Segurança geral

- **RNF-15** — Todo endpoint exige autenticação e filtra por `userId` vindo do token.
- **RNF-16** — Links abrem com `rel="noopener noreferrer"`, para que a página aberta não tenha
  referência à janela do Yu-book.
- **RNF-17** — A URL é validada e normalizada no servidor; o front nunca é a única barreira.

---

## 7. Modelo de dados

Uma tabela nova. Duas listas, **um** `kind` — mover entre elas é um `UPDATE` de uma coluna.

```sql
link      id, user_id, url, title, domain,
          kind ('favorito' | 'depois'),
          position,              -- ordem manual dos favoritos
          created_at, updated_at
```

| Campo | Regra |
|---|---|
| `url` | até 2000 caracteres, normalizada (RN-02), `http`/`https` só |
| `title` | até 200 caracteres; nunca vazio (cai para o domínio) |
| `domain` | derivado da URL, guardado para exibir e para a cor (RN-06) |
| `kind` | enum `LinkKind` no Prisma, como `NoteKind` e `CardPriority` |
| `position` | contígua a partir de 0 **entre os favoritos** (RN-03) |

**Índices:** `UNIQUE (user_id, kind, url)` (RN-02), `(user_id, kind, position)` para a grade de
favoritos e `(user_id, kind, created_at DESC)` para a fila.

**Invariantes:**

- `position` só significa algo para `kind = 'favorito'`. Em "ver depois" a ordem é `created_at`.
- Nenhuma outra tabela referencia `link`; excluir um link não afeta nada (NO6).

---

## 8. Fluxos principais

### Fluxo A — Guardar um vídeo para depois

1. Você está lendo uma nota. Numa outra janela, encontra um vídeo no YouTube.
2. Arrasta o link do vídeo para cima da janela do Yu-book.
3. Duas faixas aparecem sobrepostas: `Favoritos` em cima, `Ver depois` embaixo.
4. Você solta em `Ver depois`. As faixas somem e um item aparece na contagem da navegação.
5. Você continua lendo a nota. O cursor nunca saiu de onde estava.
6. Um segundo depois, o item já tem o nome do vídeo — você nem estava olhando.

### Fluxo B — Limpar a fila

1. `Ctrl+Shift+L` abre a gaveta na aba `Ver depois`, com 7 itens.
2. O terceiro está marcado como parado "há 41 dias", em destaque.
3. Você clica nele: abre em nova aba. A gaveta continua onde estava.
4. Assiste, volta, clica no `✓`. O item some.
5. Um aviso oferece "desfazer" por 8 segundos. Você ignora e ele desaparece.

### Fluxo C — Promover um link que virou rotina

1. Na aba `Ver depois`, você percebe que abre a mesma documentação toda semana.
2. Clica em "mover para favoritos".
3. O link sai da fila e entra no fim da grade de favoritos.

### Fluxo D — Site que não deixa ler o título

1. Você solta um link de um site que exige login.
2. O link é salvo na hora, com o domínio como nome.
3. Você clica no nome e digita "Portal da Cod3rs".

---

## 9. Regras de negócio

- **RN-01 A gaveta é única** — Links não pertencem a workspace. Trocar de `Coders` para `Trabalho`
  não muda o que está na gaveta.
- **RN-02 O mesmo link não entra duas vezes na mesma lista** — A URL é normalizada antes de comparar
  (esquema e domínio em minúsculas, `www.` removido, barra final removida, fragmento `#…` removido).
  Soltar um link repetido não cria um segundo item: o existente é destacado por 2 segundos.
  Parâmetros de consulta **são** preservados — `watch?v=A` e `watch?v=B` são vídeos diferentes.
- **RN-03 Posição contígua** — Depois de qualquer reordenação, os favoritos têm `position` 0, 1, 2…
  sem buraco e sem repetição, renumerados na mesma transação. É a mesma regra do kanban (RN-01 da
  Fase 2), pelo mesmo motivo.
- **RN-04 Nada some sozinho** — "Ver depois" não tem expiração. O tempo é mostrado (RF-25) e o item
  velho é destacado (RF-26), mas quem apaga é você.
- **RN-05 Excluir é imediato e reversível por 8 segundos** — Não há confirmação nem lixeira. O
  desfazer recria o link com o mesmo nome e a mesma lista; a posição na grade não é preservada.
- **RN-06 A cor do bloco é derivada do domínio** — Mesma função, mesmo domínio, mesma cor, sempre. A
  cor é decoração: a inicial e o texto são o que identifica (RNF-10).
- **RN-07 O título vem de fora e não é confiável** — Cortado em 200 caracteres, guardado como texto
  e renderizado como texto.

---

## 10. Critérios de aceitação

**Captura**

- **CA-01** (RF-01, RF-03) — Dado um link arrastado de outra janela para o meio da tela de notas,
  quando solto na faixa "Ver depois", então ele aparece na lista e a nota que eu estava editando
  continua aberta, com o texto intacto.
- **CA-02** (RF-02) — Dado que arrasto um card dentro do board, então as faixas de soltura de link
  **não** aparecem.
- **CA-03** (RF-08) — Dada a API respondendo em 2 s, quando solto um link, então o item aparece na
  lista em menos de 100 ms, com o domínio como nome.
- **CA-04** (RF-09) — Dado o mesmo item, quando a resposta chega, então o nome vira o título da
  página, sem eu recarregar nada.
- **CA-05** (RF-10) — Dada a API fora do ar, quando solto um link, então o item some da lista e um
  erro persistente exibe a URL que eu tentei salvar.
- **CA-06** (RF-07) — Dado que solto `file:///etc/passwd`, então nada é salvo e uma mensagem explica
  que só `http` e `https` valem.
- **CA-07** (RN-02) — Dado `https://www.github.com/` já salvo em Favoritos, quando solto
  `https://github.com` na mesma lista, então nenhum item novo é criado e o existente pisca.
- **CA-08** (RN-02) — Dados dois vídeos do YouTube que só diferem no `?v=`, então os dois são salvos.

**Título**

- **CA-09** (RF-11) — Dado um link de uma página pública com `<title>Documentação do Prisma</title>`,
  quando o salvo, então o nome do link é "Documentação do Prisma".
- **CA-10** (RNF-03, RNF-05) — Dado um servidor que nunca responde, quando salvo o link, então a
  requisição volta em até 2,2 s e o link fica salvo com o domínio como nome.
- **CA-11** (RNF-06) — Dada uma página cujo título é `<img src=x onerror=alert(1)>`, quando o link é
  exibido, então o texto aparece literalmente e nenhum script executa.
- **CA-12** (RF-14) — Dado um link salvo com o domínio como nome, quando peço rebuscar o título,
  então ele é atualizado se a página responder.

**Segurança**

- **CA-13** (RNF-01) — Dado `http://127.0.0.1:3333/health`, quando o salvo, então o link é salvo,
  **nenhuma requisição sai da API para esse endereço** e o nome é o domínio.
- **CA-14** (RNF-01) — Dado `http://169.254.169.254/latest/meta-data/`, então o mesmo: salvo, sem
  conexão, sem título.
- **CA-15** (RNF-02) — Dada uma URL pública que redireciona para `http://localhost`, então a busca
  do título para no redirecionamento e o link fica com o domínio.
- **CA-16** (RNF-04) — Dada uma URL que devolve 100 MB de HTML, então a leitura para em 512 KB e a
  API continua respondendo.
- **CA-17** (RNF-15) — Dado o id de um link de outro usuário, quando faço `PATCH /links/:id`, então
  a resposta é 404.

**Gaveta e listas**

- **CA-18** (RF-15) — Dado `Ctrl+Shift+L` em qualquer tela, então a gaveta abre; `Esc` fecha e o
  foco volta para onde estava.
- **CA-19** (RF-18) — Dada a gaveta aberta, então consigo trocar de aba, navegar, abrir um link e
  remover outro sem tocar no mouse.
- **CA-20** (RF-19) — Dado o texto "git" no filtro, então só links cujo nome ou domínio contêm "git"
  aparecem.
- **CA-21** (RF-22, RN-03) — Dados 5 favoritos, quando arrasto o último para a primeira posição,
  então a ordem persiste após recarregar e as posições são 0,1,2,3,4.
- **CA-22** (RF-25, RF-26) — Dado um item criado há 41 dias, então ele exibe "há 1 mês" e o destaque
  de item velho; um criado hoje exibe "hoje" e não tem destaque.
- **CA-23** (RF-27, RF-28) — Dado um item concluído com `✓`, então ele some na hora, o aviso de
  desfazer aparece, e clicar em desfazer o recria com o mesmo nome na mesma lista.
- **CA-24** (RF-29) — Dado que abro um item de "ver depois", então ele continua na lista.
- **CA-25** (RF-30, RF-31) — Dado um item movido para favoritos, então ele sai da fila e aparece no
  fim da grade.
- **CA-26** (RN-01) — Dado o workspace `Trabalho` ativo, então a gaveta mostra exatamente os mesmos
  links que mostrava em `Coders`.
- **CA-27** (RNF-11) — Dada uma auditoria de contraste nos blocos coloridos gerados por domínio,
  então nenhum par texto/fundo fica abaixo de 4,5:1.

---

## 11. Layout de referência

**Ao arrastar um link para dentro da janela** — sobreposição em cima do que estiver na tela:

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│      ┌────────────────────────────────────────────┐      │
│      │  ★   Favoritos                             │      │
│      │      sites que você abre sempre            │      │
│      ├────────────────────────────────────────────┤      │
│      │  ◷   Ver depois                            │      │
│      │      para consumir e apagar                │      │
│      └────────────────────────────────────────────┘      │
│                                                          │
│              solte para salvar · esc cancela             │
└──────────────────────────────────────────────────────────┘
```

**A gaveta** (`Ctrl+Shift+L`), sobreposta e centralizada, como a paleta de busca:

```
┌─ Links ────────────────────────────────────────────────┐
│  [ Favoritos ]  [ Ver depois · 7 ]        🔍 filtrar…  │
├────────────────────────────────────────────────────────┤
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                   │
│  │ C  │ │ G  │ │ R  │ │ P  │ │ Y  │                   │
│  └────┘ └────┘ └────┘ └────┘ └────┘                   │
│  Cod3rs GitHub Railway Prisma YouTube                  │
├────────────────────────────────────────────────────────┤
│  + cole uma URL aqui              [★ favorito] [◷ depois]│
└────────────────────────────────────────────────────────┘
```

**Aba "Ver depois"** — lista vertical, o mais novo em cima:

```
├────────────────────────────────────────────────────────┤
│  Y  Rick Astley - Never Gonna Give You Up      hoje    │
│     youtube.com                          ✓  ★  ×       │
├────────────────────────────────────────────────────────┤
│  M  Postgres Full Text Search Explained    há 3 dias   │
│     martinheinz.dev                      ✓  ★  ×       │
├────────────────────────────────────────────────────────┤
│ ⚠D  Docs: Prisma raw queries              há 1 mês     │
│     prisma.io                            ✓  ★  ×       │
└────────────────────────────────────────────────────────┘
     ✓ concluir   ★ mover para favoritos   × excluir
```

Regras de layout:

- A gaveta abre sobreposta, sem alterar as colunas atrás — mesmo comportamento da paleta `Ctrl+K`.
- As faixas de soltura cobrem a janela inteira e são o único elemento clicável enquanto o arrasto
  acontece.
- O bloco colorido tem a inicial do domínio; a cor sai de RN-06.

---

## 12. Dependências, restrições e riscos

### Dependências

Nenhuma nova. O arrasto interno reaproveita o `dnd-kit` já instalado na Fase 2; a captura externa
usa a API de arrastar-e-soltar do próprio navegador (`text/uri-list`), que não precisa de
biblioteca. A busca de título usa o `fetch` do Node e uma expressão regular — sem parser de HTML.

### Restrições técnicas

- Stack fixa: Fastify + Prisma + Postgres; React + Vite + Tailwind; Zod compartilhado.
- Sem storage de objetos: nada de favicon salvo (NO3).
- Sem fila e sem trabalho assíncrono: a busca de título acontece **dentro** da requisição, com
  orçamento de 2 s (RNF-03). É o que mantém a resposta previsível e o código sem estado pendente.

### Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| **A API virar um buscador de URL arbitrária** (SSRF) | alto — é o único ponto do app que conecta onde mandam | RNF-01 e RNF-02 com validação de IP resolvido a cada salto; CA-13 a CA-15 cobrem os três casos clássicos |
| **Espera de 2 s ao soltar** | médio; atrapalharia a captura | RF-08: o item aparece otimista em 100 ms. A espera acontece atrás da cortina |
| **Sites que bloqueiam robô** (Cloudflare, login) | baixo | O domínio vira o nome e você renomeia (RF-13). Não é erro, é o caminho previsto |
| **"Ver depois" virar depósito** | médio; a funcionalidade existiria sem servir | RF-25 e RF-26 tornam a idade visível; M5 e M6 medem se está funcionando. Se em um mês a fila só crescer, o problema é de escopo, não de código |
| **Arrasto externo capturar em excesso** — arrastar texto de uma nota abrir as faixas | baixo; irritante | RF-02: só quando o tipo arrastado é URL |

---

## 13. Entregas

Duas ondas. A primeira já é utilizável sozinha.

| Onda | Escopo | Corte se atrasar |
|---|---|---|
| **3a — Gaveta e captura** | RF-01 a RF-21, RF-23 a RF-31 | não corta: é a funcionalidade |
| **3b — Ordenação manual** | RF-22 (arrastar favoritos) | corta; a ordem fica sendo a de criação |

---

## 14. Questões em aberto

- **Q-01** — `Ctrl+Shift+L` conflita com algum atalho seu de navegador ou sistema? O `Ctrl+L` puro
  seria mais natural, mas é o foco da barra de endereço em todos os navegadores. **Impacto:** baixo,
  muda uma constante.
- **Q-02** — Uma URL solta duas vezes em listas **diferentes** (favorito e ver depois) deve virar
  dois registros ou mover o existente? O PRD assume dois registros, porque a chave única é
  `(user_id, kind, url)`. **Impacto:** baixo.
- **Q-03** — Vale um `GET /links/:id/abrir` que registre o último acesso, para no futuro ordenar
  favoritos por uso? Hoje é NO8, e a coluna não existe. **Impacto:** baixo agora, mas adicionar
  depois exige migration.

---

## 15. Suposições assumidas

- **S-01** — **A gaveta é uma sobreposição por atalho**, não uma tela. Confirmado por você.
  Justificativa: guardar e pegar link é interrupção de outra tarefa; trocar de tela para isso é o
  atrito que faz a funcionalidade não ser usada.
- **S-02** — **O servidor busca o título da página.** Confirmado por você. Consequência aceita: a
  API passa a fazer requisição de saída, e por isso a seção 6.1 existe.
- **S-03** — **Links não têm workspace** (RN-01). Confirmado por você.
- **S-04** — **Volume pequeno** (RNF-14): dezenas de favoritos, centenas em "ver depois". É o que
  torna paginação, busca no servidor e índice extra desnecessários.
- **S-05** — **Sem expiração automática** (RN-04). Confirmado por você. Se M6 mostrar a fila
  envelhecendo sem parar, a resposta é revisar o hábito, não deixar o app apagar o que você guardou.
- **S-06** — **Desfazer por recriação** (RN-05): o desfazer chama `POST /links` de novo, em vez de
  existir uma lixeira. Justificativa: o dado é uma URL e um nome; recriar é exato e não custa
  coluna nem estado.

---

## 16. Definição de pronto

A Fase 3 está concluída quando:

1. Os 27 critérios de aceitação passam.
2. `pnpm typecheck`, `pnpm build` e `pnpm --filter @yu-book/api test` passam limpos.
3. Os testes de integração cobrem, no mínimo: a recusa de endereço interno (CA-13, CA-14), o
   redirecionamento para endereço interno (CA-15), o limite de tamanho (CA-16), a normalização de
   URL duplicada (CA-07, CA-08) e a posse (CA-17).
4. Os fluxos A, B, C e D foram executados em navegador real, arrastando de uma janela para outra.
5. A migration da tabela `link` foi aplicada em produção.
6. Você guardou **um link de verdade** arrastando, e o consumiu e removeu depois — o ciclo inteiro,
   em produção.

O item 6 é o único que não dá para simular.
