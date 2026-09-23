# Histórico de contexto

Registro narrativo, uma entrada por sessão de trabalho, mais recente no topo. Aqui ficam as
**decisões** e os porquês; o que mudou fica em [`../CHANGELOG.md`](../CHANGELOG.md).

O que entra: decisão tomada e alternativa descartada, com o motivo; problema encontrado e como foi
resolvido; dívida assumida conscientemente; pendência que sobrou. O que não entra: relato de "o que
eu fiz hoje" sem decisão dentro.

---

## 2026-09-23 — A política de dados era nossa e estava fixa no código; e a migration que teria derrubado o boot

Segunda sessão do dia. A de manhã tirou do catálogo os modelos que a chamada recusa; esta descobriu
que **um dos motivos de recusa era nosso**.

**O sintoma parecia ser mais um modelo quebrado.** O operador favoritou gratuitos (NVIDIA, Google) e
eles falharam. Medi com a chave dele, no mesmo modelo, variando **uma** coisa: com
`provider: { data_collection: "deny" }` vem **404**, "No endpoints found matching your data policy
(Free model training)"; sem o bloco, **200** e custo zero. A conta dele já permitia endpoints que
treinam — está ligado no painel do provedor. A trava era o nosso pedido: endpoints gratuitos treinam
com os dados, então exigir que não treinem é **exigir um endpoint que não existe**. Vale anotar o
formato do engano, porque ele se repete: pela segunda vez em dois dias o 404 veio do que **nós**
mandamos, não de o provedor estar fora do ar.

**A decisão é que a política é escolha do usuário, não propriedade do produto.** Ela estava fixa numa
linha de `formatar.service.ts`, e a tela de ajustes a anunciava — "o servidor pede ao provedor que
não guarde o texto para treino" — como se fosse garantia oferecida. Era escolha nossa, escondida, e
contrária ao que o operador disse no começo desta frente: que não se importa que o conteúdo dele seja
usado para treino. O que se oferecia como cuidado estava, na prática, tirando dele metade do catálogo
sem avisar.

**Descartei simplesmente remover o `deny`**, que seria a leitura literal do que ele pediu e o diff
menor. Recusada porque apaga uma proteção real para quem não pediu nada: o padrão passaria a ser
"treina" por omissão, e a tela ficaria sem verdade nenhuma a dizer. O interruptor nasce **desligado**,
e o custo disso está escrito na tela: quem deixar como está não alcança os gratuitos. **A consequência
aparece nos dois estados de propósito** — dizer só "protegemos você" foi exatamente o defeito.

**Com o treino permitido não mandamos bloco nenhum**, em vez de mandar um valor permissivo explícito.
Foi o que a medição cobriu: o 200 veio da **ausência** do bloco. Mandar `data_collection: "allow"`
seria afirmar um comportamento do roteamento que eu não medi, e o bloco `provider` é justamente o que
restringe o roteamento — deixá-lo fora é o que abre os gratuitos.

**O Gemma é outro caso e fica em aberto.** Ele devolve **429 com e sem** a política: é saturação do
endpoint gratuito, não recusa por dados. Nada nesta entrega o alcança, e vai continuar falhando para
quem tentar.

**A migration teria derrubado o boot em produção, e só não derrubou o local por acaso.** A coluna é
obrigatória e **sem `@default`** — o padrão mora em `packages/shared`, e duas fontes para o mesmo
padrão divergem em silêncio. O Prisma gerou `ADD COLUMN … NOT NULL` sem default e avisou no próprio
arquivo: *"This is not possible if the table is not empty"*. Aqui passou porque a minha `ai_preference`
está vazia; **em produção não havia como saber**, e `prisma migrate deploy` roda no **boot** — a
falha não apareceria em pipeline nenhum, apareceria como serviço que não sobe, depois do push.

Refiz em dois passos — `ADD COLUMN … NOT NULL DEFAULT false` e `ALTER COLUMN … DROP DEFAULT` — e
**provei em vez de presumir**: criei uma linha, derrubei a coluna, rodei o SQL da migration com a
tabela cheia, e a linha existente ficou com `false`. O estado final do banco continua igual ao
`schema.prisma`. O motivo está em comentário **dentro do SQL**, que é onde a próxima pessoa vai olhar
quando quiser "simplificar" isto para um comando só.

**O dublê de provedor só sabia dizer que uma chamada saiu, não o que ela pediu**, e é por isso que
a política fixa atravessou a Etapa A inteira sem um teste que
pudesse contradizê-la. Ele passou a guardar os
corpos recebidos, e o teste que vale é o de **ausência**: com o treino permitido, o pedido não tem
bloco `provider`. Conferi que ele morde — refixar `deny` derruba esse teste e só ele.

**Continua valendo o que se repete há seis entregas:** a interface não foi verificada à mão. O
interruptor, os dois textos de consequência e o novo parágrafo do topo de `/ajustes` estão
implementados e **não verificados** — `apps/web` não tem runner de teste. A sexta seguida é a
informação; o caso isolado já não é.

---

## 2026-09-23 — O catálogo oferecia modelos que a chamada não aceita, e a mensagem de erro não deixava descobrir isso

A Etapa A subiu ontem e **quebrou na primeira tentativa de uso**: o operador favoritou uma variante
`:batch`, clicou em formatar e recebeu 404. Vale registrar o caminho até o diagnóstico, porque ele é
o argumento de metade do que mudou hoje.

**Eliminei por medição antes de achar a causa.** A mesma chave, o mesmo modelo e a mesma política
`data_collection: "deny"` respondem 200 numa chamada à mão; `origin/master` estava no lugar certo;
as rotas `/ai` existiam em produção — respondiam 401 sem token, não 404; o banco estava de pé. Só
então reproduzi contra o provedor com a variante de lote e li
`"openai/gpt-6-luna-pro:batch cannot be used with the chat/completions endpoint (adapter
OpenAIBatchAdapter)"`. **O 404 vinha do nosso pedido, não da nossa infraestrutura.**

**A primeira decisão é que isso é defeito do catálogo, não da chamada.** A alternativa era tratar o
404 na formatação — detectar o caso e explicar. Foi descartada: a variante de lote não serve para
**nenhuma** chamada que fazemos, então oferecê-la é errado em todo lugar onde ela apareça, e
consertar no ponto de uso deixaria a armadilha montada para o próximo ponto de uso. O filtro é na
origem, e a regra de reconhecer uma variante de lote vive em **um lugar só**,
`modelos.service.ts`, exportada para quem precise — hoje a escolha de modelo por tarefa.

**O provedor não expõe campo que identifique a variante, e isso é o fato desconfortável da entrada.**
Comparei a entrada normal com a `:batch` no `/models`: só `id`, `name` e `pricing` diferem. O único
discriminador disponível é o sufixo do `id`. Casar string com o formato de um terceiro é frágil e
não há alternativa — se o provedor mudar a convenção, o filtro para de filtrar em silêncio. O que
segura é a segunda camada: mesmo passando pelo catálogo, o favorito de lote é recusado na escolha do
modelo com 422 e uma frase acionável. Uma camada sozinha não bastaria de qualquer jeito: **filtrar o
catálogo não desfaz a linha que já está gravada no banco de produção**, e era exatamente essa linha
que o operador tinha.

**A mensagem de erro do provedor era inútil, e isso custou tempo real.** "O provedor de IA respondeu
404" não diz a ninguém o que fazer — foi preciso reproduzir a chamada à mão para saber o que
perguntar ao operador. Agora ela carrega o caminho e a mensagem do corpo. Os limites foram
escolhidos: **200 caracteres** e **só quando o corpo é o JSON esperado**, porque é texto de terceiro
indo para a tela e uma página de erro em HTML despejada na interface é outro tipo de defeito. O
caminho é literal e não carrega chave nem dado do usuário. Há um ganho lateral que vale anotar: o
404 mais provável neste código nem vem do provedor recusar — vem de `OPENROUTER_BASE_URL` apontar
para um caminho que não existe, e agora a mensagem mostra qual.

**A exclusão dos apelidos `…-latest` é a mesma decisão do lote por outro caminho, e ela é mais
difícil de defender.** Os 18 apelidos **funcionam**: chamá-los responde 200. O problema é o nosso
desenho, não o deles — o favorito guarda uma **cópia** de preço e de contexto, tirada no dia em que
se favorita, porque a estimativa de custo não pode buscar o catálogo inteiro dentro da requisição e
a lista precisa abrir com o provedor fora do ar. Sob um apelido, essa cópia fica errada **em
silêncio** no dia em que o alvo muda, e a estimativa passa a orçar outro modelo. A alternativa era
mantê-los e não copiar preço para eles, o que exigiria um segundo caminho de estimativa só para um
punhado de modelos. Preferi tirá-los, e a decisão é **reversível**: voltando, eles precisam de
etiqueta própria na tela dizendo que o preço mostrado é o de hoje. Os 15 de saída não-textual saem
sem controvérsia: a tarefa é texto entra, texto sai.

**Os índices de qualidade ordenam e não filtram, e essa assimetria é deliberada.** Descobri no
caminho que o provedor **não expõe** o campo `categories` que a tela dele mostra — as
"especialidades" não vêm pela API, e não dá para reproduzi-las. O que vem são três índices de
terceiro (inteligência, código, agêntico), presentes em **142 dos 348** modelos. Filtrar por eles
esconderia dois terços do catálogo por falta de medição de um terceiro, que é uma afirmação que
ninguém fez. Pela mesma razão, **quem não tem medição não ganha etiqueta** — desenhar um zero ali
seria inventar uma nota ruim para quem ninguém mediu — e, na ordenação, o não medido vai para o
**fim**, nunca para o meio: tratar ausência como zero enfileiraria um modelo não medido atrás dos
piores medidos.

**As faixas de preço saem da distribuição, não do olho.** Medi antes de escolher: mediana em
US$ 0,325 por milhão de tokens de entrada. Daí saem grátis, até US$ 0,50, até US$ 2 e qualquer. O
teto é pelo preço de **entrada** porque é ele que domina a conta ao formatar uma nota — o corpo
inteiro entra e só a formatação sai. Detalhe que vai morder quem mexer: `0` é o filtro de gratuitos,
então a comparação não pode ser `maxPrice &&` em lugar nenhum, nem no servidor nem no front.

**Voltei atrás numa promessa do plano, e o motivo é o mesmo da cópia.** Eu havia prometido que a
lista "Seus modelos" ganharia as etiquetas novas. Ao implementar, `AiFavorite` deixou de estender
`AiModel` e passou a declarar campo a campo o que o banco guarda — o que impede justamente isso.
Índice é medição volátil; congelá-lo dentro de um favorito seria desinformar com cara de dado. Os
índices existem para **escolher** um modelo no catálogo, não para descrever o já escolhido. O tipo
não muda de forma nesta versão: o que ele passa a fazer é **não herdar** os campos novos, e essa é
a única razão de a herança ter saído.

