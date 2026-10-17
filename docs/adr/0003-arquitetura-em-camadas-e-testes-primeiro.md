# ADR-0003 · Arquitetura em camadas, core puro, testes primeiro

**Status:** aceito · 2026-10-16 (revisado: servidor e web compartilham o core)

## Contexto

O sistema comanda uma máquina que pode machucar alguém. Quase toda a lógica que
importa pode ser escrita sem rede, sem tela e sem relógio real: interpretar o
estado, decidir o que é permitido, montar comandos, limitar movimentos, analisar
G-code e estimar tempo. Se ficar assim, dá para testar tudo antes de chegar perto
da máquina.

Objetivos: manter simples, modular, fácil de manter, e escrever os testes antes
do código.

## Decisão

### Três pacotes, um core

```
core/      TypeScript puro. Sem I/O, sem DOM, sem dependências.
  protocol   relatório de estado e mensagens → tipos do domínio
  commands   G-code, $J=, bytes realtime
  policy     o que é permitido em cada estado
  motion     gesto → comando absoluto, alvo comandado, limites (ADR-0002)
  link       idade dos dados → ao vivo / sem sinal (ADR-0007), relógio injetado
  gcode      parser, limites, percurso, estimativa de tempo
server/    Node. Casos de uso + adapters: placa, navegadores, SQLite, push, SD
web/       PWA. UI + adapters de navegador (WebSocket, háptica, wake lock)
```

**Regra de dependência:** as setas apontam para dentro. O core não importa nada.
O servidor e a web importam o core. Adapters implementam portas. **A UI é um
adapter** e pode ser trocada sem tocar no resto.

**O mesmo core nos dois lados.** O servidor usa o core para decidir. A web usa o
mesmo core para desenhar o percurso e para saber o que mostrar habilitado, sem
duplicar regra.

### Stack

| Peça | Escolha | Por quê |
|---|---|---|
| Linguagem | TypeScript estrito em tudo | Uma linguagem, um core compartilhado |
| Servidor | Node, com `ws` e `better-sqlite3` | Simples, maduro, roda num LXC pequeno |
| Web | Vite + Svelte | JS pequeno, reatividade que acompanha estado a 10 Hz ou mais |
| Desenho do percurso | Canvas 2D na v2; WebGL só se a vista 3D se pagar | Começar pelo simples |
| Testes | Vitest; Playwright com WebKit e Chromium | Os motores do Safari e do Chrome |
| Repositório | Workspaces do npm | Sem ferramenta extra |

### Testes primeiro, em quatro níveis

| Nível | O que testa | Contra o quê | Quando roda |
|---|---|---|---|
| **Unidade** | core | fixtures e relógio falso | sempre, em ms |
| **Integração** | servidor de ponta a ponta | `FakeFluidNC` | sempre |
| **E2E** | PWA real no WebKit e no Chromium | servidor + `FakeFluidNC` | sempre, no CI |
| **Contrato** | o FakeFluidNC se comporta como a placa | **placa real, em bancada** | manual, marcado `@bancada` |

- **Fixtures reais:** o tráfego capturado da placa no spike S1 vira fixture. O
  parser é testado contra o que a placa manda, não contra a documentação.
- **FakeFluidNC:** um simulador do subconjunto do protocolo que o sistema usa
  (estado, `ok`/`error`, jog, `0x85`, spindle, alarmes, SD), com falhas
  injetáveis: queda de conexão, alarme no meio do jog, resposta lenta. Ele
  carrega **perfis de máquina** (a RLight, uma CoreXY, uma sem homing, uma sem
  SD), e a suíte roda contra todos. Nenhum número de máquina entra no código
  ([ADR-0008](0008-qualquer-maquina-fluidnc.md)).
- **Estimativa de tempo:** testada contra a duração real dos trabalhos rodados na
  máquina. Cada trabalho real vira um caso de teste com tolerância.
- **Cada surpresa vira teste:** todo comportamento inesperado na máquina vira
  primeiro um teste que falha, e só depois a correção.

## Consequências

- O que é perigoso (policy, jog) e o que é difícil (estimativa de tempo) são
  também os pontos mais fáceis de testar.
- O simulador precisa ser mantido. O teste de contrato é o custo disso.
- O parser exige o spike S1 antes de qualquer código de produção.
