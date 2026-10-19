# 🍥 Bushin Browser 2.0 — painel visual + Discord OAuth2 independente

**Este código faz parte do Bushin Browser original. Não cria um segundo plugin e não usa Composio.** A integração não está conectada só porque o código existe. Para o botão real de login funcionar, é necessário publicar este serviço MCP sob um endereço HTTPS FIXO e adicionar `mcp.json` ao mesmo plugin instalado após verificar a URL. O template `mcp.template.json` tem domínio de exemplo e NÃO deve ser instalado como está.

## O que já foi implementado e testado no GitHub Actions

- Backend Node.js MCP HTTP em `src/server.mjs`.
- Widget nativo MCP Apps em `public/browser-console.html`: botões capturar tela, rolar, navegar em canais permitidos, clicar sobre captura (somente após ativar) e consultar status.
- Ponte GitHub Actions em `src/github-bridge.mjs`: comandos seguros para a sessão ativa e retorno de JPEG privado verificado. O token GitHub reside SOMENTE na secret manager da hospedagem; nunca é enviado ao widget.
- OAuth 2.1 próprio em `src/oauth-bridge.mjs`: Protected Resource Metadata, Authorization Server Metadata, DCR público, Authorization Code, PKCE S256, state, issuer, validação de URI de retorno, token opaco com audiência do MCP e refresh com rotação. O Discord Client ID público é `1561589128108314636`.
- Login do usuário ocorre exclusivamente na página oficial do Discord. O Client Secret fica SOMENTE no serviço HTTPS. Os tokens Discord ficam em memória do processo e não são passados ao ChatGPT.
- Identidade autorizada verificada pelo Discord e membro do Naruto Project RP `1515877468299595919`. Nada de login como self-bot, envio de mensagens pessoais, leitura de DMs, senha, 2FA ou tokens no chat.
- Testes de segurança, simulação de autorização, inicialização real do servidor MCP e confirmação do challenge HTTP 401 executados pelo workflow `.github/workflows/bushin-discord-oauth-tests.yml`.

**Importante:** os testes de OAuth usam respostas falsas do Discord, nunca fizeram login em uma conta real. O widget só foi testado quanto à descoberta MCP; não foi exibido dentro do ChatGPT ao vivo. A integração ainda depende do deploy e de teste ponta a ponta.

## Para ativar o login real do Bushin

1. Escolha **uma hospedagem Node.js persistente**, por exemplo Replit deployment ou VPS, com endereço HTTPS estável. GitHub Actions com Cloudflare Quick Tunnel serve para o Linux temporário, mas NÃO para o callback permanente do OAuth.
2. Publique **somente esta subpasta do repositório original** `services/discord-oauth`. Inicie com `npm ci` (ou `npm install`) e `npm start`. Node.js 20+; forneça `PORT`.
3. Insira estas variáveis na **secret manager do provedor**, nunca no chat, commit, arquivo `.env` enviado ou log:
   - `PUBLIC_BASE_URL`: URL HTTPS real e estável (exemplo: `https://meu-host.example`).
   - `DISCORD_CLIENT_SECRET`: Client Secret do aplicativo Discord Bushin. Somente pelo formulário de segredos seguro do provedor.
   - `BUSHIN_OWNER_DISCORD_ID`: identificador da conta autorizada a usar o Bushin, como variável privada da hospedagem.
   - `BUSHIN_GITHUB_TOKEN`: credencial GitHub **restrita ao repositório** `educacaomggovbr00-web/shinobi-ai-agent` com `Contents: read/write` e `Actions: read`; também na secret manager. Sem ela, login/perfil pode funcionar, mas controle do Chrome remoto não.
4. Discord Developer Portal → aplicações → Bushin Browser → OAuth2 → Redirects. Adicione **exatamente** `https://SEU-HOST-HTTPS/oauth/discord/callback`. Não autorize redirects de domínios desconhecidos; não é o callback do ChatGPT aqui.
5. Verifique a hospedagem externamente:
   - `GET /health` exibe identidade do serviço, nunca garante usuário conectado;
   - `GET /.well-known/oauth-authorization-server` anuncia DCR + PKCE S256;
   - `GET /.well-known/oauth-protected-resource` referencia o próprio emissor;
   - `POST /mcp` responde a `initialize` e `tools/list`; `tools/call` sem token responde 401.