**`apps/mcp` bumpa sem ter sido tocado, e a regra é essa mesmo.** Ele não importa nada de
`packages/shared/src/ia.ts` e nenhuma tool, resource ou prompt mudou. Mas o contrato que ele declara
como dependência mudou, e ele é deployado hoje construído contra o `0.5.0`. A versão de um pacote
diz contra qual contrato ele foi construído; abrir exceção aqui faria `0.7.0` significar dois
contratos diferentes, e a correspondência não se recupera depois. Mesma decisão e mesma razão da
entrada de 2026-09-22.

Ficou pendente: **o teto de gasto continua não exercitável na prática.** A conta do operador é free
tier com crédito, e modelo gratuito custa zero — o teto corretamente não barra e o gasto do dia não
sobe. Continuam de pé a corrida declarada no teto e o defeito do `diaDoPrazo` no MCP
hospedado, que nada aqui toca.

E fica registrado o que já é padrão e não deveria ser: **esta é a quinta entrega seguida que toca
`apps/web` e fecha sem conferência à mão** — Etapas A, B e C da Fase 5, a Etapa A da frente de IA e
esta. Da vez passada a dívida foi escrita como exceção de uma entrega; cinco vezes seguidas ela não
é exceção, é o modo de operação do projeto. Os portões cobrem o servidor e os tipos; a tela vai ao
ar por inspeção do código. Hoje o que ninguém executou são os chips de preço, o seletor de
ordenação, a etiqueta de raciocínio e os índices na lista.

---

## 2026-09-22 — IA aplicada, Etapa A: o Yu-book vira cliente de um modelo, e o Ollama não sobrevive à Railway

Primeira etapa da **Fase 5 do roteiro de IA aplicada** (`applied-ai-read-trip.md`, PRD em
`prd-ia-no-yu-book.md`). O servidor MCP fez o Yu-book ser **servidor**: ele se expõe para que uma
inteligência de fora o use. Aqui ele vai na direção oposta e passa a ser **cliente** — quem está com
o navegador aberto não tem um cliente MCP por perto. Não é fase de produto e não é etapa do MCP.

**O Ollama saiu do escopo, e a decisão derruba dois requisitos do PRD.** O PRD foi escrito supondo
dois provedores, com o local sendo o padrão para tudo que carrega o corpo de uma nota: é a RN-01, é
o RNF-01, é o O2 e é metade da justificativa da RF-02. A API roda na Railway, **sem GPU**. Um
recurso apoiado em modelo local rodaria na máquina do operador e **não existiria em produção**, que
é onde o app é usado — e a alternativa seria hospedar inferência, que é o NO4 do próprio PRD. Entre
manter a promessa de privacidade e ter a função, escolhemos a função e escrevemos a perda. A
consequência é literal e não tem atenuante: **o corpo da nota sai da máquina em toda tarefa de IA,
sempre**. A mitigação é dupla e nenhuma das duas é técnica o bastante para substituir a promessa
perdida — dizer isso **na tela de ajustes**, em vez de só no PRD, e mandar
`provider: { data_collection: "deny" }` na requisição (conferido contra o provedor: não exclui
modelo gratuito do roteamento). O aviso na tela é a parte que importa: a decisão é do usuário e ele
só decide o que sabe. Isso também é o motivo de `MAX_CONTEUDO_IA` existir separado do `MAX_CONTEUDO`
de 1 MB da nota — o que sai da máquina tem que ter tamanho conhecido.

**Sem dois provedores, a interface de provedor da RF-02 não foi escrita.** A RF-02 pedia uma
interface com duas implementações **porque havia duas**; com uma, ela é cerimônia que ninguém
exercita, e abstração sem segundo caso é abstração desenhada para o caso errado. O que ficou no
lugar é o que realmente dá flexibilidade: a injeção de transporte da RF-09 e `OPENROUTER_BASE_URL`.
Quando houver o segundo provedor, a interface nasce medindo as duas implementações de verdade.

**O NO5 cai por pedido do operador, e a razão dele é melhor que a do PRD.** O PRD dizia "não
implementar teto, alerta de cota nem painel de gastos; fica registrado o custo por chamada, teto
entra se doer". Com provedor local no desenho, custo era hipótese; sem ele, toda formatação de nota
é dinheiro. Teto diário e gasto visível entram agora, antes de doer.

**O NO2 foi revisto, e ele não é código nesta etapa.** Nota gerada por IA passa a ser permitida,
desde que **marcada no dado** — o motivo original do NO2 (texto sintético indistinguível no acervo
destrói a confiança na busca e no grafo de backlinks) é atendido pela marca, não pela proibição. A
marca é da etapa C. Fica registrado aqui para que a etapa C não precise reabrir a discussão, e para
que ninguém gere nota antes de a marca existir.

**Rotas em inglês com prefixo `/ai`, contrariando o exemplo do próprio PRD.** O RF-08 escreve
`GET /assistente/saude` literal. O RNF-08 do mesmo documento repete a regra da casa — domínio em
português, fronteira da API em inglês — e os nove grupos de rota que já existem são todos em inglês.
É lapso de rascunho, e **regra vence exemplo**. O diretório, os arquivos e as funções seguem em
português; só o caminho é inglês. O prefixo `/ai` e não `/assistant` pela mesma razão que o resto é
curto.

**A fronteira do dia é do usuário, e é gravada em vez de calculada.** `ai_usage.local_day` guarda o
dia `AAAA-MM-DD` que valia para a pessoa no momento da chamada, e o fuso mora em `ai_preference`. A
API roda em UTC na Railway e o operador vive em UTC−3: sem isso o teto zeraria às 21h, três horas
cedo, **todo dia e calado** — o pior tipo de defeito de teto, porque ele libera gasto em vez de
barrar. Gravar em vez de calcular na consulta é o que garante que a janela do teto seja a mesma que
a tela mostra, mesmo que a pessoa mude de fuso depois. A primitiva é `diaLocal` em `packages/shared`,
e ela é chamada **só pelo servidor** de propósito: o servidor devolve o dia pronto e o front nunca
recalcula, então não há segunda implementação para divergir — o catálogo de espelhamentos frágeis já
tem entradas demais.

**Custo em µUSD inteiro, em todo lugar.** Não há `Decimal` no schema e `JSON.stringify` lança em
`bigint`; ponto flutuante para dinheiro somado ao longo de um dia é erro acumulado. Milionésimo de
dólar em `Int` resolve os três. O preço de catálogo é guardado **por milhão de tokens** pelo mesmo
motivo: o provedor entrega USD por token como string decimal, e por milhão tudo continua inteiro. A
conversão para dólar existe num lugar só, em `packages/shared` — escrita duas vezes, ela vira um
teto de US$ 0,20 que o servidor lê como US$ 200.000.

**A preferência não é criada na leitura.** `GET /ai/settings` devolve os padrões do `packages/shared`
sem gravar linha nenhuma; quem cria é o `PATCH`. A alternativa — criar no primeiro `GET` — era mais
simples de escrever e foi descartada porque um `GET` que escreve surpreende quem depura, e porque o
padrão passaria a viver em dois lugares. É também a razão de `AiPreference` não ter `@default` no
Prisma: o padrão já existe em `TETO_DIARIO_PADRAO_MICROS` e `FUSO_PADRAO`, e um segundo divergiria
sem nada reclamar. De um jeito ou de outro, a rota nunca devolve 404 por falta de configuração.

**A cascata de custo tem três degraus, e o degrau fica gravado.** `provedor` quando ele informa,
`estimado` quando dá para calcular pelo preço do catálogo, `desconhecido` quando não veio nem custo
nem token. O terceiro é o perigoso: grava zero, e **zero não move o teto**. Um provedor que parasse
de informar custo tornaria o teto decorativo em silêncio — quem olhasse a tela veria gasto zero e
concluiria que não gastou. Por isso as chamadas sem custo informado do dia são contadas e
**mostradas na tela**. Teto que mente é pior que teto nenhum, e a única defesa contra um teto que
mente é ele admitir que não sabe.

**A guarda de wikilink é código, não prompt, e foi corrigida na revisão.** A RN-06 diz que nenhum
prompt que edite conteúdo pode alterar `[[…]]`, porque `note_link` é tabela derivada e reescrever o
texto quebraria o grafo. Pedir isso ao modelo é pedir, não garantir: a resposta é conferida antes de
ser aplicada. A correção da revisão foi o que a conferência compara — era lista ordenada de alvos,
passou a ser **conjunto de alvos normalizados**. `note_link` é um conjunto; comparar por índice
recusaria uma formatação legítima só por ela ter reordenado itens de uma lista, **depois de a
chamada já ter sido paga**. Recusa cara e errada é o pior dos dois mundos.

**Uma violação da INV-04 e um vazamento, os dois encontrados antes do fim.** `desfavoritar` era
checar-depois-agir; a posse passou para a mesma operação que apaga. O vazamento foi mais
interessante: `GET /ai/health` devolvia o rótulo do provedor, que **por padrão é o prefixo da
própria chave**. A primeira correção foi esconder o campo no JSX, e ela não bastava — o corpo da
resposta chega ao navegador, à aba de rede e a qualquer cache no caminho. Esconder no cliente nunca
é redação; a redação pertence ao service.

**O alçapão do valor padrão mordeu duas vezes na mesma sessão.** `function f(x = env.ALGO)` chamada
com `undefined` explícito **reassume o ambiente** — em JavaScript o padrão se aplica ao argumento
ausente e ao `undefined` passado de propósito, e os dois casos são indistinguíveis de dentro. O
efeito prático: o teste de "sem chave configurada" passou a testar outra coisa no dia em que a suíte
ganhou uma chave de mentira, e continuou verde. `saude` passou a receber um objeto e a usar
`"chave" in opcoes`, que distingue "não informei" de "informei que não há". Vale para qualquer
função do projeto que tenha `env` como valor padrão de parâmetro.

**Propagação ao MCP: conferida e nula.** As nove tools, os quatro resources diretos, os dois
templates e os dois prompts foram percorridos — nenhum muda, porque nota, card, board, coluna, link,
tag e workspace **não ganharam campo**. Os seis códigos de erro novos são inalcançáveis pelo MCP: só
saem de `/ai/*`. `tools/list` medido em 3480 bytes com cinco tools e 8551 com nove, inalterado.
`POST /ai/notes/:id/format` **não vira tool**, e o motivo não é o NO3: seria inferência dobrada —
um modelo chamando outro —, cobrada do teto diário do operador, para entregar ao primeiro um texto
que ele não tem onde gravar. `apps/mcp` bumpa mesmo sem mudar comportamento, porque `ERROR_CODES`
mudou e `cliente.ts` consome `ApiErrorBody`: a versão de um pacote diz contra qual contrato ele foi
construído.

