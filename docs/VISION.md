# Visão

> **Usar esta CNC deve ser tão fácil quanto usar um micro-ondas.**
> Coloca, escolhe, aperta. E vai fazer outra coisa.

Ninguém que usa um micro-ondas pensa em magnetron, frequência ou potência em
watts. Pensa em "pipoca". Hoje, operar uma CNC exige pensar em eixos,
coordenadas, avanço e rotação. **O app existe para trocar a pergunta "como mexo
nos eixos?" por "o que vamos fazer?".**

---

## O que a impressão 3D acertou

As impressoras 3D modernas, com seus apps de iPhone, deixaram de ser um hobby de
ajuste fino e viraram eletrodoméstico. Seis lições valem para cá:

| Na impressora 3D | Lição | Na RLight |
|---|---|---|
| Nivela a mesa sozinha antes de imprimir | **A máquina se calibra, não o usuário** | Homing e Z automático pela placa de toque antes de cada trabalho |
| Você escolhe um objeto, não uma coordenada | **Pensar em peças, não em eixos** | Receitas: "aplainar esta chapa", "seis furos de 8 mm" |
| O arquivo vai para a impressora e ela imprime sozinha | **O celular é monitor, não cordão umbilical** | O trabalho roda do cartão SD da placa; o celular pode até desligar |
| Progresso e tempo restante na tela de bloqueio | **Saber sem olhar** | Live Activity com tempo restante; aviso de "Pronto" |
| Perfis de material prontos | **Bons padrões para tudo** | Material escolhido define avanço, rotação e passes |
| Uma prévia antes de começar | **Ver antes de cortar** | O percurso desenhado sobre a chapa, com tempo estimado |

## O que a CNC tem e a impressora não

É preciso ser honesto: a impressora é fácil porque o **hardware** é fechado e
calibrado. A CNC tem três coisas que nenhum app resolve sozinho:

1. **A chapa precisa ser presa**, e cada chapa vai num lugar diferente.
2. **A ferramenta muda**, e cada fresa tem um comprimento diferente.
3. **Ela é perigosa**: corta, levanta pó e pode arremessar peça.

A resposta está em padronizar o físico, como o prato do micro-ondas:

- **Um canto de referência na mesa**: um esquadro fixo numa posição de máquina
  conhecida. A chapa sempre encosta nele, e então **ninguém precisa zerar X e Y**:
  o zero já é o canto.
- **A placa de toque** (a placa já tem a entrada de apalpador ligada) para o Z
  automático. O Romney já fazia isso no Mach3, com uma rotina cuidadosa:
  recolhe o Z primeiro e desce os últimos milímetros em avanço lento.
- **Uma fresa padrão** que fica na máquina e que as receitas assumem, a menos que
  você diga outra.

**Com isso o app consegue ser micro-ondas. Sem isso, nenhum app consegue.**

---

## A jornada: cinco passos, um polegar

```
1  COLOQUE     "Encoste a chapa no canto."           ilustração da chapa no esquadro
2  ESCOLHA     Aplainar · Furos · Recorte · Texto    receitas em cartões grandes
               · Abrir arquivo
3  AJUSTE      Só o que muda: tamanho, profundidade, material    como o tempo no micro-ondas
4  CONFIRA     Prévia do percurso sobre a chapa · 12 min · checklist que a própria máquina verifica
5  SEGURE      Segurar para iniciar. Pode sair de perto.
```

**No passo 4, quem confere é a máquina, não você.** O checklist marca sozinho o
que ela consegue verificar: homing feito, Z medido, fresa padrão, percurso dentro
do curso, profundidade sem atingir a mesa (a proteção de mesa por trabalho que o
Romney tinha no Mach3). Você só confirma o que ela não vê: "chapa presa" e "óculos".

**Durante o corte**, a tela vira um relógio de micro-ondas: tempo restante grande,
o percurso sendo desenhado ao vivo sobre a chapa, e dois botões, *Pausar* e
*Parar*. Na tela de bloqueio e na Ilha Dinâmica: `12.000 rpm · faltam 07:40`.

