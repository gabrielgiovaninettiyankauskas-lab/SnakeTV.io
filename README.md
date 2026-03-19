# SnakeTV Online

Projeto inicial de um jogo da cobrinha online para navegador, pensado para TV browser e desktop. O controle principal usa as setinhas do teclado ou do controle da TV.

## O que ja esta pronto

- Lobby com criar sala e entrar por codigo
- Escolha opcional de cor da cobrinha antes de entrar
- Salas com ate 4 jogadores
- Contagem regressiva compartilhada de 10 segundos antes da rodada
- Jogo em tempo real com WebSocket
- Servidor autoritativo para comida, colisao e placar
- Cada cobrinha com 2 vidas por rodada
- Imunidade de 3 segundos ao nascer e ao renascer
- Nome do jogador desenhado acima da cobrinha
- Modo visual focado em TV durante a partida
- Frontend em HTML, CSS e JavaScript puro
- Backend em Node.js puro, sem dependencias externas
- Arquivo `render.yaml` para facilitar deploy no Render

## Estrutura

- `server.js`: servidor HTTP + WebSocket + regras do jogo
- `public/index.html`: interface
- `public/styles.css`: visual da pagina
- `public/app.js`: cliente, lobby, canvas e input
- `render.yaml`: configuracao inicial para Render

## Como rodar localmente

1. Instale o Node.js 18 ou superior.
2. Abra a pasta do projeto no terminal.
3. Rode:

```bash
npm start
```

4. Abra `http://localhost:3000`.

## Como publicar no Render

1. Suba esta pasta para um repositorio Git.
2. No Render, crie um novo Web Service.
3. Use Node como ambiente.
4. Comando de start:

```bash
node server.js
```

5. Se quiser, voce pode usar o `render.yaml` deste projeto.

## Proximos passos sugeridos

- Adicionar tela de nome da partida e limite de rounds
- Melhorar reconexao para jogador cair e voltar
- Adicionar efeitos sonoros e feedback visual de eliminacao
- Criar modo ranked ou partidas privadas com senha
