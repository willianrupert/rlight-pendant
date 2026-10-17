# ADR-0002 · Jog contínuo em pedaços curtos com watchdog

**Status:** aceito, condicionado ao spike S2 · 2026-10-16

## Contexto

O jog contínuo é o gesto principal de um pendant: segurar e a máquina anda,
soltar e ela para.

A implementação ingênua manda um jog longo (`$J=G91 X1000 F…`) ao tocar e o
cancelamento (`0x85`) ao soltar. **Se a conexão cair entre os dois, o
cancelamento nunca chega e a máquina anda até o fim do curso** (ou até o soft
limit).

Isso não é hipotético nesta máquina: a placa fica dentro de um painel metálico,
e na bancada a conexão já caiu várias vezes com o sinal marcando 100 %.

Números da máquina: 3000 mm/min no máximo em X e Y, aceleração de 250 mm/s².

## Decisão

**O jog contínuo é uma sequência de jogs curtos renovados enquanto o dedo estiver
na tela.**

| Parâmetro | Valor inicial | Por quê |
|---|---|---|
| Velocidade máxima do jog contínuo no pendant | 1500 mm/min | Metade da máxima. Ajustável depois do S2 |
| Duração de cada pedaço | 100 ms de movimento (2,5 mm a 1500 mm/min) | Curto o bastante para limitar o excesso, longo o bastante para não gaguejar |
| Pedaços na fila do planner | no máximo 2, contados pelos `ok` da placa | O planner sempre planeja parar no fim da fila |
| Ao soltar o dedo | `0x85` imediato | Para na hora, sem esperar a fila acabar |

**Excesso no pior caso**, com a placa perdendo a conexão: os pedaços já na fila,
ou seja ≤ 5 mm a 1500 mm/min, com a desaceleração incluída, porque o planner
desacelera dentro da distância enfileirada.

**Watchdog na ponte**, para quando o celular some e a placa continua conectada:

- Durante um jog, o cliente manda um batimento a cada 100 ms.
- Sem batimento por 300 ms, ou se o WebSocket do cliente fechar, a ponte manda
  `0x85` para a placa.

As duas camadas cobrem falhas diferentes: os pedaços cobrem a queda entre a
ponte e a placa, e o watchdog cobre a queda entre o celular e a ponte.

**O jog por passo** (um toque) continua sendo um único `$J=` com a distância
escolhida. Ele é limitado por natureza (no máximo 10 mm) e não precisa de
renovação.

**O core recorta o destino pelos limites conhecidos** antes de enviar, para não
gerar erro de soft limit a cada toque perto da borda.

## Critério de aceitação (spike S2)

Motor desacoplado primeiro, depois acoplado. Iniciar um jog contínuo na
velocidade máxima do pendant e desligar o Wi-Fi do celular. Depois repetir
derrubando a conexão da placa. Dez vezes cada.

- **Aprova:** excesso ≤ 6 mm em todas as repetições.
- **Reprova:** reduzir o pedaço ou a velocidade e repetir. Se não fechar, a v1
  sai **só com jog por passo**.

## Consequências

- O jog contínuo depende de um fluxo regular de mensagens. Rede ruim aparece
  como movimento entrecortado, não como movimento descontrolado. A falha é
  segura.
- A lógica de renovação e contagem de `ok` mora no core e é testável com relógio
  falso.
- A velocidade do jog contínuo fica abaixo da máxima da máquina, uma troca
  consciente de velocidade por segurança.
