# RLight

> **Como se a Apple tivesse feito um app para CNC.**
>
> As interfaces de CNC open source são painéis com todo parâmetro na tela e todo
> erro em código. O RLight decide o que importa agora e esconde o resto atrás de
> bons padrões.

Um servidor na rede da oficina que nunca tira os olhos da sua CNC, e um PWA para
**ver, mexer e confiar** nela de qualquer tela: iPhone, Android, tablet ou Mac.
É grátis, não passa por loja e roda só na rede local.

**Funciona com qualquer máquina FluidNC.** O app lê da própria placa o curso, os
limites, as velocidades e o spindle, e se ajusta sozinho. Nenhum valor de máquina
está no código. A máquina de referência, onde tudo é desenvolvido e testado, é a
fresadora CNC RLight.

- **Ver:** estado, posição, avanço, rotação e trabalhos ao vivo, com o percurso sendo cortado e o tempo restante.
- **Mexer:** um pendant que parece físico, com mapa, régua de ajuste fino e zero com desfazer.
- **Confiar:** trabalhos rodam do SD, o servidor protege a máquina e avisa quando termina.

> **Estado:** o núcleo (`core/`) começou, testes primeiro, pelas partes que não
> dependem da placa: estado da conexão, movimento absoluto com limites, física da
> régua e o que cada estado da máquina permite. O protocolo da placa espera os
> dados reais do spike S1.

## Desenvolvimento

```bash
npm install
npm test          # Vitest
npm run typecheck # TypeScript estrito
```

| Módulo | O que decide | Decisão |
|---|---|---|
| [`core/src/link.ts`](core/src/link.ts) | Ao vivo ou sem sinal, há quanto tempo, qual trecho caiu | [ADR-0007](docs/adr/0007-a-conexao-vai-cair.md) |
| [`core/src/motion.ts`](core/src/motion.ts) | Destinos absolutos, curso, avanço máximo, barreira no Z0, o comando `$J=` | [ADR-0002](docs/adr/0002-movimento-por-intencoes-completas.md) |
| [`core/src/ruler.ts`](core/src/ruler.ts) | Arrasto, peteleco, destino anunciado, passo mínimo honesto, cliques | [ADR-0010](docs/adr/0010-a-regua.md) |
| [`core/src/policy.ts`](core/src/policy.ts) | O que cada estado da máquina permite, e por quê | [ADR-0005](docs/adr/0005-seguranca-o-celular-nao-e-e-stop.md) |
| [`core/src/interpolate.ts`](core/src/interpolate.ts) | O valor desenhado, um relatório atrás, sem nunca prever | [ADR-0009](docs/adr/0009-fluidez-sem-mentir.md) |

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
  - [0008 · Qualquer máquina FluidNC: tudo vem da placa](docs/adr/0008-qualquer-maquina-fluidnc.md)
  - [0009 · Fluidez sem mentir: zero atraso, números como na Apple, háptica a sério](docs/adr/0009-fluidez-sem-mentir.md)
  - [0010 · O ajuste fino é uma régua, com inércia de destino anunciado](docs/adr/0010-a-regua.md)

## Spikes

- [spikes/s1-elo](spikes/s1-elo/README.md): script somente leitura que mede a conexão com a placa e grava o tráfego real como fixture. Pronto para a bancada.
- [spikes/s3-haptica](spikes/s3-haptica/index.html): laboratório de háptica, régua e números para rodar no próprio celular.

## Aviso

Este software comanda uma máquina capaz de causar ferimentos. Ele **não**
substitui o E-stop elétrico. Ele confia na configuração da sua placa: se o
curso, os limites ou as velocidades estiverem errados lá, estarão errados aqui.
Valide a configuração da máquina antes de usar.

## Licença

[MIT](LICENSE).
