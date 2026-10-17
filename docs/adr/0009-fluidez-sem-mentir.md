# ADR-0009 · Fluidez sem mentir: zero atraso no toque, números que se movem como na Apple

**Status:** aceito · 2026-10-16 · spike S3 concluído no mesmo dia

## Contexto

O RLight deve parecer o painel de uma CNC muito cara: liso, imediato e preciso.
Duas forças puxam em direções opostas:

- **Fluidez:** a tela atualiza a 60–120 quadros por segundo, mas a placa manda
  4 a 10 relatórios por segundo. Mostrar cada relatório cru faz o DRO pular de
  dez em dez quadros.
- **Verdade:** a tela nunca mente ([ADR-0007](0007-a-conexao-vai-cair.md)). Um
  número na tela precisa ser um número que a máquina reportou.

## Decisão

### 1. O toque responde no mesmo quadro, sempre

Tudo o que o dedo faz tem resposta **local**, no mesmo quadro, antes de qualquer
rede: o fantasma, a régua, o anel de segurar, os cliques e a háptica
([ADR-0002](0002-movimento-por-intencoes-completas.md)). A rede só carrega o
resultado. Por isso a sensação de atraso zero não depende do Wi-Fi.

### 2. Interpolar, nunca extrapolar

O app desenha a posição **um relatório atrás**, deslizando suavemente entre os
dois últimos relatórios reais, como os jogos online fazem com outros jogadores.

```
relatórios:   ●─────────●─────────●          (10 por segundo)
tela:              ╰── desliza entre dois pontos reais, 120 quadros por segundo
```

- **Cada número na tela fica entre dois valores que a máquina realmente
  reportou.** Nada é inventado nem previsto.
- O custo é um atraso fixo de um intervalo: 100 ms em movimento manual, 250 ms
  assistindo um trabalho. É imperceptível, porque o gesto já respondeu localmente.
- Durante um trabalho, o deslizamento segue **o percurso conhecido** entre os
  dois pontos, não uma reta. A ferramenta faz a curva junto com a máquina.
- **Sem sinal, o deslizamento para no último valor real** e o número esmaece
  (ADR-0007). Nunca continua andando por conta própria.

### 3. Números como a Apple faz

O DRO é o elemento mais olhado do app, e é tratado como tal:

- **Dígitos de largura fixa** (`ui-monospace`, `tabular-nums`): a vírgula nunca
  anda e o número nunca "dança".
- **Cada dígito rola sozinho**, com mola, como o `numericText` do iOS: quando
  `412,30` vira `412,31`, só o último dígito se move, na direção da mudança.
  Quando o número muda rápido demais para rolar (em movimento), os dígitos
  trocam sem animação e só a posição desliza. Rolagem é para mudanças que o olho
  acompanha.
- **Sem tremor:** se a leitura oscila na última casa sem a máquina se mover, o
  app segura o valor (histerese de meio dígito). Parada é parada.
- **Hierarquia dentro do número:** inteiros fortes, decimais um tom abaixo,
  unidade pequena. `412`**`,30`** lê-se de longe e de perto.
- **O sinal tem lugar reservado:** `−3,20` e ` 3,20` ficam alinhados pelo
  dígito, e o sinal de menos é o tipográfico (`−`), não o hífen.
- **Contadores de tempo** (faltam, decorrido) rolam por segundo; o tempo
  restante nunca sobe aos saltos: correções suaves de até 2 s por segundo.

### 4. O caminho quente fica fora do framework

O estado que muda 120 vezes por segundo (posição desenhada, dígitos, percurso)
**não passa pela reatividade do Svelte.** Um laço único de
`requestAnimationFrame` lê o último estado e escreve direto em `transform`, em
texto e no canvas. O framework cuida do que muda raramente (telas, estados,
folhas). Só `transform` e `opacity` são animados.

### 5. Háptica levada a sério

A háptica faz o vidro parecer mecanismo, e merece engenharia, não um detalhe:

- **Uma porta `Haptics`** com o vocabulário do produto (`tick`, `firme`,
  `crescendo`, `parede`, `confirmado`, `alarme`), nunca chamadas soltas.
- **Android:** `navigator.vibrate` com padrões curtos (5 a 15 ms), afinados num
  aparelho real.
- **iPhone: não há háptica por web.** Medido no spike S3, num iPhone com
  iOS 26.5, em página direta (sem iframe): o switch nativo vibra quando o
  **dedo** o toca, mas acioná-lo por código não vibra. Foram mais de 230
  tentativas em quatro variantes do truque, e nenhuma vibrou. O truque que
  funcionava no iOS 18 foi fechado. No iPhone, a sensação mecânica vem do **som e
  do movimento**, desenhados para isso (abaixo).
- **A forma do ajuste fino foi decidida no teste:** uma régua linear com
  inércia de destino anunciado ([ADR-0010](0010-a-regua.md)). A catraca, que
  prendia o controle no dente, perdeu a fluidez e saiu.
- **Som de detente** na régua, curto e suave, desligável. É o substituto da
  háptica no iPhone e um reforço no Android.

O laboratório do spike S3 fica em `spikes/s3-haptica/` e roda no próprio
aparelho.

## Consequências

- A fluidez vem do app e a verdade vem da máquina, sem conflito entre as duas.
- O "um relatório atrás" vira regra testável no core: dado um par de relatórios
  e um instante, o valor desenhado está sempre entre eles.
- O caminho quente sem framework exige disciplina: uma camada pequena e bem
  testada, com orçamento de desempenho no CI (zero quadros perdidos num arrasto
  gravado).
- No iPhone não há vibração. O app é completo sem ela: som, lingueta e
  movimento carregam a sensação. Se um dia valer pagar por háptica real no
  iPhone, um app nativo pode ser só mais um cliente do mesmo servidor
  ([ADR-0004](0004-pwa-em-vez-de-app-nativo.md)).