**No fim**, como o "plim": uma vibração no pulso e uma notificação: "Pronto. O
spindle parou. Pode retirar a peça."

## As receitas

Os geradores de peça que o Romney escreveu em doze anos de Mach3 são exatamente
os botões de um micro-ondas. Eles voltam como receitas:

| Receita | Pergunta só |
|---|---|
| **Aplainar** | Tamanho da área, quanto tirar |
| **Furos** | Diâmetro, quantos, em grade ou em círculo |
| **Recorte** | Retângulo, círculo ou polígono; medidas; espessura da chapa |
| **Texto** | O texto, a altura, a fonte |
| **Abrir arquivo** | Nada: chega pelo AirDrop ou pelo app Arquivos, vindo do Fusion ou de qualquer CAM |

Cada receita é uma **função pura**: parâmetros entram, G-code sai. É o código mais
fácil de testar do projeto, e a saída de cada uma pode ser comparada com a do
gerador original do Mach3.

**O material escolhido** (MDF, compensado, acrílico, alumínio) define avanço,
rotação e profundidade por passe. Você nunca digita F ou S. Quem quiser ajustar,
ajusta, mas o padrão é bom.

---

## O celular é monitor, não cordão umbilical

O trabalho é enviado para o **cartão SD da placa** e roda de lá. Se o celular
travar, a bateria acabar ou você sair da oficina, a máquina termina a peça. O
celular só acompanha.

**Pré-requisito físico:** hoje o Wi-Fi da placa, dentro do painel metálico, falha
em envios acima de uns 3 KB. Um arquivo de trabalho tem centenas de KB. Antes da
primeira receita é preciso uma antena externa fora do painel (ou outro caminho
confiável) e um envio verificado por checksum. É o maior risco técnico desta
visão.

---

## Modo manual: os botões do micro-ondas

O micro-ondas também tem os botões de ajuste. Aqui eles são uma tela, três
gestos e uma folha, para testar, posicionar e trocar ferramenta.

```
┌─────────────────────────────┐
│  ONDE   a mesa vista de cima│   arrastar o ponto = a máquina segue o dedo
├─────────────────────────────┤
│  QUANTO   X  412,30         │   tocar = escolhe o eixo
│           Y  118,05         │   segurar = zera (com desfazer)
│           Z   −3,20         │
├─────────────────────────────┤
│  COMO     o volante         │   anel externo 0,01 · meio 0,1 · centro 1 mm
│  ● 12.000 rpm    ❙❙ PAUSAR   │
└─────────────────────────────┘
```

1. **Arrastar no mapa:** você encosta no ponto do spindle e a máquina real
   segue o seu dedo pela mesa. Soltou, parou. É o movimento grosso, e por baixo é o
   jog em pedaços do [ADR-0002](adr/0002-jog-continuo-em-pedacos.md).
2. **Girar o volante:** cada detente é um clique que você sente e um passo exato.
   **O raio escolhe a resolução**, sem seletor de passo. O volante comanda
   distância, não velocidade: se a conexão cair, a máquina faz no máximo o que você
   já girou. Se você girar mais rápido do que ela anda, o volante endurece.
3. **Tocar e segurar nos números:** tocar escolhe o eixo, segurar zera, e logo
   aparece **"Desfazer"**.

**A folha do spindle** é um mostrador grande, como o do Timer. Para ligar, você
segura e o anel enche, primeiro na confirmação e depois durante os 5 s de spin-up.

**A máquina tem forma:** chegando ao fim de curso, os cliques ficam mais fortes
até virar uma parede. Descendo o Z em direção à peça, o volante pesa, e no Z0 há
uma barreira: para passar abaixo da superfície é preciso girar de novo, de
propósito. **Um alarme vem como uma frase e uma ação**, nunca como `ALARM:1`.

---

## Uma linguagem de háptica