**Defeito pré-existente iluminado, e deliberadamente não consertado aqui.** `diaDoPrazo` em
`apps/mcp/src/formato.ts:56` usa `getMonth()`/`getDate()`, que são o fuso **do processo**. O MCP
hospedado roda em UTC: ele relata **todo prazo um dia à frente**, e `diaParaPrazo` grava o prazo
três horas cedo. Medido nesta sessão, fora do escopo desta entrega. O que esta entrega trouxe é a
primitiva do conserto — `diaLocal` em `packages/shared` e o fuso do usuário no domínio, que antes
não existia em lugar nenhum. É a última linha do catálogo de espelhamentos frágeis que ainda não
passa por `shared`, e agora dá para fechá-la.

**Dívida de conferência, na mesma forma da Fase 5 e pelo mesmo motivo: `apps/web` não tem runner de
teste.** Foram conferidos à mão: provedor conectado, catálogo buscável, nota formatada com três
`[[wikilinks]]` intactos e o gasto do dia subindo. **Não** foram: o desfazer em 8 s (CA-05), a
recusa ao editar durante a formatação (RF-15), a ausência de colateral em título, tags e workspace
(RF-13) e a recusa por teto atingido. As duas últimas dependem de gastar dinheiro de verdade — com
modelo gratuito o custo é zero, o teto corretamente nunca barra e o gasto do dia não sobe, então os
dois caminhos não são exercitáveis à mão numa conta sem crédito.

**Corrida no teto, declarada e aceita.** O limite de 10/min da rota, com orçamento de 60 s por
chamada, deixa até dez pedidos passarem pela leitura do gasto antes de a primeira linha de uso
existir. O conserto seria transação com `SELECT ... FOR UPDATE` ou uma coluna de reserva; foi
descartado por ora porque o sistema tem **um usuário e uma tela**, e o estouro máximo é dez chamadas
de uma tarefa só. Fica escrito porque a segunda tarefa (chat, com streaming) muda essa conta.

---

## 2026-09-04 — MCP: a segunda camada da trava de escrita, e o pacote sai da máquina do operador

Fecha as duas limitações da entrega anterior que ainda eram código. Continua sendo a **Etapa 4 das
cinco da proposta de MCP** e a **Fase 3 do roteiro de IA aplicada** — a Etapa 5 não começou. O que
mudou de categoria foi outra coisa: `apps/mcp` deixou de ser um pacote que só roda na máquina do
operador.

**Defesa única falha calada, e esta fase já provou isso três vezes.** O envelope sem rótulo de tipo
e o `client_id` vazio passaram por revisão e por 32 testes. A trava de escrita era a terceira
candidata: existia só no registro, em `criarServidor({ escrita })`, e o registro decide uma vez por
sessão. Duas falhas concretas passavam por ele. A primeira é a tool nova no módulo errado — uma
quinta tool de escrita registrada dentro de `registrarToolsDeNotas` em vez de
`registrarEscritaDeNotas` fica registrada **sempre**, e nada reclama: nem o compilador, nem os
testes, nem a execução. A segunda é o escopo que encolhe com a sessão viva, abaixo. A alternativa
era confiar no registro e escrever isso como convenção no README; foi descartada porque convenção
não derruba build, e o custo da checagem no ponto da chamada é uma palavra por handler.

**O guarda é total nos dois transportes, e no stdio ele não é `return true`.** Foi a decisão menos
óbvia da sessão. A leitura fácil é que a segunda camada existe por causa do HTTP — é lá que há token
e escopo — e que no stdio não há nada a conferir. Errado: no stdio há a pergunta que importa ali,
que é *estou escrevendo onde eu acho que estou*. Uma tool de escrita registrada sem condição, contra
uma API remota, é exatamente o desastre que `YUBOOK_ESCRITA_REMOTA` existe para evitar, e é a falha
1 acontecendo em produção. Por isso `podeEscrever` ramifica por transporte em vez de sair cedo.

**A ordem dentro de `comErroDeEscrita`: o guarda antes de `relatar(...)`.** Não é detalhe de estilo.
O log das tools de escrita é a única trilha de auditoria que chega ao usuário, e um registro de
escrita que não aconteceu é pior que nenhum registro. A recusa também precisa dizer ao modelo que
**nada foi alterado** e que repetir não resolve — sem isso ele tenta de novo, e uma escrita que
"falhou" duas vezes pode ter acontecido duas vezes.

**O furo do rebaixamento de escopo era real, e o achado veio de olhar o provedor com a sessão em
mente.** `exchangeRefreshToken` aceita `scope` no pedido e filtra o concedido — comportamento
correto de OAuth. Mas os escopos congelam na criação da sessão MCP, e o `mcp-session-id` sobrevive à
renovação: um cliente podia renovar pedindo só leitura e seguir usando a mesma sessão com as nove
tools registradas. A correção é encerrar a sessão quando a superfície e o token divergem, e ela é
**simétrica de propósito** — perder ou ganhar `yubook:write` encerra igual. Manter viva a sessão que
ganhou escopo pareceria generosidade, mas produziria um `tools/list` que esconde uma tool já
autorizada, e o catálogo que mente é o problema nos dois sentidos. O 404 é honesto porque a sessão
acabou de verdade: quem responde "desconhecida" acabou de torná-la desconhecida.

**O arnês de teste em memória, e por que ele não usa o `Client` do SDK.** Os testes anteriores
construíam os objetos que a integração deveria fornecer — provavam as peças, não a superfície —, e é
por isso que os dois últimos defeitos da entrega anterior apareceram à mão. O arnês fala JSON-RPC de
verdade contra o servidor por `InMemoryTransport`. O `Client` do SDK foi descartado por um motivo
específico: ele não envia `authInfo` por mensagem, e é exatamente isso que precisa ser controlado
para chamar uma tool de escrita com um token de leitura. `InMemoryTransport.send(msg, { authInfo })`
envia, e o próprio SDK documenta o parâmetro como para cenários de autenticação. O preço foi
escrever a correspondência de resposta por `id` num mapa — o mínimo que um cliente JSON-RPC precisa
ter.

**A lista de tools de escrita é derivada, não escrita à mão.** Sobe o servidor com e sem escrita e
subtrai os dois `tools/list`; os argumentos mínimos saem do `inputSchema`, porque o SDK valida antes
de chamar o handler. A alternativa — um array com os quatro nomes — teria o defeito de esquecer a
quinta tool, que é a falha 1 de novo, agora no teste. O teste que garante isso é o "o conjunto
derivado não é vazio": sem ele, uma derivação quebrada passaria como suíte verde de zero casos.

**`trust proxy` é `1`, e não `true`.** `true` confia na cadeia inteira de `X-Forwarded-For`, e o
cliente escreve esse header: trocaria de balde a cada tentativa, que é o que o limite de 20 logins
por 5 minutos existe para impedir. `1` confia num salto, que é o que a Railway põe na frente. Se
outro proxy entrar no caminho, o número muda junto — o valor é a topologia, não uma configuração
genérica.

**Ficou como dívida:** a `apps/api` usa `trustProxy: true` do Fastify, com o defeito que o `1` acaba
de corrigir no MCP. Foi deixada de fora deliberadamente, para não misturar mudança de
comportamento em produção da API com o primeiro deploy do MCP — este push já muda o que roda em
produção o suficiente.

**`NODE_ENV` e `MCP_TRANSPORTE` no `startCommand`, não como variáveis de serviço.** O primeiro
porque `NODE_ENV=production` de serviço some com as devDeps e quebra o build (`tsc: not found`) —
lição que a API já tinha pago. O segundo é decisão nova: `MCP_TRANSPORTE` como variável de painel é
esquecível, e esquecê-la sobe o processo em `stdio`, onde ele fica mudo, sem porta, sem erro, e o
healthcheck falha sem dizer por quê. No comando é impossível esquecer.

**O primeiro deploy sobe com `MCP_ESCRITA_HABILITADA=0`** — decisão do operador. Hospedado, a trava
por host local não protege mais nada: o alvo é a API de produção, e um pedido mal interpretado pelo
modelo cria dado de verdade no segundo cérebro. Primeiro voo só de leitura; ligar depois é uma
variável no painel, sem deploy de código, e é para isso que o desligamento global existe.

**Pendência:** o aperto de mão OAuth completo com navegador continua sem teste automatizado. O arnês
novo cobre a superfície JSON-RPC e não chega ao fluxo de autorização — que é onde nasceram os dois
defeitos de autenticação desta fase.

---

## 2026-09-01 — Servidor MCP, Etapa 4: o transporte que cria o problema de identidade

Esta é a **Etapa 4 das cinco da proposta de MCP** (`old/proposta-mcp-inicial.md`) e a **Fase 3 do
roteiro de IA aplicada** (`applied-ai-read-trip.md`). Não é fase de produto. As três numerações
continuam sem se converter uma na outra — a entrada de 2026-08-26 explica de onde vem cada uma.

**A lição da etapa é que transporte e autenticação são a mesma coisa.** Em `stdio` a credencial no
`.env` **está certa**: um processo por pessoa, iniciado por ela, e o processo é dela. Sobre HTTP o
mesmo arquivo vira uma identidade só para todo mundo. Não foi a autenticação que ficou fraca; foi o
transporte que retirou a premissa que a sustentava. Por isso o `env.ts` **recusa o boot** em `http`
com `YUBOOK_EMAIL` definida: subir errado aqui é pior que não subir.

**Emitir token próprio, e não repassar o de um terceiro.** A alternativa era delegar a um provedor
externo e aceitar o token dele. Foi descartada porque o Yu-book já tem contas, já tem `POST
/auth/login` e já tem toda a autorização por usuário na API — o servidor MCP é cliente da API, não
do banco, e essa decisão é de duas etapas atrás. Introduzir um segundo emissor de identidade criaria
uma conta que o Yu-book não conhece e a obrigação de mapear uma na outra. O preço aceito: um
servidor de autorização OAuth 2.1 escrito à mão, com registro dinâmico, PKCE e página de
consentimento — a superfície de ataque mais delicada do repositório, e a razão de os testes novos
terem nascido aqui e não nas tools.

