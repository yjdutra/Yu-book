# MCP: Advanced Topics — anotações de curso

**Curso:** Model Context Protocol: Advanced Topics (Claude Academy) · **Anotações:** yjdutra
**Progresso:** 11 de 11 lições — **curso concluído em 2026-08-26**
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
| 7 | Tipos de mensagens JSON | ✅ |
| 8 | O transporte stdio | ✅ |
| 9 | O transporte StreamableHTTP | ✅ |
| 10 | StreamableHTTP em profundidade | ✅ |
| 11 | Estado e o transporte StreamableHTTP | ✅ |

### Encerramento

| Item | Estado |
|---|---|
| Avaliação dos conceitos do MCP (questionário) | ✅ |
| Crachá de conclusão | ✅ |

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

O eixo desta parte é uma frase: **o transporte não é detalhe de encanamento, é o que decide quais
mensagens do protocolo continuam possíveis.** A Parte I mostrou o MCP inteiro, com a via de volta
funcionando; a Parte II mostra o que se perde quando essa via passa a atravessar a internet.

---

## Lição 7 — Tipos de mensagens JSON

O MCP usa mensagens JSON para a comunicação entre clientes e servidores. Entender esses tipos é
essencial, sobretudo ao lidar com transportes diferentes.

### Formato da mensagem

Toda a comunicação do MCP acontece por mensagens JSON, e cada tipo tem uma finalidade específica:
chamar uma ferramenta, listar recursos disponíveis, notificar um evento.

Exemplo típico: quando Claude precisa chamar uma ferramenta de um servidor MCP, o cliente envia uma
mensagem `Call Tool Request`. O servidor processa, executa a ferramenta e responde com um
`Call Tool Result` contendo a saída.

### A especificação

A lista completa de tipos de mensagem vive no **repositório oficial de especificação do MCP**, no
GitHub. Ela é separada dos repositórios de SDK (Python, TypeScript…) e é a fonte de verdade de como
o MCP deve funcionar.

Os tipos são escritos em TypeScript **por conveniência** — não porque sejam executados como código,
mas porque o TypeScript descreve estrutura de dados de forma clara.

### As duas categorias

**Solicitação → resultado.** Vêm sempre em par: você envia uma solicitação e espera um resultado.

- `Call Tool Request` → `Call Tool Result`
- `List Prompts Request` → `List Prompts Result`
- `Read Resource Request` → `Read Resource Result`
- `Initialize Request` → `Initialize Result`

**Notificação.** Mensagens de mão única, que informam um evento e não esperam resposta.

- `Progress Notification` — andamento de operações longas
- `Logging Message Notification` — mensagens de registro
- `Tool List Changed Notification` — quando as ferramentas disponíveis mudam
- `Resource Updated Notification` — quando um recurso é modificado

### Mensagens do cliente e mensagens do servidor

A especificação organiza as mensagens **por quem as envia**. O cliente tem solicitações e
notificações que envia ao servidor; o servidor tem solicitações e notificações que envia ao cliente.

### Por que isso importa

Entender que **o servidor também envia mensagens ao cliente** é o que torna a escolha de transporte
uma decisão de verdade: alguns transportes limitam quais tipos de mensagem podem fluir em cada
direção.

A ideia central: **o MCP é um protocolo bidirecional** — os dois lados podem iniciar comunicação.

> **→ Ponte para o Yu-book.** O `apps/mcp` já usa as duas categorias: `tools/call` é o par
> solicitação → resultado, e `notifications/progress` e `notifications/message`, entregues pelas
> tools de escrita, são notificações de mão única. A verificação "toda linha do stdout é JSON
> válido" existe porque **essas mensagens compartilham o canal** — e é ela que a Fase 3 precisa
> substituir quando o canal deixar de ser stdout.

---

## Notas pessoais — o ciclo de comunicação, enfim

> Esta seção é do autor das anotações, não do curso.

**O pedido:** *"me traga as notas de julho e agrupe pelo conteúdo"*, digitado no terminal do Claude Code.

1. **Você manda a instrução humana no terminal.**
2. **O modelo Claude, na nuvem, lê o prompt**, entende o que você quer e percebe que precisa de dados externos.
   O detalhe que faltava: **não é o cliente MCP que decide como fazer o trabalho.** Quem decide chamar a
   ferramenta é o **modelo**, com base nas descrições das tools que o cliente MCP apresentou a ele no
   início da sessão. O modelo decide invocar `get_notes` passando o filtro de data de julho.
