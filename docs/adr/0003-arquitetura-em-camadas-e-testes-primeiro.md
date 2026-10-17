# ADR-0003 · Arquitetura em camadas, core puro, testes primeiro

**Status:** aceito · 2026-10-16

## Contexto

O pendant comanda uma máquina que pode machucar alguém. Quase toda a lógica que
importa (interpretar o status, decidir o que é permitido, montar comandos,
renovar o jog) pode ser escrita sem rede, sem tela e sem relógio real. Se ficar
assim, dá para testar exaustivamente antes de chegar perto da máquina.

Objetivos: manter simples, modular, fácil de manter, e escrever os testes antes
do código.

## Decisão

### Camadas

```
core/        TypeScript puro. Sem I/O, sem DOM, sem dependências.
  protocol   parser de status report e mensagens  →  tipos do domínio
  commands   construtores de comando (G-code, $J=, bytes realtime)
  policy     o que é permitido em cada estado da máquina
  jog        política do jog contínuo (ADR-0002), com relógio injetado
app/         casos de uso: Jog, Spindle, Home, Unlock, Zero, Hold/Resume
ports/       interfaces: MachineLink, Clock, Haptics, WakeLock
adapters/    WebSocketLink · FakeFluidNC · UI
```

**Regra de dependência:** as setas só apontam para dentro. O core não importa
nada. O app importa core e ports. Adapters implementam ports. A UI é um adapter
e pode ser trocada sem tocar no core.

### Repositório

```
core/    pacote compartilhado
pwa/     o app (UI + adapters de navegador)
ponte/   o processo do ADR-0001
```

Um repositório com workspaces de npm. TypeScript em modo estrito nos três.

### Stack

- **Vite + TypeScript** no PWA.
- **Svelte** na UI: compila para JS pequeno, sem runtime pesado, e com
  reatividade que combina com um status chegando a 10 Hz. Por ser adapter, trocar
  de framework custa só a UI.
- **Node** na ponte, para usar a mesma linguagem e as mesmas ferramentas.
- **Vitest** para unidade e integração, **Playwright com WebKit** para e2e
  (o motor do Safari).

### Testes primeiro, em quatro níveis

| Nível | O que testa | Contra o quê | Quando roda |
|---|---|---|---|
| **Unidade** | core: parser, comandos, policy, jog | fixtures e relógio falso | sempre, em ms |
| **Integração** | casos de uso de ponta a ponta | `FakeFluidNC` | sempre |
| **E2E** | PWA no WebKit | `FakeFluidNC` atrás da ponte | sempre, no CI |
| **Contrato** | o FakeFluidNC se comporta como a placa | **placa real, em bancada** | manual, marcado `@bancada` |

- **Fixtures reais:** o tráfego capturado da placa no spike S1 vira arquivo de
  fixture. O parser é testado contra o que a placa realmente manda, não contra o
  que a documentação promete.
- **FakeFluidNC:** um simulador do subconjunto do protocolo que o pendant usa
  (status, `ok`/`error`, jog, `0x85`, spindle, alarmes). Permite desenvolver sem
  a máquina e reproduzir falhas: queda de conexão, alarme no meio do jog,
  resposta lenta.
- **Teste de contrato:** a mesma suíte de integração rodando contra a placa real.
  É o que impede o simulador de divergir da realidade.
- **Cada surpresa vira teste:** todo comportamento inesperado na máquina vira
  primeiro um teste que falha no core ou no simulador, e só depois a correção.

## Consequências

- O que é perigoso (policy e jog) é também o que é mais fácil de testar.
- O simulador é um pequeno produto à parte e precisa ser mantido. O teste de
  contrato é o custo disso.
- Escrever o parser contra fixtures exige o spike S1 antes de qualquer código
  de produção.