**Nenhum estado durável no emissor, por escolha.** Cliente registrado, código de autorização e
refresh token viajam cifrados dentro do próprio identificador (AES-256-GCM mais HS256, tudo em
`node:crypto`). A alternativa era uma tabela no Postgres da API. Foi descartada porque obrigaria o
servidor MCP a falar com o banco, quebrando a decisão de ele ser cliente da API; e porque um mapa em
memória — que foi o que existiu durante metade da sessão — tem o defeito pior de todos: **reiniciar
o processo derrubava todos os tokens vivos**, e um deploy silenciosamente deslogava todo mundo. O
que se paga em troca está declarado abaixo, no teto de 120 s.

**O rótulo de tipo no envelope, e o desvio que ele fechou.** O envelope do código de autorização era
**superconjunto estrutural** do envelope de refresh token: os campos que o refresh exigia estavam
todos lá. Um código apresentado em `grant_type=refresh_token` abria como refresh, e devolvia token
com escopo de escrita — contornando de uma vez o uso único, o `exp` de 60 s e o PKCE. Isso é um
desvio de autenticação real, escrito por nós, encontrado por revisão. A correção não foi conferir
campo a campo, que a próxima estrutura parecida furaria de novo: foi carimbar o **tipo** dentro do
conteúdo cifrado e devolver `null` para qualquer envelope de outro tipo. Vale a lição: em envelope
opaco, compatibilidade estrutural é uma porta, não uma coincidência.

**A janela de graça de 30 s no `refresh` da API, e o que ela custa.** A rotação de refresh token é
atômica e o token novo só existe na resposta. Se a resposta se perde, ou o processo reinicia entre o
commit e a entrega, o cliente reapresenta o anterior de boa-fé — e a regra antiga concluía vazamento
e revogava **todas** as sessões do usuário, inclusive a do navegador, que não fez nada. A janela
cega exatamente a corrida que a rotação existe para pegar: se alguém roubar um refresh e usá-lo
primeiro, a apresentação do legítimo chega segundos depois e agora vira 401 mudo em vez de derrubar
a cadeia roubada. A troca foi decidida com o número na mão — 30 s de cegueira contra deslogar o
operador de todo lugar por uma resposta perdida. Fora da janela, nada mudou. Isto **altera o
INV-06**, já reescrito no catálogo.

**A identidade entrou sem tocar em nenhuma assinatura.** As 16 chamadas de API do servidor não
recebem portador por parâmetro, e passá-lo teria sido uma mudança em cascata em tool, resource e
prompt, com o risco de esquecer uma — e uma esquecida é uma chamada com a identidade errada, que
nenhum tipo pega. A saída foi `AsyncLocalStorage` aberto em `comErro`/`comErroDeResource`, os dois
lugares por onde 100% dos handlers passam, e lido em `cliente.ts`. Variável de módulo não serviria:
duas sessões concorrentes sobrescreveriam o portador uma da outra. Em `stdio` não há contexto e o
cliente cai na conta do ambiente, que ali é a identidade certa.

**A trava de escrita tem eixos diferentes nos dois transportes, e não é engano.** Em `stdio` quem
decide é a URL da API ser local (`YUBOOK_ESCRITA_REMOTA` destrava), porque não existe identidade a
consultar. Em HTTP quem decide é o **escopo do token**, marcado no consentimento — e
`MCP_ESCRITA_HABILITADA=0` é o desligamento global que sobra para quando o servidor estiver
hospedado contra a API de produção. Unificar os dois eixos exigiria inventar um deles onde ele não
faz sentido.

**A sessão é com estado, e isso custa escala horizontal.** `sessionIdGenerator` definido é o que
mantém o SSE aberto; sem ele o SDK desliga a via de volta, e com ela vão o log das escritas — a
única trilha de auditoria que chega ao usuário — e o progresso. Preferiu-se o certo ao genérico: com
duas instâncias isto quebra, porque o POST de uma chamada e o GET do SSE podem cair em máquinas
diferentes. Uma instância, sempre, e se um dia houver duas é em `http.ts` que se olha. A sessão
também precisou de varredura de ociosas e teto duro porque **o SDK não fecha sessão quando o cliente
some**: o vazamento é calado, e sem teto vira negação de serviço.

**Dois defeitos apareceram à mão, no fim, e é o que dá a medida do buraco de teste.** `getClient`
devolvia `client_id: ""` para todo cliente, o que tornava tautológica toda comparação de cliente; e
um POST sem session id com corpo que não fosse `initialize` vazava um `McpServer` por tentativa. Os
32 testes novos cobrem as peças — envelopes, provedor, contexto de identidade —, mas **nenhum
exercita o aperto de mão OAuth completo**, e foi exatamente ali que os dois estavam. A dívida fica
registrada com esse nome.

Pendências assumidas, todas no changelog: o teto real da proteção contra revogação em massa é de
**120 s** e não de 30 — quem manda é a janela de idempotência do MCP, não a graça da API, e fechar
isso exigiria o estado durável que se decidiu não ter; `logout` com refresh de rotações atrás não
revoga nada e exige uma coluna `replacedById` no schema; e `trust proxy` não está configurado, o que
na Railway transforma o limite por IP do `/login` num balde global.

**O que ficou de fora, de propósito, é a Etapa 5 do que falta aqui:** conferir o escopo **dentro** de
cada handler de escrita — hoje a trava é só na montagem da sessão, e um handler novo entra sem ela
sem que nada reclame — e o deploy na Railway.

---

## 2026-08-26 — Servidor MCP, Etapa 3: a escrita, e o que decidiu não existir

O servidor passou a mudar dado. São **três numerações vivas no repositório e elas não se
convertem**: esta é a **Etapa 3 das cinco da proposta de MCP** (`old/proposta-mcp-inicial.md`), que
a Etapa 2 declarou fora do próprio escopo em `old/prd-mcp-resources-e-prompts.md` NO1; é a **Fase 2
do roteiro de IA aplicada** (`applied-ai-read-trip.md`); e **não** é fase de produto — as de produto
vão de 0 a 5, estão fechadas, e a próxima delas segue sendo a agenda. Quem unificar os números
depois vai errar os três.

**Granularidade estreita, por escolha do operador.** Uma escrita por chamada, com o menor schema
que resolve o caso. O schema de uma tool não é assinatura de função: é contrato de conversa com o
modelo, e cada campo a mais é uma liberdade a mais para ele inventar combinação inválida. Duas
ausências no `create_card` são decisão, não esquecimento — `checklist` ficou fora porque obriga o
modelo a inventar identificador estável por item, o campo com mais chance de erro e menos valor numa
criação; `position` ficou fora porque a API ignora posição na criação, o card nasce no fim, e aceitar
o parâmetro seria prometer o que não se cumpre. O preço da escolha está medido: `tools/list` saiu de
3480 bytes com 5 tools para 8517 com 9, e isso se paga em todo turno.

**"Arquivar nota" não existe no domínio, e por isso a tool não podia se chamar `archive_note`.** A
proposta original pedia esse nome. O domínio tem duas remoções com nomes diferentes de propósito:
card se **arquiva** (`archived`, sai do quadro) e nota vai para a **lixeira** (`deletedAt`, some da
busca e dos backlinks). Chamar de `archive_note` inventaria um estado que a tabela não tem. E
`delete_note` seria pior por dois motivos independentes: o modelo lê "delete" como irreversível, e
ou recusa por medo ou executa sem oferecer a volta; e queimaria o nome que a exclusão definitiva
precisaria ter, se um dia for exposta. Ficou `trash_note`, com `restore_note` como par explícito.

**A escrita nasce desligada fora de um host local.** As quatro tools só se registram se
`YUBOOK_API_URL` apontar para localhost; contra a Railway elas somem do `tools/list` e o motivo vai
para o stderr no boot. `YUBOOK_ESCRITA_REMOTA=1` destrava, e destravar custa uma decisão escrita. O
motivo é que a premissa mudou: enquanto o servidor só lia, apontar o `.env` para produção era
inofensivo — a leitura não tem consequência. Com escrita, um pedido mal interpretado cria ou remove
dado de verdade no segundo cérebro, e não existe desfazer deste lado. Daí também o segundo ambiente:
banco `yubook_mcp`, API na 3334, seed recriável. O alvo do erro passou a ser descartável.

**O seed escreve pelos services, não pelo Prisma cru.** É o primeiro seed do projeto, e a tentação
era `prisma.note.create`. Não dá: nota criada pelo service recalcula `note_link` a partir dos
`[[…]]` (INV-17, tabela derivada) e board criado pelo service já nasce com as três colunas padrão
e posições contíguas (INV-11). Inserir direto produziria um banco que **parece** certo e mente sobre
o grafo — exatamente o tipo de ambiente de teste que valida o errado. O usuário, esse nasce por
`register()`, porque o MCP entra por `POST /auth/login` e o `passwordHash` precisa ser o argon2 de
verdade; gravar o hash à mão seria espelhar `ARGON_OPTIONS`, e um espelho divergente quebraria o
login com um erro sem relação aparente com o seed. É o atalho que `tests/apoio.ts` pode tomar (ele
assina o JWT direto) e este não podia.

**A gaveta de links é a única exceção da regra, e está comentada no arquivo.** Os três links entram
por Prisma cru porque `links.service.ts` faz `fetch` da página para descobrir o título, com as
defesas de SSRF de INV-08, e um seed não pode depender de rede. A exceção é segura pelo mesmo
critério que criou a regra: `link` não tem **nada derivado**, ao contrário de `note_link`, que só
existe porque o service o calcula. A regra nunca foi "use o service"; é "não escreva à mão o que
outra coisa deriva".

**O seed cresceu depois da revisão, e o motivo é que ambiente de teste que não alcança um ramo não
o testa — apenas deixa de reprovar.** Vários caminhos existiam no código sem poder ser
exercitados. Entraram duas notas na lixeira (uma para a restauração feliz; a outra formando
colisão de título com uma nota ativa, criada **nessa ordem** porque o índice único é parcial e só
cobre as ativas), um card arquivado, `wipLimit: 3` na coluna "Fazendo", um card com checklist 2/3 e
três links. Dois números vão junto e a diferença precisa estar escrita: o seed cria **16 linhas em
`card`, das quais 15 ativas**, e `list_boards` diz 15 porque `listarBoards` conta `archived:
false`. Os dois estão certos e a diferença **é** INV-13. E a coluna "Fazendo" fica com 4 cards
ativos contra `wipLimit: 3` de propósito: o estado que prova INV-15 é o **estourado**, não o
limite existindo.

**Amostragem (*sampling*) não será usada, e isto é registro, não omissão.** Ela serve para o
servidor pedir emprestado o modelo de quem o chamou — e aqui quem chega pelo MCP **já tem um modelo
do outro lado**, que é o que está lendo a tool. Pedir amostragem seria pedir que gerasse um texto
que ele geraria sozinho, com uma volta a mais no protocolo e dependendo de uma capability que a
maior parte dos clientes não implementa. O argumento que decide, porém, é de privacidade e vem da
direção oposta do projeto: a IA **dentro** do Yu-book (`prd-ia-no-yu-book.md`) roda em modelo local
por exigência (RNF-01), e amostragem faria o corpo da nota atravessar o protocolo para ser
processado por um modelo que não é o escolhido. Revisitar se o transporte virar HTTP e o servidor
sair da máquina do operador: amostragem paga a conta em servidor público e multiusuário.