6. Quando a URL real for verificada, altere o domínio em `mcp.template.json` e incorpore como `mcp.json` ao **mesmo plugin Bushin Browser** usando Plugin Creator, sem criar outro plugin. Use OAuth DCR e NÃO forneça Client Secret ao ChatGPT: o Client Secret Discord já está na hospedagem.
7. Abra o Bushin no ChatGPT, execute `bushin_discord_whoami`, faça login pelo Discord e aprove a autorização na tela oficial. Teste depois `bushin_discord_naruto_membership`, `bushin_open_browser_console`, `bushin_browser_status` e capturas.
8. O Chromium no GitHub Actions é **outra sessão**: o OAuth prova sua identidade ao serviço, mas não injeta cookie Discord no Chrome. Para acessar mensagens pelo Chrome, login inicial via interface segura do noVNC continua sendo necessário. Não iniciar/reiniciar desktop sem o usuário pedir.

## Limitações importantes

- A memória de autorizações do protótipo OAuth é **volátil**; quando o servidor reinicia, clientes e tokens podem precisar de reconexão. Para produção persistente/múltiplas instâncias, trocar por armazenamento criptografado durável com limites e revogação.
- O painel mostra **JPEGs sob demanda** usando artifacts privados, não vídeo nem o navegador nativo do Work. O antigo controlador limita 6 capturas por execução; novos scripts permitem até 12. Para experiência realmente contínua, será preciso outra arquitetura com captura/stream autenticado, infraestrutura persistente e tratamento de custo.
- O servidor precisa ser protegido contra abuso, com rate limiting, métricas sanitizadas, autenticação rigorosa, TLS real e testes ao vivo antes de acesso amplo. Não publicar fora do uso privado antes de auditoria.
- O OAuth Discord apenas dá acesso a `identify`, `guilds`, `guilds.members.read`. Não dá histórico geral de canais, nem permissão para postar pela conta. Para atuação dentro do servidor, somente bot oficial autorizado pela administração.
- Quem tiver acesso aos artifacts privados do repositório pode ver capturas durante a retenção de um dia.
- A experiência Work é um recurso do ChatGPT; nenhum plugin externo pode assumir que dispõe exatamente do mesmo controle, vídeo, sessões ou políticas de segurança.

## Desenvolvimento

```sh
cd services/discord-oauth
npm install
npm test
npm run check
# Apenas com segredos configurados em ambiente protegido:
npm start
```

Testes contínuos: https://github.com/educacaomggovbr00-web/shinobi-ai-agent/actions/workflows/bushin-discord-oauth-tests.yml

Código sempre no repo original: https://github.com/educacaomggovbr00-web/shinobi-ai-agent/tree/main/services/discord-oauth

## 🍥 Discord Direct — usar o Bushin como conector sem GitHub

**O caminho principal é o Discord diretamente**, como um conector de conta no ChatGPT. O serviço só precisa de HTTPS estável e das variáveis secretas de OAuth Discord (`PUBLIC_BASE_URL`, `DISCORD_CLIENT_SECRET`, `BUSHIN_OWNER_DISCORD_ID`). Para confirmar identidade e vínculo ao Naruto RP, **não é necessário `BUSHIN_GITHUB_TOKEN` nem conectar a conta GitHub ao ChatGPT**.

Por padrão, `BUSHIN_ENABLE_BROWSER_BRIDGE` é ausente ou diferente de `1`: o servidor anuncia **somente** as duas ferramentas Discord `bushin_discord_whoami` e `bushin_discord_naruto_membership`. O navegador visual, seus controles e screenshot não aparecem nessa configuração. O endpoint `/health` informa `mode=discord_direct` e `requires_github_for_discord=false`.

A função visual legada só deve ser habilitada intencionalmente com `BUSHIN_ENABLE_BROWSER_BRIDGE=1` **e** `BUSHIN_GITHUB_TOKEN` definido na hospedagem. Essa função é independente do login Discord, e pode ser substituída futuramente por um navegador remoto com hospedagem própria, sem GitHub Actions. Sem backend de navegador, OAuth Discord não dá acesso ao Discord Web UI nem permite ler/enviar mensagens de canais livremente.

**Estado:** arquitetura implementada e testes automatizados aprovados; ainda não existe serviço HTTPS implantado nem `mcp.json` configurado no plugin original. Assim, o botão de conectar só estará disponível depois de publicar um servidor de autenticação e configurá-lo na mesma instalação do Bushin.
