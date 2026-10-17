# RLight Pendant

Um jog pendant para o iPhone, feito para **uma** máquina: a CNC RLight. Ele roda
como PWA em `https://cnc.rlight.com.br`, só dentro da rede da oficina.

## A máquina

Uma fresadora CNC portátil construída por Romney Rupert, migrada do Mach3 para o
**FluidNC v3.9.9** numa placa **PiBot ESP32 (V4.96 Pro)** ligada por Wi-Fi.

| | |
|---|---|
| Curso útil | X 1215 · Y 604 · Z 158 mm, com soft limits ativos |
| Velocidade máxima | 3000 mm/min em X e Y, aceleração 250 mm/s² |
| Spindle | Tecmaf 2 CV com inversor WEG CFW300, comandado por PWM 0–10 V: até 18000 rpm, spin-up 5 s, spin-down 10 s |
| E-stop | Elétrico, por contator. A entrada na placa é só o aviso |

Este pendant serve a **esta** máquina. Valores como velocidades e faixa de RPM
vêm da configuração dela e não são genéricos.

> **Princípio:** é um controle remoto, não um centro de comando. Se uma função
> não serve para *mexer na máquina em pé ao lado dela*, ela não entra.

---

## Para que serve

Estar ao lado da máquina com o celular na mão e:

1. ver onde ela está e em que estado está;
2. destravar, fazer homing e zerar;
3. mover os eixos, com toque para passo fixo e segurando para jog contínuo;
4. ligar e desligar o spindle e ajustar a rotação;
5. pausar, retomar e resetar.

Tudo isso **sem abrir notebook, terminal ou a WebUI do FluidNC**.

## Para quem

Para quem opera a máquina na oficina, de pé, com uma mão livre, às vezes de
luva, com pó no ar e o spindle fazendo barulho.

---

## Escopo

### v1: pendant

| Área | Funções |
|---|---|
| **Estado** | DRO de X/Y/Z em coordenadas de trabalho (com a da máquina por baixo), estado (Idle · Jog · Run · Hold · Alarm · Door · Home) por cor e texto, avanço e rotação reais, indicador de conexão |
| **Máquina** | Unlock (`$X`), homing (`$H`), soft reset (`0x18`) |
| **Jog** | Pad XY e faixa Z separada. Passos 0,01 / 0,1 / 1 / 10 mm. Segurar = jog contínuo ([ADR-0002](adr/0002-jog-continuo-em-pedacos.md)) |
| **Zero** | Zerar X, Y, Z ou todos no sistema de trabalho ativo (`G10 L20 P0`) |
| **Spindle** | Liga (`M3 S…`), desliga (`M5`), ajusta RPM com preset e ajuste fino, mostra o spin-up (5 s) e o spin-down (10 s) do CFW300 |
| **Execução** | Feed hold (`!`), resume (`~`), overrides de avanço e de rotação (bytes realtime) |

### Fora da v1, de propósito

- Enviar arquivos de G-code. Primeiro o pendant precisa ser confiável.
- Probing.
- Os geradores conversacionais que o Romney construiu no Mach3 (CAM de peças por parâmetros). São o candidato natural para a v3.
- Editar o YAML ou configurar a placa. Isso continua com o `subir_yaml.py`.
- Vários celulares controlando ao mesmo tempo. A v1 assume um operador.
- Acesso pela internet ([ADR-0001](adr/0001-hospedagem-ponte-no-proxmox.md)).

---

## Segurança

Isto não é negociável e vem antes de qualquer tela ([ADR-0005](adr/0005-seguranca-o-celular-nao-e-e-stop.md)).

1. **O celular nunca é o E-stop.** O E-stop real é o elétrico (contator). O app
   não tem botão "emergência". Tem *pausar* e *resetar*, com esses nomes.
2. **Uma conexão perdida para a máquina.** O jog contínuo é enviado em pedaços
   curtos. Se a rede cair, a máquina para sozinha. A ponte também cancela o jog
   quando o celular some.
3. **A interface só oferece o que o estado permite.** Em Alarm não há jog. Em Run
   não há zerar. Desconectado, tudo fica cinza e nada é enfileirado para depois.
4. **Ação perigosa se confirma segurando**, nunca com um toque: ligar o spindle,
   homing, reset, zerar todos.
5. **Nada é otimista.** O DRO mostra o que a placa reportou, não o que o app
   mandou. O botão do spindle só fica "ligado" quando o status confirma.