**Raízes (*roots*) não se aplicam** — `apps/mcp` não abre um único arquivo, é cliente HTTP da API.
Implementar hoje seria código morto. A lição fica guardada para a mesa de trabalho, que vai precisar
de cópia em disco de vários repositórios.

**Log vale mais que progresso, e o motivo é auditoria.** Estas são as primeiras operações do
servidor que mudam dado, e todo diagnóstico deste pacote vai para stderr, que nenhum cliente MCP
mostra: um `notifications/message` por escrita é o único registro que o usuário chega a ver de que
uma nota foi para a lixeira. Progresso, com tools estreitas contra API local, é quase ornamental e
entra assim mesmo, porque o mecanismo é o mesmo de que o backfill de embeddings vai precisar (RF-30
do PRD de IA pede progresso visível e retomada) e construí-lo agora custou zero. O que **não** se
faz é inventar passo artificial para a barra parecer cheia: progresso falso ensina o usuário a
ignorá-lo. Junto veio uma regra que não se quebra — **notificação nunca decide o resultado de uma
tool**: quando o relato é emitido a escrita já aconteceu, e deixar um `sendNotification` lançar
transformaria criação bem-sucedida em `isError`, com o modelo criando o card de novo.

**A revisão pegou uma afirmação falsa que eu tinha escrito, e a lição não é sobre o fato errado.**
A descrição de `trash_note` dizia que os links `[[…]]` não voltam ao restaurar. Voltam:
`restaurar` (`apps/api/src/modules/notes/notes.service.ts`) chama `recalcularLinks` para a saída
**e** `reconstruirEntradas` para a entrada — provado no banco de teste, 1 → 0 → 1 aresta em
`note_link` ao excluir e restaurar. A origem do erro é rastreável e é o que interessa guardar:
generalizei o **título** de INV-19 ("restaurar não os refaz"), que no corpo escopava o "não refaz"
ao **card**, e não li INV-18, que diz o oposto para os links. Duas consequências valem a linha —
duas tools do mesmo servidor passaram a se contradizer, e o texto de confirmação contava como perda
justamente o número que volta.

A lição transferível: **juntar numa frase só o que o desfazer desfaz e o que ele não desfaz foi o
que produziu o erro.** Não é descuido de redação, é a estrutura da frase convidando à
generalização. A confirmação de `trash_note` agora separa os dois em linhas distintas, e o
`invariantes-yu-book` já foi corrigido pelo curador: INV-19 passou a se chamar "Excluir nota
desfaz dois vínculos; restaurar refaz um só", com a instrução explícita de não juntar os dois numa
frase só. INV-40 entrou na mesma passagem, para o id de coluna sem o qual as tools de escrita são
inalcançáveis.

**Limite conhecido descoberto junto:** a volta dos backlinks é **melhor esforço**.
`reconstruirEntradas` peneira candidatos com `contentMd contains "[[" + titulo`, que é sensível a
caixa, enquanto casa o alvo por `lower(immutable_unaccent(title))`. Medido:
`[[Notificações de progresso` acha 1 candidato, `[[notificações de progresso` acha 0. O wikilink
continua funcionando na interface, que resolve normalizado; o que não volta é a linha em
`note_link`. Não foi corrigido nesta etapa — é comportamento da API, não do MCP.

**Quatro bugs preexistentes apareceram no caminho, e um era bloqueante.** `formatarQuadro` não
imprimia o id da coluna, e nenhuma outra superfície do servidor imprimia: sem ele não havia caminho
para descobrir um `columnId`, e `create_card` e `move_card` nasceriam inalcançáveis. O segundo é um
off-by-one de um dia no prazo, em todo card que tem um: o front grava às 23:59:59 do fuso local e o
MCP fatiava o ISO em UTC, o que em UTC-3 cai no dia seguinte — corrigido com `diaDoPrazo` e
`diaParaPrazo`. O terceiro, `ErroDaApi` descartava os `issues`, e erro de validação chegava ao
modelo como "Dados inválidos", frase sem informação que o leva a repetir a chamada igual. O quarto:
os dois prompts afirmavam "este servidor é somente leitura", o que desligaria as tools novas
justamente nos fluxos empacotados. Os quatro são anteriores a esta etapa; o quinto, o de cima, foi
**introduzido e pego dentro dela**, e a diferença importa — dívida antiga se herda, afirmação falsa
sobre o próprio domínio se produz. Vieram junto correções menores da mesma revisão:
`trash_note` subcontava os cards desvinculados, porque `cardsDaNota` filtra `archived: false` e
`excluir` zera o `noteId` de todos — card arquivado perdia o vínculo sem entrar na conta;
`trash_note` numa nota já na lixeira devolvia 404 e ainda emitia passo de progresso de algo que não
aconteceu; `diaParaPrazo` lançava `RangeError: Invalid time value` cru para o modelo diante de uma
data sintaticamente válida e inexistente (`2026-13-45`); e um comentário citava "INV do domínio,
Fase 2", identificador que não existe em lugar nenhum, agora apontando os arquivos.

**Dívida declarada na correção do prazo.** A conversão ficou local em `apps/mcp/src/formato.ts`. A
doutrina do projeto (skill `contrato-compartilhado`) mandaria levá-la para `packages/shared` junto
com o que `apps/web/src/components/PainelCard.tsx` faz, porque são duas implementações da mesma
convenção de "fim do dia local" e é exatamente o tipo de espelho que diverge em silêncio. Não foi
feito, para conter o escopo desta etapa. Fica registrado como o próximo candidato a contrato.

**Dívida assumida: não há tool para listar a lixeira.** A consequência é concreta — `restore_note`
só alcança o que a própria conversa acabou de excluir, porque `search_notes` não enxerga nota
excluída e o id não vem de lugar nenhum depois que a conversa acaba. O operador escolheu o conjunto
de quatro tools sabendo disso. A saída, se incomodar na prática, é uma `list_trashed_notes` sobre
`GET /notes?trash=true`.

**O que deliberadamente não virou tool:** excluir card e excluir nota em definitivo (irreversíveis;
card nem lixeira tem, e o aplicativo já faz as duas com um humano confirmando); criar quadro, coluna
ou workspace (é estrutura — quadro criado por conversa vira quadro paralelo em silêncio, e excluir
coluna exige decidir o destino dos cards, INV-14); e editar nota ou card, que é outro problema, com
concorrência contra o autosave do front e merge de conteúdo.

**Esta etapa foi verificada de verdade, e é a primeira em três que se pode dizer isso.** Além do
typecheck nos quatro pacotes, dos 55 testes da API e do build do MCP, rodaram roteiros sequenciais
completos contra o ambiente local: lixeira → busca não acha → restauração → `get_note` confirmando
o que volta e o que não volta → restauração idempotente. Zero linhas não-JSON no stdout em todos os
roteiros; progresso presente com `_meta.progressToken` e ausente sem ele, com log nos dois casos;
contra a Railway, só as cinco tools de leitura aparecem. E `get_board` contra
`yubook://board/{id}`: 1385 bytes idênticos caractere a caractere, que é a prova de que a superfície
se duplica e a implementação não.

Com o seed ampliado, quatro caminhos que antes só existiam no código foram **exercitados**:
`restore_note` na armadilha de título devolveu 409 `TITULO_DUPLICADO`, usando uma mensagem de
`erros.ts` que existia sem nunca ter rodado; `trash_note` em nota já na lixeira devolveu o aviso com
o id para desfazer, sem 404; `move_card` em card arquivado recusou com "Card arquivado não se move.
Desarquive primeiro." (INV-13); e `create_card` com `dueDate: "2026-13-45"` recusou dizendo que não
é uma data existente. Depois das nove correções, `tools/list` ficou em **8517 bytes** com 9 tools —
196 a menos que antes delas, com só `trash_note` crescendo, e crescendo para desfazer a afirmação
falsa.

**Pendências.** A mais importante: **a trava de ambiente protege contra *remoto*, não contra *o
banco errado*.** Ela olha o host, e `localhost:3333` — o banco de desenvolvimento, o acervo de
trabalho de verdade — passa por ela sem reclamar, com o stderr anunciando `escrita: habilitada (API
local)` com toda a confiança. Não é risco hipotético para quem for configurar: é o **estado atual de
quem já configurou**, porque `3333` era o padrão anterior do `.env.example` e nenhum `.env` existente
foi migrado. A porta é a única diferença entre os dois ambientes e nada a verifica. A saída não é
óbvia — checar a porta seria arbitrário, e o sinal honesto seria o servidor perguntar à API em que
banco ela está —, por isso fica registrada em vez de remendada.

Também aberto: a dívida do `diaDoPrazo` em `packages/shared`, acima; e o limite de caixa em
`reconstruirEntradas`, que é da API e não do MCP. E `docs/applied-ai-read-trip.md`
ainda diz "Fases 0 a 4 entregues" e chama a agenda de "Fase 5 de produto", enquanto o README diz 0 a
5 concluídas e chama a agenda de Fase 6 — o roteiro foi escrito antes de a Fase 5 fechar e precisa
ser reconciliado com o README na próxima passagem por ele.

---

## 2026-08-24 — Fase 5, Etapa C: o editor ao vivo, e o que ele custou

A etapa fecha a Fase 5 e a proposta. Saiu em duas metades: os dois commits de ponto de controle
(`f99c0ad`, correção de dois atalhos; `fe798d6`, botão de copiar) e o editor ao vivo, que veio
depois. Uma entrada só no changelog porque movem o mesmo pacote.

**`@codemirror/lang-markdown` foi recusado, e não foi só por peso.** Ele importa
`@codemirror/lang-html` estaticamente e o avalia em escopo de módulo, então tree-shaking não remove:
viriam as pilhas de HTML, CSS e JavaScript junto, ~175 KB gz contra ~105 do conjunto mínimo. O que
decidiu, porém, foi outra coisa: aquele pacote instala três comportamentos que **mexem no documento
sozinhos** — continuar o marcador de lista no Enter, transformar URL colada em link, completar tag
HTML. O requisito de não reescrever um byte (RNF-08) é inegociável aqui, porque `contentMd` é o que
o MCP lê e o que os wikilinks derivam. Usamos `@lezer/markdown` cru embrulhado num `Language`, que é
exatamente o que aquele pacote faz por dentro, sem as três gentilezas.

