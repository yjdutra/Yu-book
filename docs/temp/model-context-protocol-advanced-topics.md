# MCP: Advanced Topics — anotações de curso

**Curso:** Model Context Protocol: Advanced Topics (Claude Academy) · **Anotações:** yjdutra
**Progresso:** 6 de 11 lições (parte I fechada; parte II não iniciada)
**Projeto que acompanha:** Yu-book — servidor MCP em [`apps/mcp`](../../apps/mcp)

> **Como ler este arquivo.** O corpo é a anotação do curso, revisada só na forma: títulos,
> blocos de código com linguagem, correção de artefatos da tradução automática
> (*"Pitão"* → Python, *"ligar para Claude"* → chamar Claude, `acreate_message` → `create_message`)
> e remoção de duplicações de trecho de código. **Nada de conteúdo foi acrescentado ou removido
> dentro das lições.**
>
> As caixas marcadas **`→ Ponte para o Yu-book`** são acréscimo da revisão, não do curso.
> Elas ligam cada lição ao que está escrito em [`applied-ai-read-trip.md`](../applied-ai-read-trip.md)
> e em [`prd-ia-no-yu-book.md`](../prd-ia-no-yu-book.md). Estão sempre em citação, para que
> anotação e comentário nunca se confundam.

---
Notas de entendimento:
### O elenco: quem é quem, onde mora, do que responde

Esta é a sua dúvida principal, então vou ser explícito ao ponto de ser repetitivo.

| # | Peça | Onde está hospedada | Responsabilidade única | O que ela não faz |
| :--- | :--- | :--- | :--- | :--- |
| 1 | O modelo (Claude) | Servidores da Anthropic, na nuvem | Receber texto, devolver texto | Não toca no seu disco, não fala com seu Postgres, não executa nada |
| 2 | O host / aplicação cliente — no seu caso, o Claude Code aberto no terminal | Sua máquina, dentro de `/home/yuri/Documentos/Yu-book` | Falar com o modelo (é quem tem a assinatura), mostrar o resultado para você, e hospedar um cliente MCP para cada servidor configurado | Não conhece o domínio do Yu-book |
| 3 | O cliente MCP | Dentro do host — não é programa separado, é um objeto na memória do Claude Code. Um por servidor | Falar o protocolo com um servidor MCP, e atender os pedidos que esse servidor faz de volta | Não sabe o que a tool faz por dentro |
| 4 | O servidor MCP do Yu-book — `apps/mcp` | Sua máquina. É um `node dist/index.js` que o próprio Claude Code inicia como subprocesso ao abrir a sessão, conversando por `stdin`/`stdout` | Expor o domínio do Yu-book em *tools*, *resources* e *prompts* | Não tem chave de LLM. Não fala com modelo nenhum. Não fala com o banco. |
| 5 | A API — `apps/api` | Railway, em produção, na internet | Regra de negócio, autorização por usuário, e é a única que fala com o Postgres | Não sabe que MCP existe — para ela o `apps/mcp` é só mais um cliente HTTP logado |
| 6 | O Postgres | Railway | Guardar dados | — |
| 7 | A web — `apps/web` | Servida pela Railway, executada no navegador | Interface | Hoje não tem uma linha de IA |

A cadeia inteira, em uma linha:

```text
você → Claude Code (sua máquina) ─┬─→ modelo Claude (nuvem Anthropic)
                                  └─→ apps/mcp (sua máquina, stdio)
                                         └─→ apps/api (Railway, HTTPS)
                                                └─→ Postgres (Railway)
```

Três fatos que resolvem a maior parte da confusão:

1. **"Servidor MCP" não quer dizer servidor na internet.** O seu roda na sua máquina, sem porta, sem URL. É "servidor" no sentido de quem serve capacidades, não de onde está hospedado. Isso muda na Parte II do curso — e é exatamente por isso que a Parte II é o degrau.
2. **O `apps/mcp` nunca fala com o modelo.** Ele nem sabe qual modelo está do outro lado. Ele recebe "chame `get_note` com esse id" e devolve texto. Quem decide chamar é o modelo; quem executa a chamada é o cliente; quem faz o trabalho é o servidor.
3. **O `apps/mcp` também não fala com o banco.** Ele faz *fetch* na sua API em produção, com email e senha do `.env` (`apps/mcp/src/cliente.ts`). Isso é decisão registrada: ser cliente da própria API faz ele herdar toda a autorização em vez de reimplementá-la.
---

## Mapa do curso

### Parte I — Principais recursos do MCP

| # | Lição | Estado |
|---|---|---|
| 1 | Amostragem (*sampling*) | ✅ |
| 2 | Passo a passo de amostragem | ✅ |
| 3 | Notificações de registro e progresso | ✅ |
| 4 | Passo a passo de notificações | ✅ |
| 5 | Raízes (*roots*) | ✅ |
| 6 | Passo a passo de raízes | ✅ |

### Parte II — Transportes e comunicações

| # | Lição | Estado |
|---|---|---|
| 7 | Tipos de mensagens JSON | ⬜ |
| 8 | O transporte STDIO | ⬜ |
| 9 | O transporte StreamableHTTP | ⬜ |
| 10 | HTTP transmissível em profundidade | ⬜ |
| 11 | Estado e o transporte StreamableHTTP | ⬜ |

### Encerramento

| Item | Estado |
|---|---|
| Avaliação dos conceitos do MCP (questionário) | ⬜ |
| Crachá de conclusão | ⬜ |

---

## O eixo que atravessa a parte I

As três lições da parte I — amostragem, notificações e raízes — são a **mesma ideia vista de três
ângulos**: no MCP a conversa é de mão dupla. O cliente não é só quem pergunta e o servidor não é só
quem responde. **O servidor também faz pedidos ao cliente**, e cada recurso é um tipo de pedido:

| Recurso | O servidor pede ao cliente | Espera resposta? |
|---|---|---|
| Amostragem | "gere este texto com o seu modelo" | sim |
| Registro e progresso | "avise ao usuário que estou nesta etapa" | não |
| Raízes | "quais pastas eu posso tocar?" | sim |

Isso também explica por que a parte II vem logo depois: essa via de volta é fácil quando o
transporte é **stdio** (um processo por usuário, uma conexão só) e passa a ser um problema quando o
transporte é **HTTP** (um servidor, muitos clientes).

---

# Parte I — Principais recursos do MCP

## Lição 1 — Amostragem (*sampling*)

A amostragem permite que um **servidor** acesse um modelo de linguagem como Claude **por meio do
cliente MCP conectado**. Em vez de o servidor chamar Claude diretamente, ele pede ao cliente que
faça a chamada em seu nome. Isso transfere a responsabilidade e o custo da geração de texto do
servidor para o cliente.

