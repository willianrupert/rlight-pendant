# Design

> **Como se a Apple tivesse feito um app para CNC.**

As interfaces de CNC open source são painéis de controle: todo parâmetro na
tela, todo código de erro cru, um botão para cada comando do firmware. Elas foram
feitas por quem entende a máquina, para quem entende a máquina.

A lição da Apple não é estética. É **decidir o que importa agora e esconder o
resto atrás de bons padrões.** Este documento é o critério de cada tela, cada
gesto e cada palavra do RLight. Quando houver dúvida, ele decide.

---

## Princípios

### 1. Uma coisa por vez
Cada estado da máquina tem uma tela que mostra o que importa **naquele estado**.
Em repouso: onde ela está. Cortando: quanto falta. Em alarme: o que aconteceu e o
que fazer. Nada aparece "por via das dúvidas".

### 2. Manipulação direta
Você mexe na coisa, não num controle que representa a coisa. O spindle é um
ponto que você arrasta na mesa. A precisão é um volante que você gira. Um eixo se
zera segurando o número dele.

### 3. A tela nunca mente
Um número nítido é atual. Um número velho parece velho e diz a idade. Um comando
enviado aparece como pendente até a máquina confirmar. Nada é otimista
([ADR-0007](adr/0007-a-conexao-vai-cair.md)).

### 4. Perdão
Errar custa pouco: zerar tem desfazer, o perigoso se confirma segurando e o
*Parar* está sempre a um toque. O caro nunca acontece por acidente.

### 5. Silêncio no normal, clareza no anormal
Nenhum ícone de "conectado", nenhum verde comemorando que está tudo bem. Quando
algo sai do normal, a tela inteira muda e diz o quê, em português.

### 6. Feito para a mão e para a oficina
Uma mão, o polegar, de pé, de luva, com pó e barulho. Alvos grandes, contraste
alto, leitura a três metros, tela acesa enquanto você trabalha.

### 7. Zero configuração
A máquina conta ao app quem ela é. Curso, limites, velocidades e homing vêm da
configuração da própria placa. Não existe tela de configurações.

---

## Palavras

| Nunca | Sempre |
|---|---|
| `ALARM:1` | "O fim de curso do X foi acionado." e a ação que resolve |
| `error:15` | "Esse movimento passa do curso do Y." |
| "Feed hold", "Cycle start" | "Pausar", "Retomar" |
| "Soft reset" | "Resetar" |
| "WCO", "G54" | "Zero da peça" |
| "Conexão estabelecida com sucesso!" | Nada. Normal não precisa de aviso |
| "Erro de comunicação" | "Sem sinal da máquina · há 4 s" |

- Verbo primeiro nos botões, uma a três palavras.
- Todo número tem unidade, ou o contexto a deixa óbvia.
- Vírgula decimal e ponto de milhar: `412,30` e `12.000 rpm`.
- O G-code existe, mas fica atrás da interface, para quem pedir.

---

## O ofício na web

Um PWA pode parecer nativo quando cada detalhe é tratado. Estes são os
detalhes.

### Tipografia
- `system-ui` para texto: San Francisco no iPhone e no Mac, Roboto no Android.
  Sem fonte baixada.
- `ui-monospace` com `font-variant-numeric: tabular-nums` para coordenadas: os
  dígitos não dançam quando o número muda.
- Três tamanhos e dois pesos. O DRO é o maior elemento da tela.
- Respeita o tamanho de texto do sistema.

### Cor
- Tokens semânticos, nunca hex solto: `--estado-repouso`, `--estado-movendo`,
  `--estado-pausa`, `--estado-alarme`, `--velho` (dado sem sinal).
- Escuro por padrão. Claro disponível, seguindo o sistema.
- **O estado é a cor do fundo**, em tons profundos e calmos. Vermelho só em
  alarme, para que vermelho sempre signifique alarme.
- Contraste AA no mínimo, AAA nos números.

### Movimento
- **Molas, não curvas fixas.** Animações com física de mola (`linear()` gerado
  de uma mola), que podem ser interrompidas no meio sem pulo.
- Só `transform` e `opacity`, para manter 120 Hz no ProMotion e 60 Hz no resto.
- Toda animação significa algo real: o fantasma voltando da borda, o anel do
  spin-up, o percurso acendendo. Nenhuma é enfeite.
- **View Transitions** entre telas, para que um elemento continue sendo ele mesmo
  quando a tela muda.
- `prefers-reduced-motion` troca movimento por fade.

### Toque
- Pointer Events, `touch-action` explícito, sem atraso de toque, sem destaque
  azul, sem zoom acidental, sem seleção de texto em controles.
- Resposta visual no mesmo quadro do toque (< 16 ms), antes de qualquer rede.
- `overscroll-behavior: none` e áreas seguras (`env(safe-area-inset-*)`)
  respeitadas, sem nada sob a ilha nem sob a barra de gestos.
- Alvos de no mínimo 60 pt. Os perigosos ficam longe dos comuns.

### Háptica e som
Uma linguagem só ([VISION.md](VISION.md#mexer-um-pendant-que-parece-físico)):
tique leve, tique firme, cliques crescendo, batida seca, pulso duplo, três
batidas. Vibração no Android, truque experimental no iPhone e som curto
opcional em todos ([ADR-0004](adr/0004-pwa-em-vez-de-app-nativo.md)). Nenhuma
informação depende só de vibração.

### Instalado, não navegado
`display: standalone`, ícone e tela de abertura próprios, cor da barra de status
seguindo o estado e a casca do app em cache: abre na hora, mesmo antes de
conectar.

### Acessibilidade
VoiceOver e TalkBack leem o estado, as coordenadas e cada ação. O volante tem
alternativa por botões para quem não pode girar. A cor nunca é a única pista.

### Desempenho
| Orçamento | Limite |
|---|---|
| JavaScript na primeira carga | < 100 KB comprimido |
| Abrir o app instalado até ver a máquina | < 1 s na LAN |
| Toque até resposta visual | < 16 ms |
| Quadros perdidos durante gestos | zero |

---

## Todo estado é desenhado

Antes de uma tela ser feita, cada um destes estados tem desenho:

- Primeira abertura, sem nenhum dado ainda.
- Ao vivo.
- Sem sinal: do celular, do servidor ou da máquina.
- A máquina controlada por outro programa.
- Alarme, com cada causa conhecida.
- Placa reiniciada.
- Outra pessoa com o controle.
- Trabalho rodando, pausado, terminado e interrompido.

Spinner sem contexto não existe. Se algo demora, a tela diz o quê.

## O teste final

Antes de uma tela ser considerada pronta:

1. **Alguém que nunca viu uma CNC** entende o que a máquina está fazendo em 3 s?
2. **Quem opera há anos** faz o que precisa sem procurar?
3. **Dá para usar de luva**, com uma mão, a um braço de distância?
4. **Com o Wi-Fi caindo** ela continua honesta?
5. **Dá para tirar mais alguma coisa?** Se sim, tira.