**A `<textarea>` ficou, e essa é a decisão mais importante da etapa.** Só o modo novo usa CodeMirror;
`edicao`, `dividido` e `leitura` continuam idênticos, na `<textarea>` de sempre. Resolve quatro
coisas de uma vez: o carregamento sob demanda tem o que mostrar enquanto o chunk não chega, CA-33
sai de graça, existe saída imediata se o editor novo der errado — e **acessibilidade**. O
`contentDOM` do CodeMirror é um `role="textbox"` sem nome acessível, só o viewport existe no DOM, e
esconder marcação tira texto do DOM de propósito. Para quem usa leitor de tela, o modo ao vivo é
pior que a `<textarea>`; manter os três modos antigos não é conservadorismo, **é** a mitigação.

**O índice de decoração é reconstruído com três guardas.** Só o viewport visível; comparação das
linhas ativas antes de redesenhar por movimento de cursor; e `if (view.composing) return`. Esta
última é sobre português: cada acento morto (á, ã, ç) é uma composição, e trocar DOM sob composição
ativa duplica ou perde caractere. Custou pouco e evita um bug que só apareceria em uso real.

**`defaultHighlightStyle` foi descartado.** Traz cores fixas, que não seguiriam os dois temas. As
decorações pintam com as variáveis do `index.css`, então o tema claro e o escuro saem sem um
condicional em JavaScript — mesma regra que vale para o resto do front.

**A chave do `localStorage` do modo foi renomeada** (`yb:modo-nota` → `yb:modo-nota-2`), para migrar
o operador ao modo novo uma vez. Trocar só o default não bastaria: o valor antigo continuaria
valendo e o modo que a etapa inteira existe para construir ficaria escondido de quem já tinha
escolhido `dividido`. A chave velha é varrida na primeira leitura, não lida.

**Três desvios foram corrigidos no PRD, porque ele afirmava o contrário do que foi entregue.**

- **RF-31 saiu do escopo**: o botão de copiar não tem atalho. `Ctrl+Shift+C` é "inspecionar
  elemento" no Chrome e no Firefox e `preventDefault()` não cancela. Decisão do operador.
- **`caret.ts` não foi removido.** D-01 e a §17 item 7 diziam que a Etapa C o removeria — e isso
  pressupunha substituir a `<textarea>`. Como ela ficou, o autocomplete dela continua usando
  `posicaoDoCursor` e `wikilinkEmDigitacao`. As duas afirmações foram corrigidas no PRD.
- **Bloco de código no modo ao vivo não tem realce por token**, só monospace e fundo. Realce dentro
  da cerca exigiria parsers aninhados por linguagem, exatamente o peso recusado acima. É uma redução
  frente à redação de RF-33, e o realce completo continua nos modos que passam por `renderMarkdown`.

**Fora de propósito, e assumido:** `marked` e o parser do Lezer convivem no bundle, então o mesmo
texto pode aparecer levemente diferente entre o editor ao vivo e o modo leitura. Unificar os dois
seria trocar o motor de renderização de leitura, que está fora da Fase 5.

**Ficou pendente, e pesa mais do que nas etapas anteriores: nada disto foi executado.**
`pnpm typecheck` limpo nos quatro pacotes, 55 testes da API verdes (nenhum novo — a API não mudou) e
o build do front ok, mas **nenhum portão do projeto carrega uma `EditorView`**, porque não existe
teste de front aqui. Um editor inteiro foi escrito e nunca rodou uma vez. CA-23 a CA-35 estão
implementados e **não verificados**. É a terceira entrega seguida assim, e a primeira em que o não
verificado é um motor de edição e não um ajuste de tato — a falta de teste de front deixou de ser
uma economia e virou dívida com juros. Vale abrir a discussão antes da Fase 6.

---

## 2026-08-24 — Três decisões do operador fechadas na documentação

Nenhuma linha de código mudou aqui; o que mudou foi o que a documentação afirma. Estavam abertas no
PRD coisas que o operador já tinha decidido, e quem começasse a Etapa C leria que ela estava
bloqueada por uma pergunta respondida.

**D-01 fechada: o editor ao vivo será CodeMirror 6 com decorações.** O operador autorizou a
dependência. Ela é a maior que o projeto já aceitou, e o `CLAUDE.md` proíbe biblioteca de UI e de
ícones — um motor de edição de texto não é nem um nem outro, e a autorização vale para o CodeMirror
6 e para nada além dele; RNF-13 continua de pé. As três alternativas seguem registradas em D-01 com
o motivo da recusa; a que mais doía descartar era o `textarea` com camada espelhada, zero
dependências, que morre na exigência de esconder o `#` (RF-33). Consequências já escritas no PRD, e
não só nesta conversa: a Etapa C remove `apps/web/src/lib/caret.ts` (nenhuma skill ou memória cita o
arquivo) e o caminho de fallback — Etapa C encolhida ao botão de copiar — está fechado.

**Q-01 fechada: a numeração das fases.** Fase 5 é este refino, Google Calendar é a Fase 6, e o
Calendar é hoje o item de **menor prioridade** do roadmap. Já estava aplicada em três lugares
(README, `CLAUDE.md`, estrutura do PRD) e só faltava a questão parar de dizer "confirmar antes".

**A seção "O que falta na Fase 5" do README ensinava a regra errada.** Ela descrevia a Etapa B como
pendente e com a formulação original de RF-18 — "índice de inserção pelo ponto médio do card sob o
ponteiro" —, que é exatamente a regra que oscila e que a entrega de hoje substituiu por contagem
geométrica. Um README que contradiz o próprio topo é ruim; um README que ensina a regra descartada é
pior, porque a próxima leitura a reintroduz achando que simplifica. Reescrita, com a ressalva de
**não verificada à mão** mantida.

Ficou pendente: Q-03 (ordem das etapas) sobrou na lista de questões em aberto e virou letra morta —
a ordem A → B já aconteceu. Não foi mexida por estar fora do pedido.

---

## 2026-08-24 — Fase 5, Etapa B: o arraste do kanban, e o índice que não podia oscilar

Entregue a precisão do arraste. Só `apps/web` mudou; contrato, banco, API e MCP ficaram intactos.
Requisitos em [`old/prd-fase-5-refino.md`](old/prd-fase-5-refino.md) §5.3.

**O índice de inserção virou contagem geométrica, não "o ponto médio do card sob o cursor".** A
regra do ponto médio, que era a redação original de RF-18, oscila: inserir empurra o card que estava
sob o cursor, a metade dele cruza o ponteiro, e a conta se inverte no frame seguinte — com a mão
parada. O vizinho pulava sozinho. A contagem — quantos cards da coluna têm o ponto médio acima do
ponteiro, ignorando o arrastado — é idempotente por construção: inserir em `k` empurra só quem tem
índice `≥ k`, então recontar devolve `k` de novo. Não depende da altura do card arrastado nem de
onde ele foi pego. RF-18 foi reescrito no PRD com essa explicação, para que a redação antiga não
volte parecendo simplificação.

**`MeasuringStrategy.Always` foi descartado depois de verificado no `dist`, não deduzido.** RF-20
pedia. No `@dnd-kit/core` 6.3.1 instalado, `isDisabled()` devolve `false` tanto para `Always` quanto
para o default enquanto o arraste acontece — os dois são idênticos durante o gesto —, e a remedição
periódica depende de `frequency` **numérico**, que o default deixa como a string `"optimized"`. Quem
remede é o `SortableContext`, a cada mudança de `items`, e mover o card no estado local muda `items`
a cada `dragOver`. Trocar a estratégia só acrescentaria medição **fora** do arraste. RF-20 virou um
bloco de "já atendido, não implementar" no PRD, com o motivo escrito: sem isso, a próxima leitura do
requisito reintroduz a mudança e o custo volta sem que nada acuse.

**As estratégias de ordenação são assimétricas de propósito: desligadas nos cards, ligadas nas
colunas.** `verticalListSortingStrategy` deslocava o vizinho pela altura do card ativo em cima de um
DOM que já tinha sido reordenado pelo estado local — deslocamento duplo, e o `SortableContext`
religava os transforms justamente no primeiro frame em que a lista se repete, que é quando a mão
para para mirar. Nos cards, quem abre o vão é o DOM. Nas colunas não dá para desligar: ali os
`items` não mudam durante o gesto e o transform é o único mecanismo que existe. Padronizar os dois
lados quebra um deles, e a tentação de padronizar é real porque o código fica com dois
`SortableContext` visivelmente diferentes lado a lado. Virou RF-27 no PRD e INV-36 no catálogo de
invariantes.

**O card do vão some por opacidade e nunca por `visibility` ou `display`.** Ele é o elemento focado,
e é nele que o `KeyboardSensor` escuta. Escondê-lo de verdade tiraria o foco do documento e mataria
o arraste por teclado inteiro — e **nada acusaria**: `typecheck` passa, os testes da API passam, e
não existe teste de front neste projeto. Pela mesma razão o contorno tracejado é `outline` e não
`border`: borda mudaria o box e dispararia remedição da coluna no meio do gesto.

**O limiar do auto-scroll ficou assimétrico entre os eixos (`{x: 0.06, y: 0.22}`).** O default de
0,2 da largura cria uma faixa de ~280 px num board de 1400 px, e o dnd-kit para no **primeiro**
contêiner que consegue rolar: dentro dessa faixa, o board horizontal ganha sempre, e a primeira e a
última coluna nunca rolariam na vertical. Estreitar o eixo x devolve a rolagem vertical às colunas
das pontas sem tirar a horizontal do board. É a única mudança da etapa apoiada em **análise do
comportamento da biblioteca**, e não em observação do gesto — o que a torna a primeira candidata a
estar errada.

**Pendência, e é a que mais pesa: a verificação à mão do gesto não foi feita.** Nenhum portão
automático valida esta etapa. O que passou foi `pnpm typecheck` nos quatro pacotes, os 55 testes de
integração da API (rodados como regressão; nenhum novo, porque a API não mudou) e o build do front —
e nenhum deles observa um arraste. **CA-14 a CA-22 estão implementados e não verificados.** O
operador decidiu fechar assim mesmo para começar a Etapa C; o registro fica para que ninguém leia
"entregue" como "conferido". Dois pontos merecem destaque quando a conferência acontecer:

1. **Arrastar uma posição e parar a mão.** Nenhum vizinho pode pular. É o sintoma que motivou a
   etapa inteira e o que a contagem geométrica e as estratégias desligadas existem para eliminar —
   se ele sobrevive, a hipótese estava errada, não o ajuste.
2. **Rolagem vertical na primeira e na última coluna de um board largo**, com o board também
   rolando na horizontal. É a única mudança sem observação por trás.

