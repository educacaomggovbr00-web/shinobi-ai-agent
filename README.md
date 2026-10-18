# 🍥 Shinobi Cloud Browser — Github Codespaces + Firefox + ChatGPT

Um **navegador gráfico na nuvem**, acessível no celular, com uma **ponte experimental por GitHub** para permitir que este ChatGPT envie comandos específicos ao Firefox do Codespace. **Não é um agente autônomo 24/7 e não depende do Work.**

## ✅ O que já está configurado

- Linux + Firefox + desktop gráfico [noVNC na porta 6080](https://github.com/devcontainers/features/tree/main/src/desktop-lite)
- Firefox com página do Naruto Project RP
- `bridge/bridge.py` — monitor de comandos no repositório privado
- `bridge/command.json` — fila de **um comando por vez**
- `bridge/result.json` — aparece depois que o programa processar o primeiro comando
- Sem tokens ou cookies do Discord gravados no GitHub

## 🚀 Ativar a conexão com o ChatGPT (pelo Android)

1. Abra seu Codespace em [github.com/codespaces](https://github.com/codespaces). **Abra o EDITOR do Codespaces**, não a página do noVNC (porta 6080).
2. No editor VS Code web, vá em **Terminal → New Terminal**.
3. Cole este único comando:

```bash
cd /workspaces/shinobi-ai-agent && git pull && bash bridge/start.sh
```

4. Aguarde aparecer **Shinobi bridge ready** e depois **Saved result for setup-check...**. Mantenha o terminal aberto. Se o terminal informar `gh auth login`, siga as instruções de autenticação do GitHub CLI na interface segura.
5. Volte ao ChatGPT e diga **"Ponte ligada, confere o resultado"**. O ChatGPT consegue ler o arquivo `bridge/result.json` pela integração do GitHub e enviar um novo comando ao `bridge/command.json`.
6. Se quiser ver a área de trabalho do Codespace, volte à porta **6080**, noVNC. O navegador deverá permanecer visível nela.

**Importante:** o Codespace não fica ativo 24/7. O GitHub pode pausá-lo, e o monitor só executa comandos enquanto estiver ligado. O ChatGPT não tem acesso a uma transmissão interativa contínua da tela: cada comando passa pelo repositório, é executado pelo monitor e devolve um resultado. Isso é uma alternativa experimental, **não a interface nativa do Work**.

## 🔐 Operação e privacidade

- A porta noVNC 6080 deve permanecer **Private**.
- Não compartilhe senha do Discord, tokens de sessão ou cookies. Faça login somente dentro do Firefox remoto.
- Somente estas ações estão disponíveis: `status`, `open_url`, `get_url`, `read_page_text` (apenas canais do Naruto Project RP), `scroll`, `click` e `screenshot` (somente quando solicitado; salva imagem no repositório privado).
- O monitor não contém comandos de digitar mensagens ou publicá-las no Discord. Automatizar uma conta pessoal do Discord pode contrariar as regras da plataforma.
- **Nunca coloque a porta 6080 em Public.** Screenshots e texto copiado da página só devem ser requisitados quando necessário, pois podem conter informações sensíveis e serão salvos no repositório privado.
- Se `bridge/result.json` não aparecer, confira o terminal do Codespaces. Esse arquivo **não é prova de execução até que seja escrito pelo processo em execução**.
- O comando inicial na fila é uma checagem de status inofensiva: ele verifica se a sessão Firefox está aberta. Não envia mensagem.

## Links

- [Editor dos Codespaces](https://github.com/codespaces)
- [Desktop remoto porta 6080](https://silver-waddle-g496jj9vpvgjhpp7j-6080.app.github.dev/)
- [Servidor Naruto Project RP](https://discord.com/channels/1515877468299595919)
- [Pasta da ponte](https://github.com/educacaomggovbr00-web/shinobi-ai-agent/tree/main/bridge)