### O problema que a amostragem resolve

Imagine um servidor MCP com uma ferramenta de pesquisa que busca informações da Wikipédia. Depois de
reunir todos esses dados, é preciso resumi-los em um relatório coerente. Há duas opções:

**Opção 1 — dar ao servidor MCP acesso direto a Claude.**
O servidor precisaria da própria chave de API, lidaria com autenticação, gerenciaria custos e
implementaria todo o código de integração com Claude. Funciona, mas acrescenta complexidade
significativa.

> *Diagrama de sequência da opção 1: o servidor MCP recebe acesso direto a Claude; depois que a
> ferramenta de pesquisa busca os resultados da Wikipédia, o próprio servidor pede a Claude que os
> resuma.*

**Opção 2 — usar amostragem.**
O servidor gera um prompt e pergunta ao cliente: *"você poderia chamar Claude para mim?"*. O
cliente, que já tem conexão com Claude, faz a chamada e retorna o resultado.

> *Diagrama de sequência da opção 2: o servidor MCP gera um prompt e pede ao cliente MCP que chame
> Claude em seu nome; o cliente chama e devolve o resultado ao servidor.*

### Como funciona

1. O servidor conclui seu trabalho (como buscar artigos da Wikipédia).
2. O servidor cria um prompt solicitando a geração de texto.
3. O servidor envia uma solicitação de amostragem ao cliente.
4. O cliente chama Claude com o prompt fornecido.
5. O cliente retorna o texto gerado para o servidor.
6. O servidor usa o texto gerado em sua resposta.

### Benefícios

- **Reduz a complexidade do servidor** — ele não precisa se integrar diretamente a modelos de linguagem.
- **Transfere a carga de custo** — quem paga os tokens é o cliente, não o servidor.
- **Dispensa chaves de API** — o servidor não precisa de credencial de Claude.
- **Ideal para servidores públicos** — um servidor aberto não acumula custo de IA por usuário.

### Implementação

A configuração exige código dos dois lados.

**Lado do servidor** — dentro da função da ferramenta, use `create_message` para pedir a geração:

```python
@mcp.tool()
async def summarize(text_to_summarize: str, ctx: Context):
    prompt = f"""
    Please summarize the following text:
    {text_to_summarize}
    """

    result = await ctx.session.create_message(
        messages=[
            SamplingMessage(
                role="user",
                content=TextContent(type="text", text=prompt),
            )
        ],
        max_tokens=4000,
        system_prompt="You are a helpful research assistant",
    )

    if result.content.type == "text":
        return result.content.text
    else:
        raise ValueError("Sampling failed")
```

**Lado do cliente** — crie um *callback* de amostragem que atende às solicitações do servidor:

```python
async def sampling_callback(
    context: RequestContext, params: CreateMessageRequestParams
):
    # Chama Claude usando o SDK da Anthropic
    text = await chat(params.messages)

    return CreateMessageResult(
        role="assistant",
        model=model,
        content=TextContent(type="text", text=text),
    )
```

E passe esse *callback* ao inicializar a sessão do cliente:

```python
async with ClientSession(
    read,
    write,
    sampling_callback=sampling_callback,
) as session:
    await session.initialize()
```

### Quando usar

A amostragem é mais valiosa em **servidores MCP acessíveis ao público**. Não se quer que usuários
aleatórios gerem texto ilimitado às suas custas. Com amostragem, cada cliente paga pelo próprio uso
de IA e ainda se beneficia da funcionalidade do servidor.

A técnica move a complexidade da integração de IA do servidor para o cliente — que, em geral, já tem
as conexões e credenciais necessárias.

> **→ Ponte para o Yu-book.** Este é o argumento técnico por trás do **NO3** do
> [`prd-ia-no-yu-book.md`](../prd-ia-no-yu-book.md) ("não expor as funções de IA pelo servidor MCP"):
> quem fala com o `apps/mcp` **já tem um modelo do outro lado**. Também é a alternativa concorrente
> ao módulo `assistente` da Fase 1 do PRD — e ela perde por um motivo só: amostragem manda o corpo
> da nota para o modelo do cliente (nuvem), enquanto o **RNF-01** exige modelo local para conteúdo
> de nota. A escolha é de privacidade, não de arquitetura.

---

## Lição 2 — Passo a passo de amostragem

### 1. Iniciando a amostragem

No servidor, durante uma chamada de ferramenta, execute `create_message()` passando as mensagens que
se deseja enviar ao modelo de linguagem.

```python
from mcp.server.fastmcp import FastMCP, Context
from mcp.types import SamplingMessage, TextContent

mcp = FastMCP(name="Demo Server")


@mcp.tool()
async def summarize(text_to_summarize: str, ctx: Context):
    prompt = f"""
        Please summarize the following text:
        {text_to_summarize}
    """
    result = await ctx.session.create_message(
        messages=[
            SamplingMessage(
                role="user", content=TextContent(type="text", text=prompt)
            )
        ],
        max_tokens=4000,
        system_prompt="You are a helpful research assistant.",
    )
    if result.content.type == "text":
        return result.content.text
    else:
        raise ValueError("Sampling failed")


if __name__ == "__main__":
    mcp.run(transport="stdio")
```

### 2. *Callbacks* de amostragem

No cliente, é obrigatório implementar um *callback* de amostragem. Ele recebe a lista de mensagens
fornecida pelo servidor.

### 3. Formatos de mensagem

A lista de mensagens que o servidor fornece está formatada para a **comunicação do MCP**. As
mensagens individuais **não têm garantia de compatibilidade** com o SDK de LLM que se esteja usando.

Com o SDK da Anthropic, por exemplo, é preciso escrever um pouco de lógica de conversão para
transformar as mensagens do MCP em um formato compatível.

### 4. Devolvendo o texto gerado

Depois de gerar o texto com o LLM, devolve-se um `CreateMessageResult`, que contém o texto gerado.

### 5. Conectando o *callback*

Não esquecer: o *callback* do cliente precisa ser passado para a chamada de `ClientSession`.