O `curador` já rodou na mesma sessão: INV-35 (o índice geométrico e por que a regra do ponto médio
oscila) e INV-36 (a assimetria das estratégias de ordenação) entraram em `invariantes-yu-book`, e
INV-30 e INV-33 ganharam notas — o catálogo está em 272 de 300 linhas, perto do teto.

---

## 2026-08-24 — Fase 5, Etapa A: tag de card, e o eixo que faltava no quadro

Entregues as tags de card e a busca no cartão de tags da barra lateral. Requisitos em
[`old/prd-fase-5-refino.md`](old/prd-fase-5-refino.md), um PRD novo que cobre as três etapas da Fase 5.

**A Fase 5 deixou de ser o Google Calendar.** O PRD assume a numeração nova: refino do que já
existe é a Fase 5, e a agenda passa para a Fase 6. Não é reordenação por conveniência — o operador
decidiu que o Calendar é a prioridade mais baixa hoje, e a `PROPOSTA-inicial.md` já tratava a agenda
como conveniência, com condição de corte de meio dia. Só a Etapa A está entregue; B (arraste) e C
(copiar nota, editor ao vivo) não começaram.

**Revertemos o NO6 da Fase 2, de propósito.** O PRD do kanban dizia, com todas as letras, que
etiqueta era coisa de nota e que o card não teria a sua. O uso desmentiu: coluna e assunto são eixos
independentes, e sem o segundo o quadro só sabia agrupar por estágio — quem quisesse ver "tudo de
banco de dados" espalhado por três colunas não tinha como. Forçar isso no eixo que existia
significava criar coluna por assunto, que é justamente o que faz um kanban parar de dizer em que
ponto as coisas estão. Um não-objetivo revertido pelo uso é conhecimento adquirido, não erro
corrigido, e por isso está escrito no changelog em vez de apagado do PRD antigo.

**Tag de card é `text[]` na linha do card, sem tabela.** A tentação era reaproveitar a tabela `tag`,
que já existe para as notas. Ela tem cor, id próprio, unicidade por usuário e um `limparTagsOrfas`
que roda depois de cada desvínculo. Tag de card não quer nada disso: o escopo é um board, a
identidade é o próprio texto, não há renomeação e ela morre com o card. Reaproveitar a tabela
obrigaria `limparTagsOrfas` a varrer duas relações e daria catálogo global e cor a algo que não usa
nenhum dos dois — acoplando duas coisas que só coincidem no nome. O preço aceito é a assimetria:
duas noções de "tag" no projeto, com armazenamentos diferentes, e quem ler o schema pela primeira
vez vai estranhar. Está anotado no comentário do modelo `Card` por causa disso.

**O filtro do board é OU; o filtro de notas da barra lateral continua E.** Divergência deliberada
entre duas telas que parecem fazer a mesma coisa. No cartão de notas (RF-07 da Fase 1) o objetivo é
**estreitar** até achar uma nota específica, e cada tag adicionada corta mais. No board o objetivo é
o oposto: **agregar** assuntos espalhados por colunas diferentes. Com E, selecionar a segunda tag
esvaziaria o quadro quase sempre, já que poucos cards carregam duas etiquetas ao mesmo tempo — o
gesto pareceria quebrado. Se um dia isso confundir, a saída é rotular o modo na barra, não unificar
a semântica.

**RN-05 — com filtro ativo, o arraste é desligado, e isso é recusa e não limitação.** O índice de
destino do arraste é contado sobre a lista renderizada. Com o quadro recortado, "soltar na segunda
posição" significa a segunda posição *do recorte*, e o servidor renumera a coluna inteira em cima
desse número (RN-01 / INV-11): a ordem real embaralharia sem ninguém ver, que é exatamente a
corrupção silenciosa que a invariante existe para impedir. A alternativa seria traduzir o índice do
recorte para o da lista real — possível, mas é aritmética que só está certa enquanto ninguém mexe
na coleção durante o gesto, e errar ali não dá erro, dá ordem trocada. Vale para mouse **e**
teclado: `coluna.cards` continua sendo a verdade para contagem, WIP e posição; o filtro só decide o
que é pintado. O quadro filtrado diz por que o arraste não responde e oferece o botão de limpar.

**Nenhum endpoint novo.** O catálogo de tags de um board sai dos cards que o `GET /boards/:id` já
traz inteiros. Um `/boards/:id/tags` seria uma segunda fonte de verdade para a mesma informação, com
a chance de discordar da primeira num intervalo de cache. A consequência boa é que a última
desmarcação faz a tag sumir do catálogo sozinha — não há órfã para limpar, e é o que dispensa um
`limparTagsOrfas` do lado do card.

**O `ADD COLUMN` ficou sem `NOT NULL`, e foi mantido como o gerador escreveu.** É a convenção do
próprio Prisma para lista escalar: `String[]` não aceita nulo do lado do cliente, e o default
`ARRAY[]::TEXT[]` cobre as linhas existentes. Editar o SQL à mão para "melhorar" a migration
introduziria drift entre o arquivo e o que o Prisma espera, e `migrate deploy` roda no boot de
produção — drift ali derruba deploy. Regra que vale para a próxima: migration gerada não se edita
por estética.

**Dívida nova, do tipo que quebra em silêncio:** `normalizarTag` é chamada no front, antes de
mandar, e de novo na API, antes de gravar. A repetição é intencional — confiar no cliente aqui é
como confiar nele no `userId` —, mas se um dos dois lados deixar de chamar, `Banco` e `banco` viram
duas entradas no catálogo do board e nada acusa: `typecheck` passa, os testes passam, e o efeito só
aparece como duas etiquetas quase iguais na barra de filtro. Entra na lista de espelhamentos
frágeis, ao lado de `normalizarTitulo`/`immutable_unaccent` e de `moverNoBoard`/renumeração.

**Pendência.** A verificação à mão da interface — dois temas, navegação por teclado no seletor de
tags e na barra de filtro — **não foi feita**. O que passou foi `pnpm typecheck` nos quatro pacotes,
55 testes da API e o build do front; o formato do MCP foi conferido isoladamente. A propagação para
as skills que a §13 do PRD exige já foi feita pelo `curador` na mesma sessão: `normalizarTag` entrou
no catálogo de espelhamentos frágeis de `contrato-compartilhado`, e RN-05 e a assimetria entre as
duas noções de tag viraram INV-33 e INV-34 em `invariantes-yu-book`.

---

## 2026-08-24 — Cor dos agentes, e o enum que não aceita `gray`

Os nove agentes em `.claude/agents/` ganharam `color:` no frontmatter. É apresentação pura: a cor
identifica o agente na lista de tarefas e no transcript do Claude Code, e nada no Yu-book depende
dela.

**`gray` não existe, e falha calada.** `versionador` e `zelador` tinham sido postos em `color: gray`,
que o binário do Claude Code ignora em silêncio — não avisa, não recusa o agente, apenas não pinta.
O enum aceito tem oito valores e nenhum cinza:

```
red, blue, green, yellow, purple, orange, pink, cyan
```

Verificado no binário (`~/.local/share/claude/versions/…`), não deduzido: a lista está literal no
código e a validação é um `includes` — valor fora dela é descartado sem erro. `gray` e `grey` até
aparecem no binário, mas na tabela de cores de terminal, que é outra coisa; foi provavelmente daí
que veio a confiança de que serviriam. `versionador` foi para `cyan` e `zelador` para `yellow`.

**Não entra no `CHANGELOG.md`, e isso é decisão, não esquecimento.** A regra da casa é que o
changelog registra efeito observável para quem usa o Yu-book, e cor de subagente é ferramenta de
desenvolvimento. Há precedente em sentido contrário — a 0.3.0 cita o nascimento do agente `mcp` e o
passo novo no checklist do `revisor` —, mas os dois mudam o que o método de trabalho **faz**:
quem é dono de qual pacote, o que a revisão passa a pegar. Cor não muda nada; muda só o que se vê.
A linha fica aí: agente entra no changelog quando altera capacidade ou responsabilidade, não quando
altera aparência. Nenhum contrato mudou, nenhum pacote foi afetado, nenhuma versão foi bumpada.

**Dívida aceita: três verdes e dois azuis.** São nove agentes para oito cores, então uma colisão é
inevitável — três não são, e `pink` e `purple` seguem livres. As repetições também não seguem
critério: o verde cobre `backend`, `curador` e `revisor`, que não têm afinidade entre si. O operador
foi avisado e decidiu deixar como está por ora, já que o custo de confundir dois agentes no
transcript é baixo. Pendência de baixa prioridade: se atrapalhar na prática, gastar as duas cores
livres nos dois verdes sobrando, em vez de inventar um critério de agrupamento que hoje não existe.

---

## 2026-08-24 — MCP, Etapas 2 e 4: o agente `mcp` e o portão que estava vermelho

Fechadas as três primitivas do protocolo em `apps/mcp`. Requisitos em
[`old/prd-mcp-resources-e-prompts.md`](old/prd-mcp-resources-e-prompts.md).

**Nasceu o agente `mcp` por causa de um risco que nenhum portão pega.** `apps/mcp` era o único
pacote sem dono, mas não foi a lacuna organizacional que decidiu: foi o modo de falha. Campo novo
no domínio, entidade nova, filtro novo — nada disso **quebra** o servidor MCP. `pnpm typecheck`
passa, a suíte da API passa, e o servidor simplesmente continua expondo o mundo de ontem. O
precedente estava à mão: `updatedAt` existia na tabela `card` desde a Fase 2 e só chegou à face do
card agora, quando um prompt precisou dele. Uma falha silenciosa só se pega por procedimento, então
o agente ganhou um modo B — verificar propagação depois que o domínio muda — com a obrigação de
**declarar quando nada precisa mudar**, porque silêncio é indistinguível de esquecimento. E o
`revisor` passou a apontar a mesma verificação quando o diff toca `packages/shared/src`, para o caso
de ninguém chamar o agente.

**A skill do MCP foi escrita, não baixada.** Existe skill genérica de servidor MCP disponível, e ela
seria pior que nada aqui. Skill é prescritiva, e quase toda decisão nossa é o oposto do padrão que
uma skill genérica ensina: o servidor é cliente da API e não do banco, a resposta é texto compacto e
não JSON, `search_notes` não devolve corpo de nota, a identidade é uuid e não título, o esquema fica
em português. Uma skill genérica não teria dito nada disso e teria contradito parte. O que se
importa de fora é conhecimento do protocolo — que o SDK já traz na tipagem.

