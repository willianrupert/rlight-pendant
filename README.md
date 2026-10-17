# RLight Pendant

Um jog pendant para iPhone, feito como PWA, para a fresadora CNC RLight (FluidNC
num ESP32). Ele mostra a posição e o estado da máquina, move os eixos, zera,
liga e ajusta o spindle e pausa a execução. Roda só na rede local, em
`https://cnc.rlight.com.br`.

> **Estado:** desenho. Ainda não há código. Os três spikes de validação vêm antes.

## Documentos

- **[docs/VISION.md](docs/VISION.md)**: o que o app é e por que ele é diferente. Comece por aqui.
- **[docs/PRODUCT.md](docs/PRODUCT.md)**: o produto, o escopo da v1, a segurança, os princípios de experiência e os spikes.
- **Decisões (ADRs):**
  - [0001 · Hospedagem: ponte no Proxmox, só na LAN](docs/adr/0001-hospedagem-ponte-no-proxmox.md)
  - [0002 · Jog contínuo em pedaços curtos com watchdog](docs/adr/0002-jog-continuo-em-pedacos.md)
  - [0003 · Arquitetura em camadas, core puro, testes primeiro](docs/adr/0003-arquitetura-em-camadas-e-testes-primeiro.md)
  - [0004 · PWA em vez de app nativo](docs/adr/0004-pwa-em-vez-de-app-nativo.md)
  - [0005 · Segurança: o celular não é E-stop](docs/adr/0005-seguranca-o-celular-nao-e-e-stop.md)

## Aviso

Este software comanda uma máquina capaz de causar ferimentos. Ele **não**
substitui o E-stop elétrico. Foi feito para uma máquina específica: valores de
velocidade, curso e spindle não servem para outras sem revisão.

## Licença

[MIT](LICENSE).