| Sensação | Significa |
|---|---|
| Tique leve | Um passo fino |
| Tique firme | Um passo grosso |
| Cliques ficando mais fortes | Aproximando de um limite |
| Batida seca | Parede: limite, Z0 ou máquina sem acompanhar |
| Pulso duplo e suave | Confirmado: zero, Z medido, spindle no alvo |
| O "plim" | Trabalho pronto |
| Três batidas pesadas | Alarme |

## Fora da tela

- **Live Activity e Ilha Dinâmica**: tempo restante e rotação, com *Pausar* na tela de bloqueio.
- **Notificações**: "Pronto", "Pausado: troque a fresa", "Alarme".
- **Botão de Ação e Central de Controle**: *Pausar*, com um aperto físico.
- **Apple Watch**: o "plim" no pulso, o tempo restante no mostrador e a Crown como volante no modo manual.
- **Siri**: "Pausa a CNC". Por voz só se para; nunca se liga nada.
- **AirDrop**: do Mac direto para a máquina. Na tela, aparece a prévia.
- **Etiqueta NFC na máquina** e **conexão zero** (o app acha a placa sozinho).

## Memória da máquina, sem pedir

Horímetro do spindle, histórico de trabalhos ("refazer aquele aplainamento") e um
diário da sessão para quando algo dá errado.

---

## O que este app nunca vai ter

- Um botão de emergência. O E-stop é o vermelho, na máquina ([ADR-0005](adr/0005-seguranca-o-celular-nao-e-e-stop.md)).
- Um CAM completo. Desenhos complexos vêm de fora como arquivo.
- Um editor de G-code.
- Campos F e S à vista no caminho principal.
- Tela de configurações e tutorial.
- Iniciar um corte sem segurar para confirmar, seja por voz, atalho ou relógio.

---

## Fases

| Fase | Entrega | Por quê nesta ordem |
|---|---|---|
| **v1 · O controle** | Conexão, estado, segurança, modo manual com háptica, spindle, Z automático pela placa de toque | Toda receita depende disso. É também o que já se usa hoje nos testes |
| **v2 · O primeiro micro-ondas** | **Aplainar** de ponta a ponta: receita, prévia, checklist, envio ao SD, Live Activity, "Pronto" | Uma receita só, que prova o ciclo inteiro. Aplainar é a operação mais comum e a mais simples |
| **v3 · O cardápio** | Furos, recorte, texto, abrir arquivo, materiais | As demais receitas são só funções puras novas sobre o mesmo ciclo |
| **v4 · Os olhos** | Câmera apontada para a mesa, ao vivo no app | Bom de ter. Não muda a facilidade |

Pré-requisitos físicos antes da v2: canto de referência na mesa, placa de toque e
Wi-Fi confiável até a placa.

---

## O que isso implica para a plataforma

| Ideia | PWA | Nativo |
|---|---|---|
| Receitas, prévia, mapa, volante, desfazer | ✅ | ✅ |
| **Háptica: detentes, parede, "plim"** | ❌ | ✅ Core Haptics |
| **Live Activity e Ilha Dinâmica** | ❌ | ✅ |
| **Notificação local de "Pronto"** | ⚠️ só com servidor de push | ✅ |
| **Receber arquivo por AirDrop e "Abrir com"** | ❌ | ✅ |
| Botão de Ação, Central de Controle, Siri | ❌ | ✅ App Intents |
| Apple Watch | ❌ | ✅ |
| Achar a placa sozinho (Bonjour) | ❌ | ✅ |
| Falar direto com a placa, sem servidor | ❌ (mixed content) | ✅ |

Os apps de impressora 3D que servem de inspiração são nativos, e não é por
acaso. **O micro-ondas pede o nativo**, e o nativo ainda tira o servidor do
caminho: o app fala direto com o ESP32.

Os custos: Swift no lugar de TypeScript, o Apple Developer Program (US$ 99/ano)
e um app só para Apple. A arquitetura em camadas e os testes primeiro
([ADR-0003](adr/0003-arquitetura-em-camadas-e-testes-primeiro.md)) seguem
iguais: um Swift Package de core puro (protocolo, policy, jog, **receitas**),
com Swift Testing, simulador e fixtures da placa real.