**Propriedade nova sem migration.** `CardSummary.updatedAt` e o `NoteTitle` com workspace saíram de
colunas que já existiam: o que faltava era a API expô-las. Virou regra do PRD (RF-25) — se uma
propriedade da superfície do MCP exigir coluna nova, ela não entra nessa etapa e vira pedido
separado. O servidor MCP não é motivo suficiente para mexer no modelo de dados.

**Estimativa não medida vira requisito.** O comentário de `titulos()` dizia "~40 bytes por nota".
Ninguém mediu, e o número é impossível: o uuid sozinho tem 36 caracteres. A medição real deu ~98 B.
O problema não foi o comentário errado — foi ele ter sido copiado para um RNF antes de alguém
conferir. O teto do catálogo passou a ser por **quantidade** de itens (200), que é o que se
consegue garantir sem medir de novo a cada mudança de campo.

**O único portão automático do projeto estava vermelho havia semanas.** A suíte de integração da API
acusou 15 falhas. Antes de atribuí-las ao trabalho da sessão, o trabalho foi guardado e a suíte
rodou contra o código original: **as mesmas 15 falhas**. A causa era `public.link` não existir no
banco local — as migrations de duas fases nunca tinham sido aplicadas ali. Depois de `db:deploy`,
47 de 47. Duas lições: rodar a suíte contra o código original antes de culpar o diff, e que um
portão que ninguém roda não é portão. Fica a pendência de rodar a suíte no começo da sessão, não no
fim, já que não existe CI para fazê-lo.

**`docs/` é documentação técnica do Yu-book.** O dossiê de casos foi para `docs/temp/`: é
matéria-prima para outro projeto gerar conteúdo, e material que descreve o projeto de fora não deve
concorrer com PRD e histórico na busca de quem procura como o Yu-book funciona.

---

## 2026-08-22 — Servidor MCP, Etapa 1, e o agente `publicador`

Primeira etapa do servidor MCP do Yu-book em `apps/mcp`: quatro tools de leitura sobre stdio.
Guia em [`old/proposta-mcp-inicial.md`](old/proposta-mcp-inicial.md).

**TypeScript em vez do Python das aulas.** O curso ensina com o SDK Python, mas em TS o servidor
importa `@yu-book/shared` e os schemas Zod das tools **são** os que a API já valida. Em Python
seriam reescritos em Pydantic — exatamente a segunda fonte de verdade que o projeto evita. O
Inspector da aula 04 existe em TS, então nada do material se perde.

**O servidor é cliente da API, não do banco.** Custa uma requisição a mais e herda de graça o
escopo por `userId`, a posse por cadeia e os códigos de erro estáveis. Importar o Prisma exigiria
reimplementar esse escopo fora dos services, e erro ali vaza dado entre contextos. Efeito colateral
bem-vindo: trocar entre local e produção virou trocar uma variável de ambiente.

**`search_notes` não devolve corpo de nota.** É o mesmo problema que `GET /notes` teve — o corpo de
50 notas custava 4,2 MB por página até truncarem no banco. Numa tool, quem paga a conta é a janela
de contexto do modelo. Ficou o par: `search_notes` acha, `get_note` lê. E a resposta é texto
compacto, não JSON: vinte resultados em JSON gastam um terço dos tokens em chaves repetidas.

**Login por credencial no `.env`, não fluxo de autorização.** O `fetch` do Node não guarda cookie e
o refresh token vive num cookie `httpOnly`; em vez de um cookie jar, o servidor entra de novo quando
o token de 15 min expira. É o primeiro item a mudar quando entrarem transporte HTTP e autenticação.

**O domínio de produção da API foi descoberto pelo bundle do front.** `VITE_API_URL` é substituído
em tempo de build, então o endereço da API fica dentro do JavaScript publicado. O domínio que
parecia ser o da API (`yu-bookweb-production`) era o do SPA — o `/health` dele devolve HTML.

**Novo agente `publicador`, e o PRD foi para a v0.2.** A separação em relação ao `versionador` é de
risco, não de assunto: um edita markdown, o outro publica em produção. Aqui `git push` para `master`
é deploy sem etapa de aprovação, e isso merece um agente com guarda própria — nunca dá push sem
pedido explícito no turno, e autorização para commitar não vale como autorização para publicar.

**Dívida descoberta e ainda aberta:** instalar `apps/mcp` somou 80 pacotes ao `pnpm-lock.yaml`, que
está nas Watch Paths da API **e** do web. Um push passa a reconstruir os dois serviços por causa de
um pacote que nenhum deles usa, e o `pnpm install` da raiz leva o SDK do MCP para dentro do build de
produção. Conserto candidato: filtrar o install no `buildCommand` do `apps/api/railway.json`.

---

## 2026-08-22 — Estrutura de agentes, skills e memória

Criada a estrutura `.claude/` do projeto: sete agentes, seis skills, memória persistente por agente
e `CLAUDE.md`. Requisitos em [`old/prd-agentes-e-skills.md`](old/prd-agentes-e-skills.md).

**Por que agentes especialistas e não um prompt genérico.** O repositório acumulou decisões que
parecem erro para quem não as conhece — 404 no lugar de 403 no kanban, o termo repetido inline em
`porSimilaridade`, a cirurgia de cache do autosave. Sem contexto, cada sessão arriscava "corrigir"
uma dessas. O custo não aparece como erro: aparece como regressão silenciosa de desempenho ou de
comportamento.

**A doutrina de curadoria foi a decisão central.** Quatro destinos mutuamente exclusivos, com um
teste cada: skill para o que é prescritivo e estável, memória para o que é descoberto e volátil,
`CLAUDE.md` para o mínimo sempre carregado, comentário no código para o porquê que pertence à linha.
Registro em dois destinos é duplicação, resolvida removendo do mais fraco. E memória contradita pelo
código é **removida**, não corrigida — assim nenhum registro carrega uma correção sem data.

**Limites duros em vez de bom senso.** Memória com 2 KB e 60 linhas, skill com 300 linhas,
`CLAUDE.md` com 60. Estourar obriga promover ou descartar; o limite não sobe. Era o risco mais
concreto do desenho — memória que vira depósito custa contexto em toda sessão e devolve pouco.

**O zelador foi redefinido.** Como faxineiro ele não teria trabalho: a varredura encontrou zero
`console.log` e zero `TODO`/`FIXME` no código-fonte. O trabalho real é outro — dívida declarada,
entidade modelada sem uso, constante duplicada. E veio com uma lista de exclusão do que **parece**
morto e não é, porque o risco de um agente de limpeza neste repositório não é deixar lixo, é remover
carga útil.

**Alternativa descartada: um agente de segurança dedicado.** SSRF, cadeia de tokens e escopo por
usuário já estão catalogados como invariantes e são cobrados pelo revisor, e existe o
`/code-review` nativo. Um oitavo agente dividiria a responsabilidade sem cobrir nada novo.

**Alternativa descartada: skill de migrations como agente próprio.** O SQL fora do Prisma é sutil —
`immutable_unaccent`, a configuração `pt_unaccent`, o trigger de `search_vector`, o índice único
parcial —, mas é território do backend e não tem contexto próprio suficiente. Virou skill.

**Achado durante o levantamento:** `Ctrl+K` tem duplo vínculo. O handler do editor
(`apps/web/src/components/Editor.tsx`) chama `preventDefault()` mas não `stopPropagation()`, e o
handler global está em `window` (`apps/web/src/components/Aplicacao.tsx:189`) — dentro do editor a
tecla insere `[](url)` **e** abre a paleta. `Atalhos.tsx` documenta `Ctrl+K` como sendo do editor,
então a intenção é clara. Não corrigido nesta sessão: está no relatório de dívida do zelador.

**Pendências que sobraram:** o que fazer com a tabela `company`, morta desde a migration inicial
(já era decisão pendente em `PROPOSTA.md`); se o zelador deve varrer `docs/` atrás de documentação
desatualizada — o `README.md` afirma cinco migrations e existem seis.

---

## 2026-08-20 — Redesenho da navegação

A coluna de navegação ganhou ícones próprios, seções recolhíveis e um cartão para as tags.

**Ícones desenhados à mão em vez de biblioteca.** São poucos, e um pacote traria centenas para usar
nove, com estilo que não é o da casa. Ficaram num arquivo só, grade 16×16, traço único e
`currentColor` para seguirem tema e estado do item sem condicional.

**A invariante da seção recolhível.** Uma seção fechada precisa continuar mostrando o que está
escondido: o filtro de tipo ativo aparece como ícone e rótulo no resumo, e o cartão de tags mostra
a contagem de tags selecionadas. Esconder o controle nunca pode esconder que o filtro continua
valendo — senão o usuário vê uma lista filtrada sem entender por quê.

Nenhum token de cor mudou. O redesenho ficou contido em quatro arquivos.

---

## 2026-08-14 — Fases 0 a 4

Entregues em sequência, sem release intermediário — daí a versão única `0.1.0` no changelog.
As decisões de escopo estão em [`old/PROPOSTA-inicial.md`](old/PROPOSTA-inicial.md) e os requisitos nos PRDs de fase.

**A decisão que sustenta o resto: uma entidade forte, não sete.** Uma `Note` com um campo `kind`, em
vez de tabelas separadas para aula, projeto, trilha e trabalho. É o que faz uma busca só atravessar
todos os contextos, e o que torna um tipo novo de nota uma linha no enum em vez de um CRUD novo.

**A agenda foi empurrada para o Google Calendar.** Construir uma segunda visão de calendário para
competir com uma que já fica aberta o dia inteiro seria trabalho puro-perda. O Yu-book cria o evento
lá e sai da frente. Com condição de corte declarada: se a integração custar mais de meio dia, a
Fase 5 inteira sai do escopo e `event` é removida do schema — não se constrói calendário próprio
como consolo.

**Sem favicon na gaveta de links, de propósito.** Guardar a imagem exigiria storage de objetos, e
buscá-la de um serviço de terceiros entregaria a ele a lista de tudo que se salva. A identidade
virou um bloco de cor derivada do domínio.

**O debounce do autosave continuou em 800 ms** mesmo durante a otimização de desempenho. O problema
nunca foi a frequência do salvamento, e sim o que cada salvamento arrastava junto — seis requisições
viraram uma sem tocar no intervalo. É requisito de PRD com critério de aceitação próprio (RF-14).

**O `PATCH` continuou devolvendo o corpo da nota.** Em nota muito grande isso dobra o tráfego do
autosave, mas a resposta completa é o que garante que o cache do front não divirja do banco. Dívida
consciente, reavaliável se as notas passarem de centenas de KB.

**Dívidas assumidas e ainda abertas:** a lixeira nunca expurga, embora a Fase 1 tenha prometido 30
dias; a tabela `company` segue morta no schema; não existe script de `pg_dump` nem export — o backup
da Railway protege contra *perder* os dados, não contra *querer sair*.
