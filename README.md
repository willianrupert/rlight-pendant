# RLight

> **Como se a Apple tivesse feito um app para CNC.**
>
> As interfaces de CNC open source são painéis com todo parâmetro na tela e todo
> erro em código. O RLight decide o que importa agora e esconde o resto atrás de
> bons padrões.

Um servidor na rede da oficina que nunca tira os olhos da fresadora CNC RLight
(FluidNC num ESP32), e um PWA para **ver, mexer e confiar** na máquina de
qualquer tela: iPhone, Android, tablet ou Mac. É grátis, não passa por loja e
roda só na rede local, em `https://cnc.rlight.com.br`.

- **Ver:** estado, posição, avanço, rotação e trabalhos ao vivo, com o percurso sendo cortado e o tempo restante.
- **Mexer:** um pendant que parece físico, com mapa, volante por anéis e zero com desfazer.
- **Confiar:** trabalhos rodam do SD, o servidor protege a máquina e avisa quando termina.

> **Estado:** desenho. Ainda não há código. Os spikes de validação vêm antes.

## Documentos

- **[docs/VISION.md](docs/VISION.md)**: o que é e por que é diferente. Comece por aqui.
- **[docs/DESIGN.md](docs/DESIGN.md)**: os princípios e o ofício. O critério de cada tela, gesto e palavra.
- **[docs/PRODUCT.md](docs/PRODUCT.md)**: escopo por fase, segurança, spikes e métricas.
- **Decisões (ADRs):**
  - [0001 · Um servidor no Proxmox é o único que fala com a placa](docs/adr/0001-servidor-no-proxmox.md)
  - [0002 · Movimento manual por intenções completas](docs/adr/0002-movimento-por-intencoes-completas.md)
  - [0003 · Arquitetura em camadas, core puro, testes primeiro](docs/adr/0003-arquitetura-em-camadas-e-testes-primeiro.md)
  - [0004 · PWA em vez de app nativo](docs/adr/0004-pwa-em-vez-de-app-nativo.md)
  - [0005 · Segurança: o celular não é E-stop](docs/adr/0005-seguranca-o-celular-nao-e-e-stop.md)
  - [0006 · Trabalhos rodam do SD, enviados e verificados pelo servidor](docs/adr/0006-trabalhos-rodam-do-sd.md)
  - [0007 · A conexão com a máquina vai cair: projetar para isso](docs/adr/0007-a-conexao-vai-cair.md)

## Aviso

Este software comanda uma máquina capaz de causar ferimentos. Ele **não**
substitui o E-stop elétrico. Foi feito para uma máquina específica: valores de
velocidade, curso e spindle não servem para outras sem revisão.

## Licença

[MIT](LICENSE).
