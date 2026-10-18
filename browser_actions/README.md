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
