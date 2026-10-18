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