```python
import asyncio
from anthropic import AsyncAnthropic
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.session import RequestContext
from mcp.types import (
    CreateMessageRequestParams,
    CreateMessageResult,
    TextContent,
    SamplingMessage,
)

anthropic_client = AsyncAnthropic()
model = "claude-sonnet-4-5"

server_params = StdioServerParameters(
    command="uv",
    args=["run", "server.py"],
)


async def chat(input_messages: list[SamplingMessage], max_tokens=4000):
    messages = []
    for msg in input_messages:
        if msg.role == "user" and msg.content.type == "text":
            content = (
                msg.content.text
                if hasattr(msg.content, "text")
                else str(msg.content)
            )
            messages.append({"role": "user", "content": content})
        elif msg.role == "assistant" and msg.content.type == "text":
            content = (
                msg.content.text
                if hasattr(msg.content, "text")
                else str(msg.content)
            )
            messages.append({"role": "assistant", "content": content})

    response = await anthropic_client.messages.create(
        model=model,
        messages=messages,
        max_tokens=max_tokens,
    )
    text = "".join([p.text for p in response.content if p.type == "text"])
    return text


async def sampling_callback(
    context: RequestContext, params: CreateMessageRequestParams
):
    # Chama Claude usando o SDK da Anthropic
    text = await chat(params.messages)
    return CreateMessageResult(
        role="assistant",
        model=model,
        content=TextContent(type="text", text=text),
    )


async def run():
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(
            read, write, sampling_callback=sampling_callback
        ) as session:
            await session.initialize()
            result = await session.call_tool(
                name="summarize",
                arguments={"text_to_summarize": "lots of text"},
            )
            print(result.content)


if __name__ == "__main__":
    asyncio.run(run())
```

### 6. Recebendo o resultado

Depois que o cliente gerou e devolveu o texto, ele chega ao servidor. Dali em diante, o servidor pode
fazer qualquer coisa com esse texto:

- usá-lo como parte de um fluxo de trabalho dentro da ferramenta;
- decidir fazer outra chamada de amostragem;
- retornar o texto gerado.

---

## Lição 3 — Notificações de registro e progresso

Registro (*logging*) e notificações de progresso são simples de implementar, mas fazem grande
diferença na experiência de uso de um servidor MCP. Ajudam o usuário a entender o que está
acontecendo durante operações longas, em vez de ficar se perguntando se algo quebrou.

Quando Claude chama uma ferramenta demorada — pesquisar um tópico, processar dados —, normalmente
não se vê nada até a operação terminar. Com registro e progresso habilitados, o usuário recebe
retorno em tempo real: barras de progresso, mensagens de status e logs detalhados.

### Como funciona

No SDK Python do MCP, registro e progresso funcionam pelo argumento `Context`, fornecido
automaticamente às funções de ferramenta. Esse objeto oferece métodos de comunicação com o cliente
**durante** a execução.

```python
@mcp.tool(
    name="research",
    description="Research a given topic",
)
async def research(
    topic: str = Field(description="Topic to research"),
    *,
    context: Context,
):
    await context.info("About to do research...")
    await context.report_progress(20, 100)
    sources = await do_research(topic)

    await context.info("Writing report...")
    await context.report_progress(70, 100)
    results = await generate_report(sources)

    return results
```

Os métodos principais:

- `context.info()` — envia mensagens de log ao cliente.
- `context.report_progress()` — atualiza o progresso com valor atual e total.

### Implementação do lado do cliente

O servidor **emite** as mensagens; cabe ao cliente decidir como apresentá-las.

```python
async def logging_callback(params: LoggingMessageNotificationParams):
    print(params.data)


async def print_progress_callback(
    progress: float, total: float | None, message: str | None
):
    if total is not None:
        percentage = (progress / total) * 100
        print(f"Progress: {progress}/{total} ({percentage:.1f}%)")
    else:
        print(f"Progress: {progress}")


async def run():
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(
            read,
            write,
            logging_callback=logging_callback,
        ) as session:
            await session.initialize()

            await session.call_tool(
                name="add",
                arguments={"a": 1, "b": 3},
                progress_callback=print_progress_callback,
            )
```

O *callback* de registro é fornecido **ao criar a sessão**; o de progresso, **em cada chamada de
ferramenta**. Isso dá flexibilidade para tratar cada tipo de notificação de forma diferente.

### Opções de apresentação

- **Aplicações CLI** — imprimir mensagens e progresso no terminal.
- **Aplicações web** — WebSockets, *server-sent events* ou *polling* para levar as atualizações ao navegador.
- **Aplicações desktop** — atualizar barras de progresso e indicadores de status na interface.

Implementar essas notificações é **totalmente opcional**. Pode-se ignorá-las, mostrar apenas alguns
tipos, ou apresentá-las como fizer sentido. São puramente melhorias de experiência.

> **→ Ponte para o Yu-book.** Vale para dois lugares. No **MCP: escrita** (Fase 2 do roteiro),
> mover um card é rápido e não precisa disso; já um fluxo do tipo "criar oito cards a partir das
> issues" ganha muito com progresso. E, mais adiante, no **backfill de embeddings** (RF-30 do PRD),
> que exige "progresso visível e retomada após interrupção" — é literalmente esta lição, só que
> pela via HTTP/streaming do navegador, e não pela via MCP.

---

## Lição 4 — Passo a passo de notificações

### 1. A função de ferramenta recebe o argumento `Context`

As funções de ferramenta recebem `Context` automaticamente como último argumento. Esse objeto tem os
métodos de registro e de progresso.

### 2. Crie logs e progresso com o contexto

Ao longo da função, chame `info()`, `warning()`, `debug()` ou `error()` para registrar mensagens de
tipos diferentes no cliente. Chame `report_progress()` para estimar quanto trabalho falta.

```python
from mcp.server.fastmcp import FastMCP, Context
import asyncio

mcp = FastMCP(name="Demo Server")


@mcp.tool()
async def add(a: int, b: int, ctx: Context) -> int:
    await ctx.info("Preparing to add...")
    await ctx.report_progress(20, 100)
    await asyncio.sleep(2)
    await ctx.info("OK, adding...")
    await ctx.report_progress(80, 100)
    return a + b


if __name__ == "__main__":
    mcp.run(transport="stdio")
```

### 3. Defina os *callbacks* no cliente

O cliente precisa definir os *callbacks* de registro e de progresso, que serão chamados
automaticamente sempre que o servidor emitir mensagens. Esses *callbacks* devem tentar exibir os
dados ao usuário.

### 4. Passe os *callbacks* para as funções corretas

O *callback* de registro vai para `ClientSession`; o de progresso, para `call_tool()`.

```python
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.types import LoggingMessageNotificationParams

server_params = StdioServerParameters(
    command="uv",
    args=["run", "server.py"],
)


async def logging_callback(params: LoggingMessageNotificationParams):
    print(params.data)


async def print_progress_callback(
    progress: float, total: float | None, message: str | None
):
    if total is not None:
        percentage = (progress / total) * 100
        print(f"Progress: {progress}/{total} ({percentage:.1f}%)")
    else:
        print(f"Progress: {progress}")


async def run():
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(
            read, write, logging_callback=logging_callback
        ) as session:
            await session.initialize()
            await session.call_tool(
                name="add",
                arguments={"a": 1, "b": 3},
                progress_callback=print_progress_callback,
            )


if __name__ == "__main__":
    import asyncio

    asyncio.run(run())
```