Limite conhecido: em 16/10/2026, na bancada, a placa travou uma vez depois de um
panic: respondia pela rede e "movia" os eixos, mas não gerava STEP. O app não tem
como detectar isso. É mais um motivo para o E-stop elétrico ser o único de verdade.

---

## Princípios de experiência

| Princípio | Na prática |
|---|---|
| **Uma mão, polegar** | Tudo o que é frequente fica no terço de baixo da tela. O DRO fica em cima porque é só leitura |
| **Alvos grandes** | No mínimo 60 pt, para luva e pó. Espaço entre botões perigosos e comuns |
| **O estado é a interface** | Cor de fundo e texto mudam com o estado da máquina. Dá para entender olhando de longe |
| **Movimento com significado** | As animações mostram transições de estado reais (spin-up, homing), nunca enfeite |
| **Oficina** | Tema escuro por padrão, alto contraste, a tela não apaga (Screen Wake Lock) enquanto conectado |
| **Instalado, não navegado** | Modo standalone na tela de início, sem barra do Safari |
| **Háptica** | Desejada e ainda não garantida no Safari ([ADR-0004](adr/0004-pwa-em-vez-de-app-nativo.md)) |

---

## Arquitetura em uma figura

```
iPhone (Safari, PWA)                 Proxmox (LAN)                  Oficina
┌──────────────────────┐   wss    ┌──────────────────────────┐  ws   ┌──────────────┐
│ UI  ──▶ app ──▶ core │ ───────▶ │ Caddy ─ TLS + estáticos  │ ────▶ │ FluidNC      │
│        ▲      (puro) │          │ ponte ─ relay + watchdog │       │ ESP32 PiBot  │
│        └─ adapters   │ ◀─────── │                          │ ◀──── │ IP fixo, LAN │
└──────────────────────┘          └──────────────────────────┘       └──────────────┘
```

Camadas e testes: [ADR-0003](adr/0003-arquitetura-em-camadas-e-testes-primeiro.md).

---

## Antes de qualquer tela: três spikes

Cada spike tem um critério de aprovação escrito **antes** de rodar.

| # | Pergunta | Aprova se | Se reprovar |
|---|---|---|---|
| **S1** | O Safari no iPhone fala com o FluidNC pela ponte com fluidez? | Ida e volta mediana < 50 ms, status report estável a 10 Hz ou mais por 10 min | Investigar a rede antes de seguir. A placa fica num painel metálico e já perdeu conexão com sinal a 100 %: antena externa ou cabo |
| **S2** | O jog em pedaços para a máquina quando a rede cai? | Com o Wi-Fi do celular desligado no meio do jog, a máquina anda **≤ 6 mm** a mais na velocidade máxima do pendant. Repetido 10 vezes, com o motor desacoplado primeiro | Diminuir o pedaço ou a velocidade e repetir. Se não fechar, não há jog contínuo na v1 |
| **S3** | Dá para ter háptica no Safari? | Vibração perceptível e consistente ao tocar num botão do jog, no iOS atual | Seguir sem háptica e reavaliar o app nativo (ADR-0004) |

**Pré-requisitos de rede** (antes do S1):
- Reserva de DHCP para a placa. O IP dela já mudou uma vez entre boots.
- Entrada de DNS estático no roteador: `cnc.rlight.com.br` → container da ponte.

---

## Métricas de sucesso

- **Uso real:** nas sessões de bancada, o notebook deixa de ser aberto só para mover a máquina.
- **Tempo até o primeiro movimento:** do desbloqueio do celular ao primeiro jog em < 5 s.
- **Zero surpresas:** nenhum movimento que o operador não esperava. Cada um vira um registro no diário e um teste.

---

## Decisões

| ADR | Decisão |
|---|---|
| [0001](adr/0001-hospedagem-ponte-no-proxmox.md) | Hospedagem: ponte no Proxmox, só na LAN |
| [0002](adr/0002-jog-continuo-em-pedacos.md) | Jog contínuo em pedaços curtos com watchdog |
| [0003](adr/0003-arquitetura-em-camadas-e-testes-primeiro.md) | Arquitetura em camadas, core puro, testes primeiro |
| [0004](adr/0004-pwa-em-vez-de-app-nativo.md) | PWA em vez de app nativo |
| [0005](adr/0005-seguranca-o-celular-nao-e-e-stop.md) | Segurança: o celular não é E-stop |
