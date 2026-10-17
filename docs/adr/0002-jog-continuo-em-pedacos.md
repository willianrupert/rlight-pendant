# ADR-0002 · Jog em pedaços curtos, decidido no servidor

**Status:** aceito, condicionado ao spike S2 · 2026-10-16 (revisado: o laço foi para o servidor)

## Contexto

O jog contínuo, em que a máquina anda enquanto o dedo está na tela, é o gesto
principal do modo manual. Isso inclui arrastar o ponto no mapa.

A implementação ingênua manda um jog longo (`$J=G91 X1000 F…`) ao tocar e o
cancelamento (`0x85`) ao soltar. **Se a conexão cair entre os dois, a máquina
anda até o fim do curso.**

Esta máquina tem histórico: a placa fica dentro de um painel metálico e, na
bancada, a conexão caiu várias vezes com o sinal marcando 100 %.

Há dois trechos que podem cair:
1. **celular → servidor** (Wi-Fi do celular);
2. **servidor → placa** (Wi-Fi da placa).

Números da máquina: até 3000 mm/min em X e Y, aceleração de 250 mm/s².

## Decisão

**O celular manda intenção, não comandos.** Enquanto o dedo está na tela, ele
manda "quero ir nesta direção, nesta velocidade" com um batimento a cada
100 ms. **O servidor transforma a intenção em jogs curtos** e os entrega à
placa.

| Parâmetro | Valor inicial |
|---|---|
| Velocidade máxima do jog contínuo | 1500 mm/min (ajustável depois do S2) |
| Cada pedaço | 100 ms de movimento: 2,5 mm a 1500 mm/min |
| Pedaços na fila da placa | No máximo 2, contados pelos `ok` |
| Dedo solto | O celular avisa e o servidor manda `0x85` na hora |
| Sem batimento por 300 ms | O servidor manda `0x85` |
| WebSocket do celular fechou | O servidor manda `0x85` |

**Cobertura das falhas**
- **Cai o celular:** o servidor percebe em até 300 ms e cancela.
- **Cai a placa:** ela termina o que já tem na fila, ≤ 5 mm a 1500 mm/min, com a
  desaceleração incluída, e para sozinha.

**O volante é diferente.** Cada detente vira um movimento pequeno e fechado.
Não há "andar até soltar". Se a conexão cair, a máquina faz no máximo o que já foi
girado. O servidor limita quanto o volante pode ficar à frente da máquina: os
cliques além disso são recusados, e o app avisa com uma batida.

**O core recorta o destino pelos soft limits** antes de enviar.

## Critério de aceitação (spike S2)

Motor desacoplado primeiro, depois acoplado. Começar um jog contínuo na
velocidade máxima e (a) desligar o Wi-Fi do celular, (b) derrubar a conexão da
placa. Dez vezes cada.

- **Aprova:** em (a), a máquina para em ≤ 0,5 s. Em (b), anda ≤ 6 mm a mais.
- **Reprova:** reduzir o pedaço ou a velocidade. Se não fechar, a v1 sai só com
  o volante.

## Consequências

- A lógica fica num só lugar, no servidor, testável com relógio falso.
- O celular é fino: gestos viram intenções.
- Rede ruim aparece como movimento entrecortado, nunca como movimento
  descontrolado.