3. **O Claude Code, que hospeda o cliente MCP, envia `tools/call`** por stdin/stdout para o `apps/mcp`,
   o servidor MCP na sua máquina.
   O `apps/mcp` **não tem IA, não fala com o modelo e não sabe qual modelo está do outro lado.** Ele só
   recebe o comando JSON-RPC. Executa a lógica: faz `fetch` na `apps/api`, que busca no Postgres,
   empacota a resposta em texto e devolve ao cliente MCP.
4. **O modelo, na nuvem, recebe o texto das notas**, faz o agrupamento temático e exibe o resultado
   formatado no terminal.

### Quando e como as tools são carregadas

Diferente de uma skill dinâmica, que só entra no prompt quando uma palavra-chave aciona o gatilho, as
definições das ferramentas MCP são carregadas **no handshake inicial da sessão**:

1. **Abertura da sessão.** O Claude Code lê o arquivo de configuração onde os servidores MCP estão declarados.
2. **Subprocesso iniciado.** Ele dispara o `apps/mcp` (`node dist/index.js`) em segundo plano, por stdin/stdout.
3. **Descoberta de capacidades (`tools/list`).** Antes de você digitar qualquer coisa, o cliente MCP
   pergunta ao servidor *"o que você sabe fazer?"*, e recebe a lista estruturada: nome de cada tool,
   o que faz e quais parâmetros espera.
4. **Injeção no contexto do modelo.** O Claude Code pega essa lista e injeta o catálogo de ferramentas
   no *system prompt* enviado ao modelo, na nuvem.

---

## Lição 8 — O transporte stdio

Cliente e servidor MCP trocam mensagens JSON — mas **como** essas mensagens trafegam? O canal se chama
**transporte**, e há várias formas de implementá-lo: HTTP, WebSockets, até escrever JSON num cartão
postal (este último não recomendado para produção).

### Como funciona

Quando se desenvolve um servidor ou cliente MCP pela primeira vez, o transporte mais comum é o
**stdio**: o cliente inicia o servidor MCP como subprocesso e conversa por entrada e saída padrão.

> *Diagrama: o cliente envia mensagens pelo `stdin` do servidor, e o servidor responde pelo `stdout`;
> qualquer um dos lados pode enviar a qualquer momento, e só funciona com os dois na mesma máquina.*

- O cliente envia mensagens usando o `stdin` do servidor
- O servidor responde escrevendo no `stdout`
- **Os dois podem enviar mensagem a qualquer momento**
- **Só funciona com cliente e servidor na mesma máquina**

### Vendo stdio em ação

Dá para testar um servidor MCP direto do terminal, sem escrever cliente nenhum. Rodando o servidor
com `uv run server.py`, ele escuta `stdin` e escreve respostas em `stdout` — então basta colar
mensagens JSON no terminal e ver as respostas na hora.

### A sequência de conexão

Toda conexão MCP começa com um **handshake de três mensagens**:

> *Diagrama: o cliente envia `Initialize Request`, o servidor responde com `Initialize Result`, e o
> cliente envia `Initialized Notification`, para a qual não volta resultado nenhum.*

1. **`Initialize Request`** — o cliente envia primeiro
2. **`Initialize Result`** — o servidor responde com as capabilities
3. **`Initialized Notification`** — o cliente confirma (nenhuma resposta esperada)

**Só depois desse handshake** é possível enviar outras solicitações, como chamadas de ferramenta ou
listagens de prompt.

### Os quatro cenários de comunicação

Com qualquer transporte é preciso resolver quatro padrões:

| Padrão | Como o stdio resolve |
|---|---|
| Solicitação do cliente → servidor | o cliente escreve no `stdin` |
| Resposta do servidor → cliente | o servidor escreve no `stdout` |
| Solicitação do servidor → cliente | o servidor escreve no `stdout` |
| Resposta do cliente → servidor | o cliente escreve no `stdin` |

A beleza do stdio é a simplicidade: **qualquer um dos lados inicia comunicação a qualquer momento,
usando dois canais.**

### Por que isso importa

O stdio é o caso **ideal**, em que a comunicação bidirecional é perfeita. Ao migrar para outros
transportes, como HTTP, aparecem limitações em que **o servidor nem sempre consegue iniciar
solicitações ao cliente**. O stdio serve de base para entender como é o MCP completo, antes de
enfrentar as restrições dos outros.

Para desenvolvimento e teste, stdio é perfeito. Para produção com cliente e servidor em máquinas
diferentes, é preciso considerar outras opções — e as compensações de cada uma.

> **→ Ponte para o Yu-book.** É exatamente o transporte de hoje, e o que o `apps/mcp` faz é o
> handshake das três mensagens seguido de `tools/list` — o roteiro JSON-RPC "na unha" do
> `apps/mcp/README.md` é literalmente esta lição. E "só funciona na mesma máquina" é a razão de o
> `.env` com email e senha ser aceitável: o processo é seu, na sua máquina.