---

## Lição 5 — Raízes (*roots*)

Raízes são a forma de conceder a servidores MCP acesso a **arquivos e pastas específicos da máquina
local**. Funcionam como um sistema de permissão — "servidor MCP, você pode acessar estes arquivos" —
mas fazem mais do que só conceder permissão.

### O problema que as raízes resolvem

Imagine um servidor MCP com uma ferramenta de conversão de vídeo, que recebe o caminho de um arquivo
e converte de MP4 para MOV.

> *Diagrama "se as raízes não existissem": um servidor MCP expõe `convert_video`, que converte um
> `.mp4` em `.mov` e exige um caminho de arquivo na máquina local.*

Quando o usuário pede "converta `biking.mp4` para o formato mov", Claude chama a ferramenta apenas
com o **nome** do arquivo. O problema: Claude não tem como varrer o sistema de arquivos inteiro para
descobrir onde esse arquivo está.

> *Um chat onde o usuário diz "converter biking.mp4 para mov", ao lado de uma árvore de diretórios
> com Filmes, Documentos e Fotos; `biking.mp4` está lá no fundo de `Filmes/Esportes`, um local que
> Claude não enxerga.*

Dá para resolver exigindo que o usuário sempre informe o caminho completo, mas isso não é amigável.
Ninguém quer digitar caminho absoluto toda vez.

### Raízes em ação

Com raízes, o fluxo muda:

1. O usuário pede para converter um arquivo de vídeo.
2. Claude chama `list_roots` para ver quais diretórios pode acessar.
3. Claude usa `read_dir` nesses diretórios para encontrar o arquivo.
4. Encontrado o arquivo, Claude chama a ferramenta de conversão com o caminho completo.

Isso acontece automaticamente — o usuário continua podendo dizer só "converta biking.mp4".

### Segurança e fronteiras

Raízes também **limitam** o acesso. Concedendo acesso apenas à pasta Desktop, o servidor MCP não
alcança Documentos nem Downloads. Ao tentar acessar arquivo fora das raízes aprovadas, Claude recebe
um erro e pode avisar o usuário de que o arquivo não está acessível na configuração atual.

### Detalhes de implementação

**O SDK do MCP não impõe restrição de raiz automaticamente.** É preciso implementar a checagem. O
padrão típico é uma função auxiliar `is_path_allowed()` que:

1. recebe o caminho solicitado;
2. obtém a lista de raízes aprovadas;
3. verifica se o caminho está dentro de alguma delas;
4. retorna verdadeiro/falso.

Depois, chama-se essa função em **toda** ferramenta que acessa arquivo ou diretório, antes da
operação de verdade.

### Principais benefícios

- **Usabilidade** — o usuário não precisa fornecer caminhos completos.
- **Busca focada** — Claude só procura em diretórios aprovados, o que torna a descoberta mais rápida.
- **Segurança** — impede acesso acidental a arquivos sensíveis fora das áreas aprovadas.
- **Flexibilidade** — as raízes podem ser oferecidas por ferramentas ou injetadas direto no prompt.

> **→ Ponte para o Yu-book.** O `apps/mcp` **não toca em disco** — ele é cliente HTTP da própria
> API —, então raízes não têm uso hoje. Onde essa lição vale é na **mesa de trabalho** do roteiro:
> ela precisa de "uma cópia de trabalho em disco de cada repositório", com "vários contextos e
> credenciais" e risco de "publicar no repositório errado". Raízes são exatamente o modelo de
> permissão desse cenário. Guardar para lá.

---

## Lição 6 — Passo a passo de raízes

### 1. Definindo as raízes

O ideal é que **o usuário** dite quais arquivos/pastas o servidor MCP pode acessar. Este programa
aceita uma lista de argumentos de linha de comando, interpretados como os caminhos que o usuário
quer liberar. Essa lista é entregue ao `MCPClient`.

```python
import asyncio
import sys
import os
from dotenv import load_dotenv
from contextlib import AsyncExitStack
from mcp_client import MCPClient
from core.claude import Claude
from core.cli_chat import CliChat
from core.cli import CliApp

load_dotenv()

# Configuração da Anthropic
claude_model = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-5")
anthropic_api_key = os.getenv("ANTHROPIC_API_KEY", "")

assert claude_model, "Error: CLAUDE_MODEL cannot be empty. Update .env"
assert anthropic_api_key, (
    "Error: ANTHROPIC_API_KEY cannot be empty. Update .env"
)


async def main():
    claude_service = Claude(model=claude_model)

    # Diretórios raiz vindos dos argumentos de linha de comando
    root_paths = sys.argv[1:]
    if not root_paths:
        print("Usage: uv run main.py <root1> [root2] ...")
        print("Example: uv run main.py /path/to/videos /another/path")
        sys.exit(1)

    clients = {}
    async with AsyncExitStack() as stack:
        # Cria o cliente MCP com os diretórios raiz fornecidos
        doc_client = await stack.enter_async_context(
            MCPClient(
                command="uv", args=["run", "mcp_server.py"], roots=root_paths
            )
        )
        clients["doc_client"] = doc_client

        chat = CliChat(
            doc_client=doc_client,
            clients=clients,
            claude_service=claude_service,
        )
        cli = CliApp(chat)
        await cli.initialize()
        await cli.run()


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    asyncio.run(main())
```

### 2. Criando objetos raiz

Pela especificação do MCP, toda raiz precisa de um URI começando com `file://`. Esta função pega a
lista de caminhos do usuário e a transforma em objetos `Root`.

### 3. *Callback* de raízes

O cliente **não** entrega a lista de raízes ao servidor de imediato. Em vez disso, o servidor pode
solicitá-la em algum momento futuro. Cria-se um *callback* que roda quando o servidor pede as
raízes, e ele precisa devolvê-las dentro de um `ListRootsResult`. Esse *callback* é passado para o
`ClientSession`.

