# ADR-0002 · Movimento manual por intenções completas: o gesto nunca espera a rede

**Status:** aceito · 2026-10-16 (substitui o "jog em pedaços") · spike S2 aprovado em 2026-10-17 ([resultado](../../spikes/s2-movimento/RESULTADO-2026-10-17.md))

## Contexto

A primeira versão desta decisão fazia a máquina **seguir o dedo**: enquanto o
dedo arrastava, o servidor mandava à placa jogs de 100 ms, renovados sem parar.
Era seguro, porque se a conexão caísse a máquina parava em poucos milímetros.

Mas o jog contínuo exige um **fluxo ininterrupto** de mensagens pelo elo mais
fraco do sistema: o Wi-Fi da placa dentro do painel de aço, que já caiu várias
vezes com sinal cheio ([ADR-0007](0007-a-conexao-vai-cair.md)). Cada soluço de
300 ms esvaziaria a fila e a máquina **gaguejaria**: anda, para, anda. O gesto mais
bonito do app viraria o mais frustrante, e justamente onde o Wi-Fi é pior.

O defeito não estava no detalhe, estava no princípio: **pôr a rede dentro do
laço do gesto.**

## Decisão

**O gesto acontece inteiro no vidro. A máquina recebe só intenções completas.**

Toda a interação (arrastar, girar, os cliques, a háptica, a animação) roda no
aparelho, a 60–120 quadros por segundo, sem esperar nada da rede. Quando o gesto
termina, sai **um** comando fechado, com destino conhecido.

### Os dois gestos

**1. Grosso: arrastar o fantasma e soltar.**
Você arrasta um fantasma do spindle pelo mapa da mesa. Enquanto arrasta, **a
máquina não se mexe**: o fantasma desenha a linha do caminho e mostra as
coordenadas do destino. Ao soltar, sai um jog absoluto até aquele ponto, e o
ponto real desliza até o fantasma, ao vivo. Como soltar um alfinete no Mapas.

- O destino é recortado pelos soft limits antes de sair. O fantasma não passa da
  borda: ele bate nela com o efeito elástico.
- Durante o deslocamento, o mapa inteiro vira um botão **Parar** (cancelamento de
  jog, `0x85`).

**2. Fino: a régua** ([ADR-0010](0010-a-regua.md)).
Cada detente é sentido e desenhado na hora, localmente. O app junta os cliques
de cada ~50 ms num único comando.

### Comandos absolutos: repetir não faz mal

Numa rede que cai, um comando pode sumir sem resposta: ele foi executado ou não?
Com um movimento **relativo** (`X +0,1`), reenviar por engano dobra o movimento.
Com um **absoluto** (`vá para X = 412,40`), reenviar não muda nada.

**Todo movimento manual é absoluto, em coordenadas de máquina** (`$J=G53 …`).
O servidor mantém o **alvo comandado**. A régua incrementa esse alvo, e o
comando leva o alvo, não o incremento. Quando o sinal volta, o alvo é
reiniciado pela posição real. Isso soma com o "nunca reenviar" do ADR-0007: mesmo
uma ambiguidade não vira movimento a mais.

### Limites que viram sensação

| Regra | Como se sente |
|---|---|
| A régua não pode ficar mais que **max(2 mm, 4 passos)** à frente da posição real | Ela resiste e não avança mais: a máquina "pesa" |
| Destino fora do curso | O fantasma ou a régua param na parede |
| Descendo o Z até o zero da peça | Barreira no Z0: para passar, solte e gire de novo |
| Sem sinal | O fantasma e a régua saem de cena ([ADR-0007](0007-a-conexao-vai-cair.md)) |

### Se a conexão cair no meio

| Movimento | O que a máquina faz |
|---|---|
| Indo até o fantasma | Termina no ponto que você escolheu e viu. Nada além |
| Régua | Termina o destino já recebido (no máximo 2 mm à frente) e para |

Nos dois casos ela faz **exatamente o que foi pedido e nada mais**. Ela nunca anda
"até alguém mandar parar".

### Velocidade

Ir até o fantasma usa a velocidade máxima de cada eixo, lida da placa (desde 2026-10-17, com o S2 aprovado; antes, 2000 mm/min). Num deslocamento longo, a rampa de aceleração e frenagem do planejador do FluidNC fica visível, e o app mostra a velocidade real ao lado do ponto. A régua usa uma
velocidade que acompanha o ritmo do giro, até o mesmo teto.

### Revisão de 2026-10-17: o limite acompanha o passo

No iPhone, com o passo de 1 mm, a régua andava aos trancos. Com só 2 mm (dois
passos) à frente, cada jog terminava antes de o próximo chegar, e a máquina
acelerava e parava a cada passo. O limite à frente passou a ser
**max(2 mm, 4 passos)**, e o avanço da régua passou a crescer com o passo:
300 mm/min no 0,01, 1000 no 0,1, 2000 no 1, e o máximo do eixo no 10 e no 100.
Numa queda, a máquina continua fazendo no máximo o que a régua já mostrou.

## Critério de aceitação (spike S2)

Motor desacoplado primeiro, depois acoplado.

- **Parar:** com o link bom, o cancelamento interrompe um deslocamento em ≤ 0,3 s.
  Dez vezes.
- **Queda durante o deslocamento ao fantasma:** a máquina termina exatamente no
  destino (±0,01 mm) e não recebe nada depois da reconexão. Dez vezes.
- **Queda durante a régua:** a máquina não passa do alvo comandado. Dez vezes.
- **Comando duplicado de propósito:** reenviar o último jog não move a máquina.

## Consequências

- **O gesto nunca gagueja**, porque não depende da rede para acontecer.
- **Some o laço de jog com batimento** no servidor. Menos código, menos estado,
  menos coisa para testar e quebrar.
- Perde-se a máquina "colada" no dedo enquanto ele se move. Em troca vem a
  previsibilidade: você vê para onde ela vai antes de ela ir.
- Com o link ruim, o Parar do celular pode não chegar. Por isso todo deslocamento
  é limitado e visto antes, e o E-stop físico continua sendo o único de verdade
  ([ADR-0005](0005-seguranca-o-celular-nao-e-e-stop.md)).

## Alternativa descartada

**Seguir o dedo com jogs de 100 ms renovados** (a versão anterior desta decisão).
É segura, mas exige fluxo contínuo pelo Wi-Fi da placa e gagueja a cada soluço.
Pode voltar como opção se o spike S1 mostrar um elo muito estável, por exemplo
depois de uma antena externa ou de um módulo USB ao lado da máquina.
