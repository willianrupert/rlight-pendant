# ADR-0008 · Qualquer máquina FluidNC: tudo vem da placa

**Status:** aceito · 2026-10-16

## Contexto

O RLight nasceu para uma máquina: a CNC RLight. Mas o problema que ele resolve
não é dela. As interfaces de CNC open source são primitivas para todo mundo que
usa FluidNC.

O princípio "zero configuração" do [DESIGN.md](../DESIGN.md) já pedia que a
máquina contasse ao app quem ela é. Levado até o fim, ele faz o app servir para
qualquer máquina FluidNC sem custo extra.

## Decisão

**O RLight funciona com qualquer máquina FluidNC.** A CNC RLight é a **máquina de
referência**: é nela que se desenvolve e se testa, mas **nenhum valor dela está
no código.**

### O que vem da placa

Ao conectar, e de novo a cada reinício da placa, o servidor lê a configuração em
execução (o YAML que o FluidNC carregou) e os parâmetros e offsets vigentes, e
monta o **perfil da máquina**:

| Do perfil | Usado para |
|---|---|
| Nome da máquina | Título do app |
| Eixos presentes | Quais números e controles aparecem |
| Curso, soft limits e direção do homing | O mapa da mesa, as paredes do fantasma e do volante |
| Homing configurado ou não | Se o fantasma existe (sem homing, a posição de máquina não significa nada e só o volante aparece) |
| Velocidade e aceleração máximas | Tetos dos movimentos e a simulação de tempo |
| Spindle: tipo, faixa de rotação, spin-up e spin-down | O mostrador e a animação do spin-up |
| Apalpador presente | Se o Z automático aparece |
| Cartão SD presente | Se trabalhos podem rodar da placa ([ADR-0006](0006-trabalhos-rodam-do-sd.md)) |

**Se a configuração da placa muda, o app muda junto.** Não há cópia para
desatualizar.

### O que a placa não sabe

Poucas coisas não existem na configuração do FluidNC. O app pergunta **uma vez**,
na primeira conexão, só o necessário, e guarda no servidor:

- **A profundidade da mesa**, para a proteção contra cortar a mesa. Pode ser
  medida com o apalpador, em vez de digitada.
- **O lado da máquina em que o operador fica**, para orientar o mapa como a
  pessoa vê a mesa.

Tudo mais tem padrão bom e não pergunta nada.

### Escopo suportado

| Suportado na v1 | Fica para depois |
|---|---|
| Cinemática cartesiana, incluindo CoreXY (os eixos continuam sendo X e Y) | Cinemáticas não cartesianas |
| X, Y e Z; eixos extras aparecem só como leitura | Controle de eixos rotativos |
| Spindles com rotação comandada (PWM, 0–10 V, relé) | Laser com modo dinâmico, plasma |
| FluidNC 3.x por WebSocket | Grbl clássico, grblHAL |

O protocolo de status é muito parecido no Grbl e no grblHAL. Isolá-lo no core
([ADR-0003](0003-arquitetura-em-camadas-e-testes-primeiro.md)) mantém essa porta
aberta sem prometer nada agora.

### Instalação para outras pessoas

O servidor roda em **qualquer computador sempre ligado na rede**: um Proxmox, um
Raspberry Pi, um NAS. Ele é distribuído como uma imagem de container com um
`compose.yaml` de poucas linhas. A instalação de referência é a da RLight
([ADR-0001](0001-servidor-no-proxmox.md)).

## Consequências

- **Nenhum número de máquina no código.** Isso é verificado em teste: o
  FakeFluidNC carrega perfis diferentes (a RLight, uma CoreXY pequena, uma máquina
  sem homing, uma sem SD), e a suíte inteira roda contra todos.
- **O teste de contrato continua sendo na RLight real.** Ela é a única máquina
  física de referência.
- **O maior obstáculo para outras pessoas é o HTTPS.** Sem ele não há PWA
  instalável nem push ([ADR-0001](0001-servidor-no-proxmox.md)). A instalação de
  referência usa domínio próprio com DNS-01. Caminhos mais simples para quem não
  tem domínio ficam documentados como questão aberta.
- O app ganha uma tela de primeira conexão. Ela pergunta só o que a placa não
  sabe, e só uma vez.