---

## Lição 9 — O transporte StreamableHTTP

O StreamableHTTP permite que clientes MCP se conectem a servidores **hospedados remotamente**, por
HTTP. Diferente do stdio, que exige cliente e servidor na mesma máquina, ele abre a possibilidade de
servidores MCP públicos, que qualquer pessoa acessa.

Há uma ressalva importante: **algumas configurações limitam severamente a funcionalidade do
servidor.** Se a sua aplicação funciona perfeitamente com stdio local e quebra ao ser publicada com
HTTP, provavelmente é isso.

### As duas configurações que importam

| Sinalizador | Controla |
|---|---|
| `stateless_http` | o gerenciamento de estado da conexão |
| `json_response` | o formato da resposta |

Por padrão **as duas são `false`**, mas certos cenários de implantação forçam `true`. Quando ligadas,
elas quebram funcionalidades essenciais: **notificações de progresso, registro e solicitações
iniciadas pelo servidor**.

### O desafio do HTTP

Para entender por que essas limitações existem, vale revisar o HTTP:

- Clientes iniciam solicitações a servidores com facilidade — **o servidor tem URL conhecida**
- Servidores respondem a essas solicitações com facilidade
- **Servidores não iniciam solicitações a clientes com facilidade** — clientes não têm URL conhecida
- O padrão "resposta do cliente de volta ao servidor" fica problemático

### Os tipos de mensagem afetados

Essa limitação atinge padrões específicos do MCP, que ficam difíceis com HTTP simples:

- **Solicitações iniciadas pelo servidor:** `Create Message Request` (amostragem), `List Roots Request`
- **Notificações:** progresso, registro, `initialized`, cancelamento

São exatamente os recursos que quebram quando se ligam os sinalizadores restritivos. **As barras de
progresso somem, o registro para de funcionar e a amostragem falha.**

### A solução

O StreamableHTTP contorna as limitações do HTTP, mas com compensações. Ligar `stateless_http=True`
ou `json_response=True` é, no fundo, **dizer ao transporte para operar dentro das restrições do
HTTP em vez de contorná-las**.

Entender isso ajuda a decidir: qual transporte usar em cada cenário, como projetar o servidor para
degradar com elegância, e quando aceitar funcionalidade reduzida em troca de hospedagem remota.

> **→ Ponte para o Yu-book.** As quatro tools de escrita emitem log e progresso, e a `trash_note`
> chega a reportar dois passos. Com `stateless_http=True` **isso tudo cala** — e cala em silêncio,
> não com erro. É a primeira decisão concreta da Fase 3, e não é técnica: é escolher entre escalar
> e manter a via de volta.

---

## Lição 10 — StreamableHTTP em profundidade

O StreamableHTTP é a solução do MCP para um problema fundamental: **alguns recursos exigem que o
servidor faça solicitações ao cliente, e o HTTP torna isso difícil.**

### O problema central

Amostragem, notificações e registro dependem de o servidor iniciar a conversa. Mas o HTTP foi
desenhado para o cliente pedir e o servidor responder, nunca o contrário. O StreamableHTTP resolve
com uma solução alternativa engenhosa: **Server-Sent Events (SSE)**.

### A conexão inicial

Começa como qualquer conexão MCP, com **uma adição decisiva**:

1. O cliente envia `Initialize Request`
2. O servidor responde com `Initialize Result` **incluindo um cabeçalho `mcp-session-id`**
3. O cliente envia `Initialized Notification` com o id da sessão

**Esse id de sessão é crucial:** ele identifica o cliente de forma única e **precisa ir em todas as
solicitações seguintes**.

### A solução alternativa do SSE

Depois da inicialização, o cliente faz uma requisição **GET** para estabelecer uma conexão SSE. Isso
cria uma resposta HTTP de longa duração que o servidor pode usar para **transmitir mensagens de
volta ao cliente a qualquer momento**.

É essa conexão que devolve ao servidor a capacidade de falar primeiro.

### Chamada de ferramenta e as duas conexões SSE

Quando o cliente chama uma ferramenta, aparecem **duas conexões SSE separadas**:

| Conexão | Papel | Duração |
|---|---|---|
| **SSE primária** | solicitações iniciadas pelo servidor | fica aberta indefinidamente |
| **SSE da chamada** | criada para cada chamada de ferramenta | fecha ao enviar o resultado |

E o roteamento das mensagens segue essa divisão:

- **Notificações de progresso** → conexão SSE **primária**
- **Mensagens de registro e resultado da ferramenta** → conexão SSE **da chamada**

### Os sinalizadores que quebram a solução

