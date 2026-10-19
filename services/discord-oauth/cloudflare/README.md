# 🍥 Bushin Browser — Cloudflare Workers Free + D1 (alternativa sem Replit)

**Mesmo plugin Bushin Browser:** `plugins_6ad54d1a617c819191f5c10570c66ef3`.
**Client ID público do Discord:** `1561589128108314636`.
**Servidor da conta Naruto Project RP:** `1515877468299595919`.

Este diretório contém uma alternativa de hospedagem separada do antigo backend Node.js. Ela executa o OAuth2.1 e MCP direto na Cloudflare com HTTPS, sem depender de **Replit, Composio, GitHub Actions nem outro plugin ChatGPT durante o login**. O repositório GitHub serve apenas como código-fonte. A Cloudflare permite Workers gratuitos com limites de uso, e D1 oferece armazenamento gratuito limitado. Nenhuma assinatura precisa ser comprada.

## O que é implementado

- OAuth2.1 DCR público **restrito à URL oficial do ChatGPT**, PKCE S256, state anti-CSRF, resource audience, autenticação na página Discord oficial, validação da conta proprietária e confirmação de membro da guild Naruto Project RP.
- Tokens Discord são criptografados antes de serem armazenados em D1 via AES-256-GCM, e o ChatGPT só recebe tokens opacos do próprio Bushin. O refresh token gira após uso. Códigos OAuth e states são de uso único com DELETE RETURNING.
- Duas ferramentas MCP read-only: `bushin_discord_whoami` e `bushin_discord_naruto_membership`.
- Nada de `email`, `messages.read`, bot, administrar servidor, autoenvio por conta pessoal, DMs ou controle de navegador. **O login na API não faz login numa aba web do Discord**.
- D1 é persistente, inclusive quando o Worker fica inativo: evita a perda de sessões que ocorreria com memória temporária em outros serviços gratuitos.
- O `GET /health` indica serviço implantado, não conta logada. Confirme autenticação real só pela ferramenta `whoami`.

## Como implantar — necessita de ação do proprietário, não de créditos Replit

1. Entre em https://dash.cloudflare.com/ e selecione **Workers & Pages / Workers** no plano Free. Se o painel exigir cartão ou plano pago, **não confirme compra**.
2. Em ambiente de desenvolvimento confiável, instale `wrangler` deste subdiretório. Você pode usar o editor/cloud shell da Cloudflare, seu computador, ou GitHub Actions **somente para deployment** (o login depois NÃO depende do GitHub). Acesso à conta Cloudflare é feito na tela segura.
3. Crie **D1** com o nome `bushin-discord-auth` e execute o arquivo `schema.sql` no banco de produção.
4. Copie `wrangler.example.toml` para `wrangler.toml` e troque o `database_id` pelo ID real do D1. Defina `PUBLIC_BASE_URL` como a URL HTTPS real `https://<sua-conta>.workers.dev` obtida na Cloudflare (ou domínio real do Worker). NÃO publique placeholder.
5. Configure na área **Secrets** da Cloudflare, nunca aqui:
   - `DISCORD_CLIENT_SECRET` — Client Secret do aplicativo Discord Bushin
   - `BUSHIN_OWNER_DISCORD_ID` — ID da sua conta Discord
   - `ENCRYPTION_KEY_BASE64` — chave aleatória de 32 bytes em base64, gerada em ambiente confiável; por exemplo, gerada localmente usando um gerenciador de segredos
   - A ligação privada `DB` ao D1 precisa constar nas configurações do Worker
6. Faça o deploy pela Cloudflare/Wrangler. Confirme `GET /health` mostrando `configuration_ready:true`, `GET /.well-known/oauth-authorization-server`, `GET /.well-known/oauth-protected-resource` e `POST /mcp` retornando `tools/list`. Esses testes **não** substituem consentimento no Discord.
7. Discord Developer Portal → Aplicações → **Bushin Browser** (Client ID acima) → OAuth2 → Redirects: cadastre exatamente `https://<seu-host-real>/oauth/discord/callback`. Essa é a URI que o Discord devolve depois de seu consentimento.
8. Quando o URL HTTPS real tiver sido testado, edite o **mesmo plugin** Bushin usando Plugin Creator; inclua `mcp.json` com uma configuração MCP Streamable HTTP apontando para `https://<seu-host-real>/mcp` e autenticação OAuth `client.mode:dcr`, scopes mínimos `identify`, `guilds`, `guilds.members.read`. Não use a URL de placeholder e não instale uma cópia do Bushin.
9. Clique em **Conectar** no Bushin no ChatGPT. Faça login pelo site oficial Discord, aprove consentimento, teste `bushin_discord_whoami` e `bushin_discord_naruto_membership`. Não afirme que a conexão está pronta até essas duas chamadas autenticadas concluírem com sucesso.

## Segurança e limitações

- Cloudflare Free pode bloquear novas requisições ao exceder limites; não precisa pagar para continuar depois do reset. Consulte os limites antes de implantar. Se optar por plano pago, há cobranças.
- A chave de criptografia precisa ser mantida para que os tokens armazenados continuem legíveis; perder a chave exige login novamente. **Nunca colocar secrets no GitHub, no ChatGPT ou no zip do plugin.**
- A implantação não ocorre automaticamente só por existir código. Ainda exige sua conta Cloudflare, Secret do Discord no painel seguro, callback e conexão do plugin.
- URLs de redirect aceitas atualmente são as esperadas para ChatGPT. Se a plataforma devolver uma URI diferente, não relaxe o allowlist sem verificar.
- O Worker gratuito tem limite de CPU por requisição; verificar as transações criptográficas e desempenho com o Cloudflare após implantá-lo, sem afirmar que testes locais provam funcionamento real.
- Não compartilhe fotos de configuração, logs ou capturas contendo tokens/códigos de login.
