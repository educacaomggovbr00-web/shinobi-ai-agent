# 🍥 Shinobi Cloud Browser — Naruto Project RP

Este repositório prepara **um computador Linux na nuvem com Firefox e área de trabalho gráfica**, acessível pelo navegador do celular Android. A configuração usa [GitHub Codespaces](https://docs.github.com/en/codespaces), [desktop-lite](https://github.com/devcontainers/features/tree/main/src/desktop-lite) e **noVNC**.

**Não é um agente de IA nem um self-bot.** Abrir o GitHub não autentica automaticamente no Discord: você precisa entrar no Discord **manualmente**, na janela do Firefox remoto. O navegador abre na página do servidor Naruto Project RP quando o Codespace inicia.

## 📱 Abrir pelo Android

1. Abra [Criar/retomar Codespace deste repositório](https://codespaces.new/educacaomggovbr00-web/shinobi-ai-agent?quickstart=1) no Chrome do Android e entre na sua conta GitHub.
2. Escolha a branch **main** e, se disponível, a menor máquina (**2 cores**). Confirme **Create codespace**. A primeira preparação pode levar alguns minutos.
3. Espere carregar o editor do Codespaces. Abra a aba **PORTS / PORTAS** (no painel inferior; no celular pode ser necessário usar a versão para computador).
4. Abra a porta **6080**, identificada como **Shinobi — navegador gráfico**. Mantenha a visibilidade **Private / Privada**. Caso não apareça, use a opção de adicionar/encaminhar a porta 6080.
5. A página do **noVNC** aparecerá. Toque em **Connect / Conectar** e insira a senha inicial do desktop: **`vscode`** (padrão do desktop-lite, diferente da senha do Discord).
6. Na área de trabalho Linux, o Firefox deverá abrir o [Naruto Project RP](https://discord.com/channels/1515877468299595919). Faça o login no Discord normalmente **dentro do Firefox remoto**, não no repositório.
7. Se o Firefox não abrir automaticamente, use o terminal do Codespaces:
   ```bash
   firefox-esr https://discord.com/channels/1515877468299595919
   ```

### O que a configuração já faz

- Instala Debian + Firefox ESR sem depender de Snap.
- Cria a área de trabalho Fluxbox com VNC no navegador, por meio do recurso oficial `desktop-lite`.
- Encaminha a porta **6080** para exibir a área de trabalho no Android.
- Tenta abrir o canal do Discord no Firefox quando o Codespace inicia.
- **Não** usa tokens, senhas, cookies de Discord no GitHub e **não** envia mensagens automaticamente.

### Segurança e limites

- **Nunca torne pública a porta 6080.** A porta encaminhada deve ficar em **Private**, que é o padrão no GitHub Codespaces. A senha inicial do noVNC é pública/documentada; altere-a no ambiente se for usar por mais tempo.
- Faça o login você mesmo. Nunca inclua token de usuário, código 2FA, cookies ou senha do Discord em arquivos do repositório, issues ou Actions.
- A sessão do navegador pode persistir enquanto o **mesmo Codespace** existir, mas pode exigir login novamente após reconstrução/reset.
- Codespaces **não fica ligado 24 horas sem limite**: pode pausar por inatividade e consome cotas de computação/armazenamento. Verifique seu limite antes de iniciar e não habilite cobrança por engano.
- **Esta configuração foi escrita no repositório, mas ainda precisa ser testada iniciando um Codespace.** Nenhum login do Discord foi executado.
- Para controlar este Firefox **a partir do ChatGPT normal**, ainda seria necessária uma integração própria; GitHub por si só não oferece controle remoto ao assistente desta conversa.

### Links

- [Abrir/criar Codespace](https://codespaces.new/educacaomggovbr00-web/shinobi-ai-agent?quickstart=1)
- [Gerenciar Codespaces](https://github.com/codespaces)
- [Servidor Naruto Project RP](https://discord.com/channels/1515877468299595919)
- [Documentação do desktop-lite](https://github.com/devcontainers/features/blob/main/src/desktop-lite/README.md)
- [Portas do Codespaces](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace)
