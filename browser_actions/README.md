# 🍥 Bushin Browser — GitHub Actions sem Codespaces

Abra o [workflow Bushin Browser — Actions](https://github.com/educacaomggovbr00-web/shinobi-ai-agent/actions/workflows/bushin-browser-actions.yml), selecione **Run workflow** e informe uma URL HTTPS pública e uma lista JSON de até 12 passos no campo `passos_json`.

## Ações

| Comando | Exemplo |
| --- | --- |
| Abrir página | `{"action":"goto","url":"https://example.com"}` |
| Clicar em elemento | `{"action":"click","selector":"a"}` |
| Preencher campo comum | `{"action":"fill","selector":"input[name=q]","text":"Naruto"}` |
| Pressionar tecla | `{"action":"press","key":"Enter"}` |
| Rolar | `{"action":"scroll","pixels":500}` |
| Esperar | `{"action":"wait","ms":800}` |
| Extrair texto | `{"action":"extract","selector":"body"}` |
| Screenshot adicional | `{"action":"screenshot"}` |

### Exemplo de `passos_json`

```json
[
  {"action":"scroll","pixels":600},
  {"action":"screenshot"},
  {"action":"extract","selector":"body"}
]
```

O Chromium roda em um runner temporário do GitHub. Após terminar, em **Artifacts** aparecem `final.png` (print), `pagina.txt` (texto), `relatorio.json` e vídeo `.webm`, além de eventuais capturas intermediárias. O vídeo **não** é streaming simultâneo. O ambiente não conserva login/cookies de outras execuções e não acessa o antigo Codespace.

Nunca informe senhas, tokens, cookies, códigos de autenticação ou dados privados como inputs: entradas e artefatos do Actions podem ser acessíveis por quem tem acesso ao repositório. Para contas autenticadas, use Browser Use/TinyFish com sessão de login criada em tela segura. O Discord proíbe automação de conta pessoal (self-bot); publicações automáticas requerem bot oficial com permissão no servidor.

O plugin privado [Bushin Browser](https://chatgpt.com/plugins/plugins_6ad54d1a617c819191f5c10570c66ef3) pode orientar esse workflow e usar provedores de navegação em nuvem conectados diretamente ao ChatGPT. Ele não hospeda um navegador por conta própria.


## 🎥 Bushin Discord Linux AO VIVO (controlado pelo ChatGPT em execuções novas)

[Iniciar desktop Linux no GitHub Actions](https://github.com/educacaomggovbr00-web/shinobi-ai-agent/actions/workflows/bushin-discord-live.yml)

Este workflow é **diferente** do browser Playwright acima: abre Chromium interativo em um desktop noVNC, com link secreto temporário visível somente nos logs/resumo do seu Actions. A sessão pode durar até 6 horas incluindo instalação; quando encerrar, perderá o login. **Nunca envie senha, link secreto ou cookies ao chat**, a um commit ou a um input de Actions.

Com a versão do código instalada em **novas execuções** após a integração 1.2, o Bushin pode consultar e navegar por comandos autenticados pela sua conexão GitHub:

- `browser_actions/live_command.json` — solicitações com `id`, `session_id` igual ao identificador da execução, `action` e parâmetros.
- `browser_actions/live_result.json` — resposta com os mesmos `id` e `session_id`, sucesso ou erro.
- Ações permitidas: `status`, `open_url`, `scroll`, `click_navigation` (navegação para um canal permitido) e `read_page_text` (somente textos visíveis do Naruto Project RP).
- **Não permite** escrever mensagens como conta pessoal do Discord, digitar credenciais, executar terminal ou compartilhar screenshots por commits.
- O texto retornado por `read_page_text` será guardado no histórico de commits do **repositório privado**, então use somente para canais autorizados.

O controle funciona por meio do GitHub integrado ao ChatGPT, **sem requerer o segredo do noVNC**. Quem possui o link privado continua podendo acompanhar e controlar o mouse/teclado manualmente. Não compartilhe esse link.

**Execuções antigas não são atualizadas:** a execução #39176481835 começou antes do código com receptor GitHub; se ainda estiver ativa, preserva a tela mas **não** recebe novos comandos. Não a reinicie sem autorização, pois o login atual será perdido. Na próxima execução do workflow atualizado, é possível fazer login novamente e testar os comandos. O plugin [Bushin Browser v1.2](https://chatgpt.com/plugins/plugins_6ad54d1a617c819191f5c10570c66ef3) descreve esses passos.


## 📸 Bushin v1.4 — capturas reais NO chat, sem iframe

O ChatGPT bloqueou a incorporação do noVNC por Content Security Policy (`ERR_BLOCKED_BY_CSP`). **Não é possível converter a janela do GitHub Actions na interface nativa do Work só editando o plugin.**

A alternativa testada com sucesso é uma **captura estática sob demanda** em um artifact privado do próprio GitHub Actions, recuperado pelo assistente e exibido como imagem no ChatGPT. O teste sintético executou em https://github.com/educacaomggovbr00-web/shinobi-ai-agent/actions/runs/39181978194 e produziu uma imagem enquanto o job ainda estava em andamento. **Esse teste não capturou o Discord.**

Como funciona em **sessões novas** do Linux (as execuções já iniciadas não carregam novos scripts):

1. Inicie `bushin-discord-live.yml` quando não precisar mais preservar a sessão antiga; faça login pelo noVNC seguro na execução nova. **Não coloque senhas, cookies, tokens ou segredo do noVNC no repositório ou chat.**
2. Abra um canal do servidor autorizado Naruto Project RP.
3. Peça ao Bushin no ChatGPT: *"Tira um print da tela do Naruto RP e mostra aqui."*
4. O assistente verifica o `run_id` online, insere na fila `browser_actions/live_command.json` uma solicitação `{"id":"...","session_id":"...","action":"screenshot"}`, e aguarda no `browser_actions/live_result.json` um `artifact_id` confirmado.
5. A captura JPEG é enviada como **artifact privado** com retenção de 1 dia, sem colocar os pixels em commits, logs ou no plugin; no GitHub permanece somente o ID e nome do artifact. O assistente baixa pelo conector GitHub, verifica o arquivo e exibe a imagem local no chat. Para atualizar a imagem é necessário outro pedido; **não é transmissão ao vivo contínua**.
6. Restrição: somente canais de Naruto Project RP, sem campos de senha, limite de 6 capturas por execução. Cada captura é guardada temporariamente no armazenamento de artifacts privado e pode ser acessada por pessoas com acesso ao repositório durante o período de retenção.

O link noVNC continua externo e pode ser usado em paralelo pelo usuário para vídeo realmente ao vivo. O teste bem-sucedido não confirma ainda uma captura de Discord: depende de iniciar uma nova sessão com o código atualizado. **A execução #39178166963 foi iniciada antes do novo código e não oferece o comando screenshot.**


## 🔐 Bushin v1.6 — entrada pública com autenticação

Nas **novas execuções** do workflow de desktop, a raiz do túnel Cloudflare e `/vnc.html` exibem uma página pública de **login** em vez de retornar imediatamente HTTP 403. A página pública não inclui pixels do desktop, scripts do noVNC ou acesso ao WebSocket antes da autenticação.

- Clique no **link privado** exibido no resumo/log da própria execução GitHub Actions: `/connect?key=...` autentica com o segredo aleatório da sessão e grava um cookie `Secure`, `HttpOnly`, `SameSite=Lax`.
- Alternativamente, abra a URL **sem o segredo** (domínio `https://....trycloudflare.com/vnc.html`) e preencha no formulário a chave daquela mesma execução, **somente na página segura**. Não cole o segredo em chats, prompts, commits ou sistemas de automação.
- Sem sessão autenticada, solicitações de JavaScript/CSS da interface, WebSocket do VNC e quaisquer outras rotas internas permanecem negadas (`403`).
- A execução continua efêmera (até 6h incluindo provisionamento); novas versões **não** são aplicadas retroativamente em sessões já iniciadas.

**Importante:** essa mudança não torna o desktop público ou acessível diretamente ao TinyFish/Browser Use sem autenticação. Esses serviços precisariam de uma sessão web autenticada própria, configurada pela interface segura deles. Não publique o link privado ou a chave na conversa.