`stateless_http` e `json_response`, postos em `True`, **quebram o mecanismo do SSE**. Pode-se querer
ligá-los em certos cenários, mas isso limita toda a funcionalidade do MCP que depende de
comunicação servidor → cliente.

### Conclusão

O StreamableHTTP é mais complexo que os outros transportes porque **precisa contornar o HTTP**. O
modelo de conexão dupla é o que permite MCP completo por HTTP, e entendê-lo é essencial para depurar.

Duas coisas para lembrar: **o id de sessão é obrigatório em toda solicitação depois da
inicialização**, e o sistema gerencia várias conexões SSE automaticamente.

> **→ Ponte para o Yu-book.** Aqui está a resposta para a pergunta que a Parte II deveria responder:
> **de onde vem a identidade quando ela não vem mais do ambiente do processo?** Do
> `mcp-session-id`, emitido pelo servidor no `Initialize Result`. Só que isso identifica a
> **sessão**, não a **pessoa** — e a diferença entre as duas é o assunto inteiro da Fase 3.

---

## Lição 11 — Estado e o transporte StreamableHTTP

Os sinalizadores `stateless_http` e `json_response` controlam aspectos fundamentais do comportamento
do servidor. Saber quando e por que usá-los é crucial, sobretudo ao dimensionar ou publicar em
produção.

### Quando o HTTP sem estado é necessário

Imagine que o seu servidor MCP fica popular. No começo, poucos clientes numa instância só. Com o
crescimento, milhares de clientes — e uma instância não dá conta.

A solução típica é **escala horizontal**: várias instâncias atrás de um balanceador de carga.

**E é aqui que complica.** O cliente MCP precisa de **duas conexões separadas**:

- uma conexão **GET SSE**, para receber as mensagens de servidor → cliente
- requisições **POST**, para chamar ferramentas e receber respostas

Com um balanceador, essas requisições podem cair em **instâncias diferentes**. Se a ferramenta
precisar usar Claude por amostragem, a instância que atendeu o POST teria de coordenar com a
instância que segura o GET SSE. **Isso é um problema de coordenação entre servidores.**

### Como o `stateless_http` resolve — e o que custa

`stateless_http=True` elimina a coordenação, com compensações significativas:

| O que se perde | Consequência |
|---|---|
| Id de sessão | o servidor não consegue rastrear clientes individuais |
| Solicitação servidor → cliente | o caminho GET SSE fica indisponível |
| Amostragem | não dá para usar Claude nem outro modelo |
| Relatório de progresso | nada de atualizações durante operações longas |
| Assinaturas | não dá para notificar sobre atualização de recurso |

Há um benefício: **a inicialização deixa de ser necessária.** Os clientes fazem requisições
diretamente, sem handshake.

### O `json_response`

Este é mais simples: **desliga o streaming das respostas de POST.** Em vez de várias mensagens SSE
enquanto a ferramenta roda, vem só o resultado final, em JSON simples.

Com streaming desligado: **sem progresso intermediário, sem registro durante a execução, só o
resultado final.**

### Quando usar cada um

**Use `stateless_http` quando:**
- precisa de escala horizontal com balanceador
- não precisa de comunicação servidor → cliente
- suas ferramentas não usam amostragem
- quer minimizar a sobrecarga de conexão

**Use `json_response` quando:**
- não precisa de resposta em streaming
- prefere respostas HTTP simples
- integra com sistemas que esperam JSON puro

### Desenvolvimento contra produção

Se você desenvolve localmente com stdio mas planeja publicar com HTTP, **teste com o mesmo
transporte que vai usar em produção**. A diferença de comportamento entre os modos com e sem estado
é significativa, e é melhor descobrir o problema durante o desenvolvimento do que depois.

> **→ Ponte para o Yu-book.** Esta lição é a decisão inteira da Fase 3, posta como um trade-off:
> **com estado**, o servidor sabe quem está falando e a via de volta funciona, mas não escala
> horizontalmente sem coordenação; **sem estado**, escala, e cala. Para um segundo cérebro
> single-user o dilema é mais fácil do que parece — não há milhares de clientes. Mas a última frase
> da lição é um aviso direto ao estado atual do projeto: **desenvolver em stdio e publicar em HTTP
> sem testar no mesmo transporte é onde isto costuma quebrar.**

---

## Encerramento

- [x] Avaliação dos conceitos do MCP (questionário)
- [x] Crachá de conclusão

**Curso concluído.** O que ele destrava está registrado em
[`applied-ai-read-trip.md`](../applied-ai-read-trip.md): a Fase 3 do roteiro — transporte e
identidade — deixou de esperar por curso e passou a esperar por execução.
