# 🍥 Permissões do Bushin Discord Direct

Este perfil documenta o que o **Bushin original** pode solicitar ao Discord, sem Composio ou plugin duplicado.

## Login OAuth2 — preparado no código, aguardando hospedagem/consentimento

| Escopo | Capacidades | Estado |
|---|---|---|
| `identify` | Identificar a conta autorizada | Preparado, não autorizado no Bushin |
| `guilds` | Consultar lista de servidores | Preparado, não autorizado no Bushin |
| `guilds.members.read` | Consultar o membro no Naruto Project RP | Preparado, não autorizado no Bushin |

Somente essas três permissões aparecem em `src/discord-api.mjs` e no modelo `mcp.template.json`. Não são permissões ativadas pelo upload do plugin: **o usuário precisa aprovar o OAuth oficial** depois que o servidor HTTPS existir.

## Não ativar por suposição

- Nada de `email`, DMs, amigos, `connections`, `guilds.join`, `messages.read`, `rpc`, controles de administrador, compras ou gerenciamento de servidores.
- O OAuth de uma conta pessoal **não autoriza leitura geral de mensagens pelo REST API** nem o envio como essa conta.
- O modo `BUSHIN_ENABLE_BROWSER_BRIDGE=0` não precisa de GitHub para login e status de membro.
- As permissões de ChatGPT para execução de ações ("Sempre perguntar", "Perguntar antes de alterações", etc.) são **uma configuração distinta**. Não ativar "Acesso total" sem pedido explícito.

## Se o usuário quiser jogar com respostas/missões automáticas

Será necessário um **bot Discord oficial do mesmo aplicativo**, instalado com consentimento de quem administra o servidor Naruto Project RP. Para canais autorizados, o menor conjunto plausível é `VIEW_CHANNEL`, `READ_MESSAGE_HISTORY` e, somente com consentimento para postagem, `SEND_MESSAGES`. Permissões concretas são definidas por cargo/canal e verificadas quando o bot for instalado. Não solicitar `ADMINISTRATOR` por padrão.

O Bushin não instalará um bot nem escreverá mensagens por conta própria enquanto não houver autorização inequívoca do usuário e do servidor. Cada postagem sensível deverá ter destino e conteúdo conferidos antes de enviar.
