# Visão

> **Você não opera a máquina pelo celular. Você sente a máquina na mão.**

Todo pendant que existe é um teclado: setas, botões de passo, um seletor
×1 ×10 ×100. A tela do celular copia isso e fica pior que o original, porque
vidro não tem clique.

A ideia aqui é o contrário: **pegar o que é físico numa máquina e devolver como
toque, peso e resistência.** O volante de verdade tem detentes, e o nosso
também. O fim do curso é uma parede, e você sente a parede. A superfície da
peça se aproxima, e o volante fica mais pesado.

**O simples é belo.** A interface inteira é **uma tela, três gestos e uma folha**.

---

## Uma tela

```
┌─────────────────────────────┐
│  ONDE                       │   a mesa vista de cima, viva
│  ┌───────────────────────┐  │   o ponto é o spindle, a cruz é o zero
│  │        ·              │  │   arrastar o ponto = a máquina segue o dedo
│  │   +                   │  │
│  └───────────────────────┘  │
├─────────────────────────────┤
│  QUANTO                     │   X  412,30
│                             │   Y  118,05      tocar = escolhe o eixo
│                             │   Z   −3,20      segurar = zera (com desfazer)
├─────────────────────────────┤
│  COMO                       │
│          ╭───────╮          │   o volante
│        ╭─┤   Z   ├─╮        │   anel externo  0,01 mm por clique
│        │ ╰───────╯ │        │   anel do meio  0,1
│        ╰───────────╯        │   anel interno  1
│                             │
│  ● 12.000 rpm      ❙❙ PAUSAR │   spindle (abre a folha) · pausa sempre à mão
└─────────────────────────────┘
```

A cor de fundo é o estado da máquina: grafite em repouso, âmbar em pausa,
vermelho em alarme. **Dá para ler a três metros**, sem ler nada.

## Três gestos

### 1. Arrastar no mapa: a máquina segue o seu dedo
Encoste no ponto do spindle e arraste pela mesa. **A máquina real segue o seu
dedo**, em X e Y juntos, como arrastar uma janela. Um fantasma mostra para onde o
dedo está pedindo e o ponto real vem atrás, na velocidade da máquina. Soltou,
parou. Por baixo é o jog em pedaços do [ADR-0002](adr/0002-jog-continuo-em-pedacos.md).

É o movimento **grosso**: atravessar a mesa, chegar perto.

### 2. Girar o volante: precisão com clique
Gire o polegar em círculo. **Cada detente é um clique que você sente** e um passo
exato da máquina. Não existe seletor de passo: **o raio escolhe a resolução.**
Perto da borda o passo é fino (0,01), no meio é médio (0,1), perto do centro é
grosso (1 mm). É o mesmo princípio da barra de vídeo do iOS, onde afastar o dedo
deixa o ajuste mais fino. É previsível, sem adivinhar pela velocidade.

O volante comanda **distância, não velocidade**. Cada clique é um movimento
pequeno e fechado. Se a conexão cair, a máquina faz no máximo o que você já
girou. E se você girar mais rápido do que a máquina consegue andar, o volante
**endurece**: os cliques extras são recusados com uma batida seca. Você sente
a inércia da máquina.

É o movimento **fino**: encostar a ferramenta na peça.

### 3. Tocar e segurar nos números
- **Tocar** em X, Y ou Z escolhe o eixo do volante.
- **Segurar** zera aquele eixo. Logo depois aparece **"Desfazer"**, como no Mail.
  Zerar no lugar errado é o erro caro clássico de quem opera CNC, e aqui ele
  custa um toque.

É isso. Não há setas, abas, menus nem tela de configuração.

## Uma folha: o spindle

Tocar na pílula do spindle abre um mostrador grande, como o do Timer.
- Girar ajusta a rotação, com um clique a cada 1000 rpm e um ímã nos valores
  comuns.
- **Segurar para ligar**: o anel enche sob o dedo durante a confirmação e
  continua enchendo durante os 5 s de spin-up do inversor. A confirmação e o
  feedback são a mesma animação.
- O tempo de spin-up é estimado pela configuração. O CFW300 não informa a rotação
  real, e o app diz isso em vez de fingir que sabe.

---

## A máquina tem forma

O que torna isso diferente de um controle remoto é que **o app conhece a
máquina**, não só o protocolo:

| Momento | O que acontece |
|---|---|
| **Fim de curso** | Chegando no soft limit, os cliques ficam mais fortes e mais próximos. No limite, uma parede: o volante para com uma batida e o mapa faz o efeito elástico do iOS |
| **A peça chegando** | Descendo o Z em direção ao zero da peça, **o volante fica mais pesado**. No Z0 há uma barreira: para passar abaixo da superfície é preciso parar e girar de novo, de propósito |
| **Homing** | O mapa mostra cada eixo indo para casa na ordem real da máquina (Z, depois X, depois Y), guiado pelo status, não por uma animação pronta |
| **Alarme** | Em vez de "ALARM:1", uma frase e **uma ação**: "O fim de curso do X foi acionado. Afaste o X para a direita e desbloqueie." O botão faz exatamente isso |
| **Conexão perdida** | Tudo esmaece e nada fica pendente. Quando volta, volta inteiro |

## Uma linguagem de háptica

Cada sensação significa uma coisa só, sempre:

| Sensação | Significa |
|---|---|
| Tique leve | Um passo fino |
| Tique firme | Um passo grosso |
| Cliques ficando mais fortes | Aproximando de um limite |
| Batida seca | Parede: limite, Z0 ou máquina sem acompanhar |
| Pulso duplo e suave | Confirmado (zero, spindle no alvo) |
| Três batidas pesadas | Alarme |

## Fora da tela

O melhor pendant é o que você **não precisa pegar**:

- **Botão de Ação** (iPhone 15 Pro em diante): um aperto físico pausa a máquina.
- **Ilha Dinâmica e tela de bloqueio**: com o spindle ligado aparece
  `● 12.000 rpm · 02:14`, com um botão de pausar que funciona com o celular
  bloqueado.
- **Central de Controle**: Pausar e Desligar spindle, a um deslize.
- **Siri**: "Pausa a CNC", com as mãos ocupadas. Por voz só se para; nunca se
  liga nada.
- **Apple Watch**: a Digital Crown, que já tem detentes físicos, **é o volante**.
  Sentir o pulso quando o spin-up termina ou quando dispara um alarme, do outro
  lado da oficina.
- **Uma etiqueta NFC na máquina**: encostar o celular abre o pendant, já
  conectado.
- **Conexão zero**: o app encontra a placa sozinho na rede (Bonjour,
  `fluidnc.local`). Não há campo de endereço.

## Memória da máquina, sem pedir

- **Horímetro do spindle**, para manutenção.
- **Diário automático da sessão**: homing, zeros, alarmes, horas de spindle.
  Útil quando algo dá errado e você quer saber o que aconteceu antes.

---

## O que este app nunca vai ter

Isso faz parte do design, não é uma lista de pendências:

- Um botão de emergência. O E-stop é o vermelho, na máquina ([ADR-0005](adr/0005-seguranca-o-celular-nao-e-e-stop.md)).
- Setas de jog e seletor de passo. O mapa e o volante substituem os dois.
- Tela de configurações. O que precisa ser configurado vem da máquina.
- Tutorial. Os gestos se explicam no primeiro toque.
- Ligar qualquer coisa por voz, atalho ou relógio sem confirmação.

---

## O que isso implica para a plataforma

Quase tudo o que faz esta visão ser **sentida** só existe para app nativo:

| Ideia | PWA | Nativo |
|---|---|---|
| Mapa vivo, arrastar a máquina | ✅ | ✅ |
| Volante por raio, desfazer zero, alarme explicado | ✅ | ✅ |
| **Háptica: detentes, parede, peça chegando** | ❌ (um truque frágil, só em toque) | ✅ Core Haptics |
| Botão de Ação, Central de Controle, Siri | ❌ | ✅ App Intents |
| Ilha Dinâmica e tela de bloqueio | ❌ | ✅ Live Activities |
| Apple Watch e Digital Crown | ❌ | ✅ |
| Achar a placa sozinho (Bonjour) | ❌ | ✅ |
| Falar direto com a placa, sem servidor | ❌ (mixed content) | ✅ |

Isso muda a recomendação do [ADR-0004](adr/0004-pwa-em-vez-de-app-nativo.md).
Sem háptica, o volante vira só um desenho, e o volante é a ideia central.
O nativo também **simplifica** a arquitetura: o app fala direto com o ESP32, e a
ponte e o servidor deixam de ser necessários.

Os custos são reais: Swift em vez de TypeScript, o Apple Developer Program
(US$ 99/ano, para não reinstalar a cada 7 dias e para usar o relógio com
conforto) e um app só para Apple. A arquitetura em camadas e os testes primeiro
([ADR-0003](adr/0003-arquitetura-em-camadas-e-testes-primeiro.md)) continuam
iguais: um Swift Package de core puro com Swift Testing, um simulador e fixtures
da placa real.