```python
from typing import Optional, Any
from contextlib import AsyncExitStack
from mcp import ClientSession, StdioServerParameters, types
from mcp.client.stdio import stdio_client
from mcp.types import Root, ListRootsResult, ErrorData
from mcp.shared.context import RequestContext
from pathlib import Path
from pydantic import FileUrl, AnyUrl
import json


class MCPClient:
    def __init__(
        self,
        command: str,
        args: list[str],
        env: Optional[dict] = None,
        roots: Optional[list[str]] = None,
    ):
        self._command = command
        self._args = args
        self._env = env
        self._roots = self._create_roots(roots) if roots else []
        self._session: Optional[ClientSession] = None
        self._exit_stack: AsyncExitStack = AsyncExitStack()

    def _create_roots(self, root_paths: list[str]) -> list[Root]:
        """Converte caminhos em texto para objetos Root."""
        roots = []
        for path in root_paths:
            p = Path(path).resolve()
            file_url = FileUrl(f"file://{p}")
            roots.append(Root(uri=file_url, name=p.name or "Root"))
        return roots

    async def _handle_list_roots(
        self, context: RequestContext["ClientSession", None]
    ) -> ListRootsResult | ErrorData:
        """Callback para quando o servidor pede as raízes."""
        return ListRootsResult(roots=self._roots)

    async def connect(self):
        server_params = StdioServerParameters(
            command=self._command,
            args=self._args,
            env=self._env,
        )
        stdio_transport = await self._exit_stack.enter_async_context(
            stdio_client(server_params)
        )
        _stdio, _write = stdio_transport
        self._session = await self._exit_stack.enter_async_context(
            ClientSession(
                _stdio,
                _write,
                list_roots_callback=self._handle_list_roots
                if self._roots
                else None,
            )
        )
        await self._session.initialize()

    def session(self) -> ClientSession:
        if self._session is None:
            raise ConnectionError(
                "Client session not initialized or cache not populated. "
                "Call connect_to_server first."
            )
        return self._session

    async def list_tools(self) -> list[types.Tool]:
        result = await self.session().list_tools()
        return result.tools

    async def call_tool(
        self, tool_name: str, tool_input
    ) -> types.CallToolResult | None:
        return await self.session().call_tool(tool_name, tool_input)

    async def list_prompts(self) -> list[types.Prompt]:
        result = await self.session().list_prompts()
        return result.prompts

    async def get_prompt(self, prompt_name, args: dict[str, str]):
        result = await self.session().get_prompt(prompt_name, args)
        return result.messages

    async def read_resource(self, uri: str) -> Any:
        result = await self.session().read_resource(AnyUrl(uri))
        resource = result.contents[0]
        if isinstance(resource, types.TextResourceContents):
            if resource.mimeType == "application/json":
                return json.loads(resource.text)
            return resource.text

    async def cleanup(self):
        await self._exit_stack.aclose()
        self._session = None

    async def __aenter__(self):
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.cleanup()
```

### 4. Usando as raízes

Do lado do servidor, as raízes servem em dois cenários:

1. sempre que uma ferramenta tenta acessar um arquivo ou pasta;
2. quando o LLM precisa **resolver** um arquivo ou pasta para um caminho completo — o usuário diz
   "leia o arquivo `todos.txt`" e o modelo descobre onde ele está olhando a lista de raízes.

Para o segundo caso, define-se uma ferramenta que lista as raízes, ou injetam-se as raízes
diretamente em um prompt.

### 5. Acessando as raízes

As raízes são acessadas chamando `ctx.session.list_roots()`. Isso envia uma mensagem de volta ao
cliente, que executa o *callback* de listagem de raízes.

### 6 e 7. Autorizando o acesso

**Lembre-se: o SDK do MCP não tenta limitar quais arquivos ou pastas suas ferramentas leem.** Essa
checagem é sua. Monte uma função como `is_path_allowed`, que decide se um caminho é acessível
comparando-o com a lista de raízes — e depois **use-a em todas as ferramentas**.

```python
from pathlib import Path
from mcp.server.fastmcp import FastMCP, Context
from pydantic import Field
from core.video_converter import VideoConverter
from core.utils import file_url_to_path

mcp = FastMCP("VidsMCP", log_level="ERROR")


async def is_path_allowed(requested_path: Path, ctx: Context) -> bool:
    roots_result = await ctx.session.list_roots()
    client_roots = roots_result.roots

    if not requested_path.exists():
        return False
    if requested_path.is_file():
        requested_path = requested_path.parent

    for root in client_roots:
        root_path = file_url_to_path(root.uri)
        try:
            requested_path.relative_to(root_path)
            return True
        except ValueError:
            continue
    return False


@mcp.tool()
async def convert_video(
    input_path: str = Field(description="Path to the input MP4 file"),
    format: str = Field(description="Output format (e.g. 'mov')"),
    *,
    ctx: Context,
):
    """Convert an MP4 video file to another format using ffmpeg"""
    input_file = VideoConverter.validate_input(input_path)

    # Garante que o arquivo de entrada está contido em uma raiz
    if not await is_path_allowed(input_file, ctx):
        raise ValueError(f"Access to path is not allowed: {input_path}")

    return await VideoConverter.convert(input_path, format)


@mcp.tool()
async def list_roots(ctx: Context):
    """
    List all directories that are accessible to this server.
    These are the root directories where files can be read from or written to.
    """
    roots_result = await ctx.session.list_roots()
    client_roots = roots_result.roots
    return [file_url_to_path(root.uri) for root in client_roots]


@mcp.tool()
async def read_dir(
    path: str = Field(description="Path to a directory to read"),
    *,
    ctx: Context,
):
    """Read directory contents. Path must be within one of the client's roots."""
    requested_path = Path(path).resolve()
    if not await is_path_allowed(requested_path, ctx):
        raise ValueError("Error: can only read directories within a root")
    return [entry.name for entry in requested_path.iterdir()]


if __name__ == "__main__":
    mcp.run(transport="stdio")
```

---

# Parte II — Transportes e comunicações

*Não iniciada. Lições 7 a 11.*

- [ ] **Lição 7** — Tipos de mensagens JSON
- [ ] **Lição 8** — O transporte STDIO
- [ ] **Lição 9** — O transporte StreamableHTTP
- [ ] **Lição 10** — HTTP transmissível em profundidade
- [ ] **Lição 11** — Estado e o transporte StreamableHTTP

