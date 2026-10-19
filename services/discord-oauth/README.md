# 🍥 Bushin — login Discord próprio (em preparação)

Esta pasta é o **backend MCP do MESMO plugin Bushin Browser**. Não cria um segundo plugin, não usa Composio, não tem bot token nem automatiza uma conta pessoal.

## Feito
- Client ID público do app Discord Bushin Browser: `1561589128108314636`.
- Serviço MCP Streamable HTTP com ferramentas somente de leitura: `bushin_discord_whoami` e `bushin_discord_naruto_membership`.
- O serviço recebe o access token por **Authorization Bearer** enviado pelo cliente OAuth, valida com a API oficial do Discord e não armazena token.
- Restrito ao Naruto Project RP `1515877468299595919`; não lê DMs, mensagens, e-mails ou histórico; não manda mensagens nem instala bot.
- Testes unitários mockados e Actions `bushin-discord-oauth-tests.yml`.

## Falta para um login real no próprio cartão do Bushin
1. Hospedar ESTE serviço de `services/discord-oauth/` sob **domínio HTTPS estável**, em hosting aprovado pelo usuário (Node.js 20+). O domínio temporário `trycloudflare.com` ou um GitHub Actions de 6h NÃO serve como OAuth permanente.
2. Definir `PUBLIC_BASE_URL=https://seu-host-estavel` e `PORT` conforme o provedor. Configure `BUSHIN_OWNER_DISCORD_ID` na secret manager do hosting se quiser restringir ao dono. **Não** enviar o Client Secret, token, senha ou código de autorização em chats/commits.
3. No Discord Developer Portal > Applications > Bushin Browser > OAuth2, cadastrar **exatamente a Redirect URI que o ChatGPT mostrar** ao conectar a configuração MCP. Não inventar callback.
4. Após o HTTPS funcionar, substituir a URL placeholder em `mcp.template.json` pela URL real e então adicionar **`mcp.json` ao plugin Bushin Browser existente** com o Plugin Creator, mantendo o mesmo plugin ID. Na tela de conexão OAuth, fornecer o Client Secret apenas no campo seguro, caso solicitado.
5. Testar ponta a ponta `tools/list`, redirecionamento para Discord, consentimento, retorno OAuth e chamadas autenticadas. Sem testes ponta a ponta, não afirmar que "Bushin já entrou".

### Compatibilidade importante
O Discord fornece OAuth2 Authorization Code com Client Secret, mas não se assume que implemente integralmente as exigências do OAuth 2.1 e de descoberta do MCP/ChatGPT (como PKCE S256, Resource Indicators e metadados). O template usa overrides oficiais de endpoints e método `client_secret_basic`; **compatibilidade final depende de testar o conector na plataforma**. Caso essa configuração não seja aceita, será necessário um adaptador de autenticação OAuth2.1 próprio, ainda no mesmo backend, com armazenamento seguro e estado anti-CSRF — não burlar controles.

### Desenvolvimento
```bash
cd services/discord-oauth
npm install
PUBLIC_BASE_URL=https://SEU-HOST-HTTPS npm start
npm test
```

Endpoints de referência: `GET /health`, `GET /.well-known/oauth-protected-resource`, `POST /mcp`.

**Nunca adicione uma configuração com host placeholder ao plugin instalado; isso quebraria a conexão.** O Bushin Browser 1.8 continua utilizável para captura e navegação até o login próprio estar pronto.
