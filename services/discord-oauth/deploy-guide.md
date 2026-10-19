# 🍥 Ativar Discord direto no mesmo Bushin Browser

Objetivo: **@Bushin Browser → Conectar Discord → autorizar conta pelo site oficial**, sem Composio e sem depender do GitHub para consultar perfil e participação no RP.

## Infraestrutura necessária (ainda pendente)

- Hospedagem Node.js/Docker com HTTPS público **estável** para este servidor MCP. Você pode usar um provedor de sua escolha que dê suporte a aplicações privadas; não é necessário um segundo plugin no ChatGPT.
- Deploy deve apontar para a subpasta `services/discord-oauth` do repositório **original**, usando o `Dockerfile` incluído.
- Segredos configurados **somente na secret manager do provedor**, nunca no chat, arquivo versionado ou plugin:
  - `PUBLIC_BASE_URL=https://HOST-REAL`
  - `DISCORD_CLIENT_SECRET` (valor do Discord Developer Portal, preenchido apenas na hospedagem)
  - `BUSHIN_OWNER_DISCORD_ID` (ID da sua conta Discord, preenchido apenas na hospedagem)
  - `BUSHIN_ENABLE_BROWSER_BRIDGE=0` (sem necessidade de GitHub)
- Discord Developer Portal → aplicação com Client ID `1561589128108314636` → OAuth2 → Redirects: cadastrar **`https://HOST-REAL/oauth/discord/callback`**. O endereço depende do provedor escolhido.

## Teste externo, antes de vincular o plugin

`GET https://HOST-REAL/health` deve retornar serviço Bushin, `mode=discord_direct`, `requires_github_for_discord=false`. Não é prova de usuário logado. `GET /.well-known/oauth-authorization-server` deve indicar `S256` e DCR; `GET /.well-known/oauth-protected-resource` deve apontar para o mesmo host; `POST /mcp` deve anunciar duas ferramentas Discord. Chamadas privadas sem Bearer devem solicitar autenticação.

## Vincular ao plugin *existente*

Somente depois de confirmar host HTTPS real e funcionamento, substitua a URL de exemplo em `mcp.template.json` por `https://HOST-REAL/mcp` e **adicione `mcp.json` à instalação atual** do plugin `plugins_6ad54d1a617c819191f5c10570c66ef3` usando Plugin Creator e o `current_release_id` atualizado.

Não use domínio inventado e não crie segundo plugin. Não há login só por editar um JSON; no ChatGPT, clique em Conectar na aplicação Bushin e faça o OAuth pelo site oficial. Verifique em seguida `bushin_discord_whoami` e `bushin_discord_naruto_membership`.

## Permissões

O perfil mínimo no Bushin pede `identify`, `guilds` e `guilds.members.read`. Para ler/escrever mensagens de um canal do Naruto RP, será necessário bot oficial autorizado pela administração, separado do login da conta. O código atual não executa essas ações.

## Nota de robustez

O protótipo OAuth guarda sessões temporariamente **em memória**. Uma reinicialização do hosting derruba sessões e exige nova autorização. Não ativar réplicas múltiplas antes de adicionar armazenamento criptografado compartilhado e limitar tentativas. Hospedar uma API pública implica custos e políticas de utilização do provedor; este projeto não inicia assinaturas pagas.