> **→ Ponte para o Yu-book.** Esta é a parte que o roteiro chama de **"o degrau que muda tudo"**
> (Fase 3 — MCP: transporte e identidade). Hoje o `apps/mcp` roda em stdio, um processo por usuário,
> com `YUBOOK_EMAIL` e `YUBOOK_PASSWORD` no `.env`. Com HTTP, um servidor atende muitos clientes e
> **o servidor deixa de saber quem está perguntando**. O comentário em
> [`apps/mcp/src/cliente.ts:60-61`](../../apps/mcp/src/cliente.ts#L60-L61) já antecipa isso:
> *"Quando o transporte virar HTTP e a autenticação sair do `.env` (Advanced Topics), isto é o
> primeiro a mudar."* Anotar, ao longo destas cinco lições, tudo que responda: **de onde vem a
> identidade quando ela não vem mais do ambiente do processo?**

---

# Lição 7: Tipos de mensagens JSON

MCP (Model Context Protocol) usa mensagens JSON para lidar com a comunicação entre clientes e servidores. Entender esses tipos de mensagens é crucial para trabalhar com o MCP, especialmente ao lidar com diferentes métodos de transporte, como o transporte HTTP transmitível.

Formato da mensagem
Toda a comunicação MCP acontece através de mensagens JSON. Cada tipo de mensagem tem uma finalidade específica: chamar uma ferramenta, listar recursos disponíveis ou enviar notificações sobre eventos do sistema.



Aqui está um exemplo típico: quando Claude precisa chamar uma ferramenta fornecida por um servidor MCP, o cliente envia uma mensagem "Call Tool Request". O servidor processa essa solicitação, executa a ferramenta e responde com uma mensagem "Resultado da ferramenta de chamada" contendo a saída.



Especificação MCP
A lista completa de tipos de mensagens é definida no repositório oficial de especificações do MCP no GitHub. Esta especificação é separada dos vários repositórios de SDK (como Python ou TypeScript SDKs) e serve como fonte confiável de como o MCP deve funcionar.

Os tipos de mensagens são escritos em TypeScript por conveniência - não porque sejam executados como código TypeScript, mas porque o TypeScript fornece uma maneira clara de descrever estruturas e tipos de dados.

Categorias de mensagens
As mensagens MCP se dividem em duas categorias principais:



Mensagens de solicitação-resultado
Essas mensagens sempre vêm em pares. Você envia uma solicitação e espera receber um resultado:

Solicitação de ferramenta de chamada → Resultado da ferramenta de chamada
Solicitação de prompts de lista → Resultado de prompts de lista
Ler solicitação de recurso → Ler resultado do recurso
Inicializar solicitação → Inicializar resultado
Mensagens de notificação
Estas são mensagens unidirecionais que informam sobre eventos, mas não exigem resposta:

Notificação de progresso - Atualizações sobre operações de longa duração
Notificação de mensagem de registro - Mensagens de registro do sistema
Notificação de alteração da lista de ferramentas - Quando as ferramentas disponíveis mudam
Notificação de recurso atualizado - Quando os recursos são modificados
Mensagens do cliente vs servidor
A especificação MCP organiza as mensagens por quem as envia:

As mensagens do cliente incluem solicitações que os clientes enviam aos servidores (como chamadas de ferramentas) e notificações que os clientes podem enviar.

As mensagens do servidor incluem solicitações que os servidores enviam aos clientes e notificações que os servidores transmitem.

Por que isso importa
Entender que os servidores podem enviar mensagens aos clientes é particularmente importante ao trabalhar com diferentes métodos de transporte. Alguns transportes, como o transporte HTTP transmitível, têm limitações sobre quais tipos de mensagens podem fluir em quais direções.

O principal insight é que o MCP foi projetado como um protocolo bidirecional: tanto clientes quanto servidores podem iniciar a comunicação. Isso se torna crucial quando você precisa escolher o método de transporte certo para seu caso de uso específico.

--- Notas pessoais, finalmente entendi ---

Exemplo para sanar de vez duvida de ciclo de comunicação:
Fluxo de trabalho:
Solicitei no prompt do meu agente Claude Code as notas de julho e que agrupe com base nos conteúdos;

Perfeito. Você manda a instrução humana no terminal.

O modelo Claude (na nuvem) lê o prompt, entende o que você quer e percebe que precisa de dados externos.

Aqui entra o detalhe: Não é o "Client MCP" que decide ou verifica como fazer o trabalho. Quem decide chamar a ferramenta é o modelo Claude (nuvem) com base nas descrições (tools) que o cliente MCP apresentou a ele no início da sessão.
2.1. O modelo decide invocar a ferramenta (ex: get_notes) passando o filtro de data correspondente a julho.

O Claude Code (que hospeda o cliente MCP) envia a mensagem tools/call via stdin/stdout para o apps/mcp (o Servidor MCP na sua máquina).

Lembrete das suas notas: O apps/mcp não tem IA, não fala com o modelo e não sabe qual modelo está do outro lado. Ele apenas recebe o comando JSON-RPC.
3.1. O apps/mcp executa a lógica: ele faz um fetch na sua API em produção (apps/api), que por sua vez busca os dados no Postgres. O apps/mcp empacota a resposta em texto e devolve para o cliente MCP.

Com o texto das notas de julho em mãos, o modelo Claude (na nuvem) processa o conteúdo, faz o agrupamento temático que você pediu e exibe formatado para você no terminal.

Quando e como as informações (tools) são carregadas?
Diferente de algumas skills dinâmicas que só são injetadas no prompt quando uma palavra-chave específica aciona um gatilho (trigger), as definições das ferramentas MCP são carregadas logo no handshake inicial da sessão.O fluxo de carga acontece assim:Abertura da Sessão (O Handshake): Quando você abre o Claude Code no terminal (/home/yuri/Documentos/Yu-book), ele lê o arquivo de configuração (onde os servidores MCP estão declarados).Subprocesso Iniciado: O Claude Code dispara o apps/mcp (node dist/index.js) em segundo plano via stdin/stdout.  Descoberta de Capacidades (tools/list): Antes de você digitar qualquer comando ou prompt, o cliente MCP (que está na memória do Claude Code) pergunta ao servidor MCP: "O que você sabe fazer?" O servidor responde com uma lista estruturada de todas as ferramentas disponíveis (como o get_notes), incluindo o nome de cada uma, o que ela faz e quais são os parâmetros esperados.Injeção no Contexto do Modelo: O Claude Code pega essa lista que veio do servidor local e injeta o catálogo de ferramentas no system prompt enviado para o modelo Claude na nuvem.

--

# Lição 8 O transporte STDIO

Os clientes e servidores MCP se comunicam trocando mensagens JSON, mas como essas mensagens são realmente transmitidas? O canal de comunicação utilizado é chamado de transporte, e existem várias maneiras de implementar isso - desde solicitações HTTP a WebSockets até mesmo escrever JSON em um cartão postal (embora este último não seja recomendado para uso em produção).

O Transporte Stdio
Quando você desenvolve um servidor ou cliente MCP pela primeira vez, o transporte mais comumente usado é o transporte stdio. Essa abordagem é simples: o cliente inicia o servidor MCP como um subprocesso e se comunica por meio de fluxos de entrada e saída padrão.

Diagrama do transporte stdio: um cliente MCP envia mensagens para um servidor MCP através do stdin do servidor, e o servidor envia mensagens de volta através do stdout; qualquer um dos lados pode enviar uma mensagem a qualquer momento e só funciona quando ambos são executados na mesma máquina

Veja como funciona:

O cliente envia mensagens ao servidor usando o servidor stdin
O servidor responde escrevendo para stdout
Tanto o servidor quanto o cliente podem enviar uma mensagem a qualquer momento
Funciona apenas quando o cliente e o servidor são executados na mesma máquina
Vendo Stdio em ação
Na verdade, você pode testar um servidor MCP diretamente do seu terminal sem gravar um cliente separado. Quando você executa um servidor comuv run server.py , ele escuta stdin e grava respostas em stdout. Isso significa que você pode colar mensagens JSON diretamente no seu terminal e ver as respostas do servidor imediatamente.

A saída do terminal mostra a troca completa de mensagens, incluindo exemplos de mensagens para inicialização e chamadas de ferramentas.

Sequência de conexão MCP
Cada conexão MCP deve começar com um handshake específico de três mensagens:

Diagrama de sequência do handshake MCP: o cliente envia uma solicitação de inicialização ao servidor, o servidor responde com um resultado de inicialização e, em seguida, o cliente envia uma notificação inicializada para a qual nenhum resultado retorna

Inicializar solicitação - O cliente envia isso primeiro
Inicializar resultado - O servidor responde com recursos
Notificação inicializada - Cliente confirma (nenhuma resposta esperada)
Somente após esse handshake você pode enviar outras solicitações, como chamadas de ferramentas ou listagens de prompts.

Tipos de mensagens e fluxo
O MCP suporta vários tipos de mensagens que fluem em ambas as direções:

Gráfico de tipos de mensagens MCP entre cliente e servidor: pares de solicitação/resultado iniciados pelo cliente, como Call Tool Request → Call Tool Result, pares iniciados pelo servidor, como Create Message Request e List Roots Request, além de notificações unidirecionais de cada lado que não exigem uma resposta

O principal insight é que algumas mensagens exigem respostas (solicitações → resultados), enquanto outras não (notificações). Tanto o cliente quanto o servidor podem iniciar a comunicação a qualquer momento.

Quatro Cenários de Comunicação
Com qualquer transporte, você precisa lidar com quatro padrões de comunicação diferentes:

Diagrama intitulado "Como podemos implementar cada um deles com stdio?" listando quatro padrões - solicitação inicial de cliente para servidor, resposta de servidor para cliente, solicitação inicial de servidor para cliente e resposta de cliente para servidor - ao lado de um cliente MCP conectado ao stdin e stdout de um servidor MCP

Solicitação do cliente → servidor: O cliente grava no stdin
Servidor → Resposta do cliente: O servidor grava no stdout
Servidor → Solicitação do cliente: O servidor grava no stdout
Resposta do cliente → servidor: O cliente grava no stdin
A beleza do transporte stdio é a sua simplicidade - qualquer uma das partes pode iniciar a comunicação a qualquer momento usando esses dois canais.

Por que isso importa
Entender o transporte stdio é crucial porque ele representa o caso "ideal" em que a comunicação bidirecional é perfeita. Quando migrarmos para outros transportes, como HTTP, encontraremos limitações em que o servidor nem sempre pode iniciar solicitações ao cliente. O transporte stdio serve como base para entender como é a comunicação completa do MCP antes de enfrentarmos as restrições de outros métodos de transporte.

Para desenvolvimento e testes, o transporte stdio é perfeito. Para implantações de produção em que o cliente e o servidor precisam ser executados em máquinas diferentes, você precisará considerar outras opções de transporte com suas próprias compensações.

---

# Lição 9: O transporte StreamableHTTP

O transporte HTTP transmitível permite que os clientes MCP se conectem a servidores hospedados remotamente por meio de conexões HTTP. Ao contrário do transporte de E/S padrão que requer cliente e servidor na mesma máquina, esse transporte abre possibilidades para servidores MCP públicos que qualquer pessoa pode acessar.



No entanto, há uma ressalva importante: algumas configurações podem limitar significativamente a funcionalidade do seu servidor MCP. Se seu aplicativo funciona perfeitamente com transporte de E/S padrão localmente, mas quebra quando implantado com transporte HTTP, esse provavelmente é o culpado.



Configurações que importam
Duas configurações principais controlam como o transporte HTTP transmitível se comporta:

stateless_http- Controla o gerenciamento do estado da conexão
json_response- Controla o tratamento do formato de resposta
Por padrão, ambas as configurações são , masfalse certos cenários de implantação podem forçá-lo a defini-las comotrue . Quando habilitadas, essas configurações podem quebrar funcionalidades essenciais, como notificações de progresso, registro e solicitações iniciadas pelo servidor.

O desafio da comunicação HTTP
Para entender por que essas limitações existem, precisamos revisar como funciona a comunicação HTTP. Em HTTP padrão:



Os clientes podem facilmente iniciar solicitações aos servidores (o servidor possui um URL conhecido)
Os servidores podem responder facilmente a essas solicitações
Os servidores não podem iniciar facilmente solicitações aos clientes (os clientes não possuem URLs conhecidos)
Os padrões de resposta do cliente de volta ao servidor tornam-se problemáticos


Tipos de mensagens MCP afetados
Essa limitação de HTTP afeta padrões específicos de comunicação do MCP. Os seguintes tipos de mensagens tornam-se difíceis de implementar com HTTP simples:

Solicitações iniciadas pelo servidor: criar solicitações de mensagem, listar solicitações de raiz
Notificações: Notificações de progresso, Notificações de registro, Notificações inicializadas, Notificações canceladas
Esses são exatamente os recursos que quebram quando você habilita as configurações HTTP restritivas. As barras de progresso desaparecem, o registro para de funcionar e as solicitações de amostragem iniciadas pelo servidor falham.

A solução HTTP transmitível
O transporte HTTP transmitível fornece uma solução inteligente para contornar as limitações do HTTP, mas vem com compensações. Quando você é forçado a usar or , você está essencialmente dizendo ao transporte para operar dentro das restrições do HTTP, em vez de contornar elas.stateless_http=Truejson_response=True



Compreender essas limitações ajuda você a tomar decisões informadas sobre:

Qual transporte usar para diferentes cenários de implantação
Como projetar seu servidor MCP para lidar graciosamente com restrições HTTP
Quando aceitar funcionalidade reduzida para os benefícios da hospedagem remota
O segredo é saber que essas restrições existem e planejar a arquitetura do seu servidor MCP adequadamente. Se o seu aplicativo depende muito de solicitações iniciadas pelo servidor ou notificações em tempo real, talvez seja necessário reconsiderar sua escolha de transporte ou implementar padrões de comunicação alternativos.

---

# Aula 10: HTTP transmitível em profundidade
StreamableHTTP é a solução do MCP para um problema fundamental: algumas funcionalidades do MCP exigem que o servidor faça solicitações ao cliente, mas o HTTP torna isso desafiador. Vamos explorar como o StreamableHTTP funciona em torno dessa limitação e quando você pode precisar quebrar essa solução alternativa.

O problema central
Alguns recursos do MCP, como amostragem, notificações e registro, dependem do servidor iniciar solicitações ao cliente. No entanto, o HTTP foi projetado para que os clientes façam solicitações aos servidores, e não o contrário. O StreamableHTTP resolve isso com uma solução alternativa inteligente usando Eventos Enviados pelo Servidor (SSE).

Como funciona o StreamableHTTP
A mágica acontece por meio de um processo de várias etapas que estabelece conexões persistentes entre cliente e servidor.



Configuração inicial da conexão
O processo começa como qualquer conexão MCP:

O cliente envia umInitialize Request para o servidor
O servidor responde com umInitialize Result que inclui um cabeçalho especialmcp-session-id
O cliente envia umInitialized Notification com o ID da sessão
Este ID de sessão é crucial: ele identifica exclusivamente o cliente e deve ser incluído em todas as solicitações futuras.

A solução alternativa para SSE
Após a inicialização, o cliente pode fazer uma solicitação GET para estabelecer uma conexão Servidor-Eventos Enviados. Isso cria uma resposta HTTP de longa duração que o servidor pode usar para transmitir mensagens de volta ao cliente a qualquer momento.



Esta conexão SSE é a chave para permitir a comunicação servidor-cliente. O servidor agora pode enviar solicitações, notificações e outras mensagens através deste canal persistente.

Chamadas de ferramentas e conexões SSE duplas
Quando o cliente faz uma chamada de ferramenta, as coisas ficam mais complexas. O sistema cria duas conexões SSE separadas:



Conexão SSE primária: usada para solicitações iniciadas pelo servidor e permanece aberta indefinidamente
Conexão SSE específica da ferramenta: criada para cada chamada de ferramenta e fecha automaticamente quando o resultado da ferramenta é enviado
Roteamento de mensagens
Diferentes tipos de mensagens são roteadas através de diferentes conexões:

Notificações de progresso: Enviadas através da conexão SSE primária
Mensagens de registro e resultados da ferramenta: Enviados através da conexão SSE específica da ferramenta


Sinalizadores de configuração que quebram a solução alternativa
StreamableHTTP inclui duas opções de configuração importantes:

stateless_http
json_response
Defini-losTrue pode quebrar o mecanismo de solução alternativa do SSE. Talvez você queira habilitar esses sinalizadores em determinados cenários, mas isso limita toda a funcionalidade do MCP que depende da comunicação entre servidor e cliente.

Principais conclusões
O StreamableHTTP é mais complexo do que outros transportes MCP porque precisa contornar as limitações do HTTP. A solução alternativa baseada em SSE permite funcionalidade MCP completa via HTTP, mas entender o modelo de conexão dupla é crucial para depuração e otimização.

Ao criar aplicativos MCP com StreamableHTTP, lembre-se de que IDs de sessão são necessários para todas as solicitações após a inicialização, e o sistema gerencia automaticamente várias conexões SSE para lidar com diferentes tipos de comunicação entre servidor e cliente.

---

## Aula 11: Estado e o transporte StreamableHTTP
Os sinalizadores and nos servidores MCP controlam aspectos fundamentais de como seu servidor se comporta. Entender quando e por que usá-los é crucial, especialmente se você estiver planejando dimensionar seu servidor ou implantá-lo em produção.stateless_httpjson_response

Quando você precisa de HTTP sem estado
Imagine que você constrói um servidor MCP que se torna popular. Inicialmente, você pode ter apenas alguns clientes se conectando a uma única instância de servidor:



À medida que seu servidor cresce, você pode ter milhares de clientes tentando se conectar. Executar uma única instância de servidor não será dimensionado para lidar com todo esse tráfego:



A solução típica é o dimensionamento horizontal - executando várias instâncias de servidor atrás de um balanceador de carga:



Mas é aqui que as coisas ficam complicadas. Lembre-se de que os clientes MCP precisam de duas conexões separadas:

Uma conexão GET SSE para receber solicitações de servidor para cliente
Solicitações POST para chamar ferramentas e receber respostas


Com um balanceador de carga, essas solicitações podem ser roteadas para diferentes instâncias do servidor. Se sua ferramenta precisar usar Claude (por meio de amostragem), o servidor que manipula a solicitação POST precisará coordenar com o servidor que manipula a conexão GET SSE. Isso cria um problema complexo de coordenação entre servidores.



Como o HTTP sem estado resolve isso
A configuraçãostateless_http=True elimina esse problema de coordenação, mas com compensações significativas:



Quando o HTTP sem estado está habilitado:

Os clientes não obtêm IDs de sessão - o servidor não consegue rastrear clientes individuais
Nenhuma solicitação de servidor para cliente - o caminho GET SSE fica indisponível
Sem amostragem - não é possível usar Claude ou outros modelos de IA
Nenhum relatório de progresso - não é possível enviar atualizações de progresso durante operações longas
Sem assinaturas - não é possível notificar os clientes sobre atualizações de recursos
No entanto, há um benefício: a inicialização do cliente não é mais necessária. Os clientes podem fazer solicitações diretamente, sem o processo inicial de handshake.



Compreendendo a resposta JSON
O sinjson_response=Truealizador é mais simples: ele apenas desabilita o streaming para respostas de solicitações POST. Em vez de obter várias mensagens SSE à medida que uma ferramenta é executada, você obtém apenas o resultado final como JSON simples.

Com streaming desativado:

Nenhuma mensagem de progresso intermediário
Nenhuma instrução de log durante a execução
Apenas o resultado final da ferramenta
Quando usar essas bandeiras
Use HTTP sem estado quando:

Você precisa de escala horizontal com balanceadores de carga
Você não precisa de comunicação entre servidor e cliente
Suas ferramentas não exigem amostragem de modelos de IA
Você deseja minimizar a sobrecarga de conexão
Use a resposta JSON quando:

Você não precisa de respostas de streaming
Você prefere respostas HTTP mais simples e sem streaming
Você está se integrando com sistemas que esperam JSON simples
Desenvolvimento vs Produção
Se você estiver desenvolvendo localmente com transporte de E/S padrão, mas planejando implantar com transporte HTTP, teste com o mesmo transporte que você usará na produção. As diferenças de comportamento entre os modos com e sem estado podem ser significativas, e é melhor detectar quaisquer problemas durante o desenvolvimento do que após a implantação.

Esses sinalizadores mudam fundamentalmente a forma como seu servidor MCP opera, portanto, escolha-os com base em seus requisitos específicos de escala e funcionalidade.