# Protocolo navegador ↔ servidor · versão 1

O servidor do RLight é o único cliente da placa ([ADR-0001](../docs/adr/0001-servidor-no-proxmox.md)).
Os navegadores falam com ele por **WebSocket**, em mensagens **JSON**, uma por
quadro, sempre com um campo `type`. Os tipos em
[`src/messages.ts`](src/messages.ts) são a fonte de verdade; este documento os
explica.

Coordenadas em **mm, de máquina** (`MPos`). Tempos em ms.

## Do servidor para a tela

### `welcome`: logo ao conectar

```json
{ "type": "welcome", "protocol": 1, "clientId": "c3" }
```

### `profile`: o que a placa diz de si

Ao conectar (se já conhecido) e toda vez que a placa é lida de novo (`$CD` a cada
conexão com ela, [ADR-0008](../docs/adr/0008-qualquer-maquina-fluidnc.md)).

```json
{
  "type": "profile",
  "profile": { "name": "CNC RLight", "axes": { "x": { "min": 0, "max": 1215, "...": "..." } }, "...": "..." },
  "limits": { "x": { "min": 0, "max": 1215 }, "y": { "min": 0, "max": 604 }, "z": { "min": -158, "max": 0 } }
}
```

`profile` é o `MachineProfile` do core; `limits` é `limitsOf(profile)`, o curso
que o movimento usa.

### `state`: a máquina agora

No máximo **~10 por segundo por tela** (intervalo mínimo de 100 ms), a cada
relatório novo da placa e também a cada 250 ms sem relatório, para a idade andar
e o "sem sinal" aparecer.

```json
{
  "type": "state",
  "machine": {
    "state": "Idle", "subState": null,
    "mpos": { "x": 100.5, "y": 200, "z": -10 }, "wpos": null, "wco": null,
    "feed": 0, "spindle": 0, "overrides": null, "sd": null, "pins": ""
  },
  "link": { "mode": "live", "ageMs": 42, "showBack": false, "failedHop": null },
  "commanded": { "x": 100.5 },
  "homed": true,
  "control": { "inControl": true, "controlled": true }
}
```

| Campo | Significado |
|---|---|
| `machine` | O `MachineSnapshot` do core, ou `null` se a placa nunca respondeu |
| `link` | `combineLinks` do core. Do ponto de vista do servidor o trecho `server` está sempre ao vivo; **a tela deve combinar com a idade da última mensagem que ela mesma recebeu** e mostrar `failedHop: "server"` quando for ela que perdeu o servidor ([ADR-0007](../docs/adr/0007-a-conexao-vai-cair.md)) |
| `commanded` | O alvo comandado por eixo. Eixo ausente segue a posição reportada |
| `homed` | Houve homing nesta vida da placa (ou a máquina não tem homing). `jogTo` exige |
| `control.inControl` | Esta tela comanda |
| `control.controlled` | Alguma tela comanda |

### `control`: ganhou ou perdeu o controle

```json
{ "type": "control", "inControl": true }
{ "type": "control", "inControl": false, "reason": "Outra tela assumiu o controle" }
```

`reason` vem quando o controle foi tirado por outra tela. Largar por vontade
própria não traz motivo.

### `result`: resposta a um `command`

```json
{ "type": "result", "id": "r7", "ok": true }
{ "type": "result", "id": "r7", "ok": true, "hitLimit": true }
{ "type": "result", "id": "r9", "ok": true, "undoable": true }
{ "type": "result", "id": "r8", "ok": false, "reason": "Sem sinal da máquina" }
```

`id` repete o do pedido, se houver. `hitLimit` diz que o destino foi recortado
pelo curso (a régua ou o fantasma bateu na parede), ou que a rotação foi
recortada pela faixa do spindle. `undoable` vem no `zero`: dá para desfazer
com `undoZero` nos próximos 30 s. Os motivos são texto para
mostrar ao operador, vindos da policy do core ou do servidor:

| Motivo | Quando |
|---|---|
| `Sem sinal da máquina` | Placa sem relatório há mais de 2,5 s (limiar medido no spike S1), ou desconectada. **Nada fica guardado** |
| `Outra tela está no controle` | Quem pediu não tem o controle |
| `Desbloqueie a máquina primeiro`, `Espere o movimento terminar`, ... | O estado da máquina não permite ([ADR-0005](../docs/adr/0005-seguranca-o-celular-nao-e-e-stop.md)) |
| `Faça o homing para mover pelo mapa` | `jogTo` sem homing |
| `Faça o homing para mover até um ponto` | `jogAxisTo` sem homing |
| `Ainda não sei o zero atual da peça; tente de novo em instantes` | `zero` antes de a placa informar o `WCO` (sem ele não há como desfazer) |
| `Nada para desfazer` | `undoZero` sem zero recente, depois de 30 s ou pela segunda vez |
| `Esta máquina não tem spindle configurado` | `spindleOn`/`spindleSpeed` com `profile.spindle` nulo |
| `A régua está à frente da máquina` | O alvo ficaria mais de 2 mm à frente da posição real ([ADR-0002](../docs/adr/0002-movimento-por-intencoes-completas.md)) |
| `Lendo a configuração da máquina` | Movimento antes de o `$CD` chegar |
| `Posição desconhecida` | A placa não informou `MPos` |

### `alarm`: a placa entrou em alarme

Para todas as telas, quando a placa manda `ALARM:n`.

```json
{ "type": "alarm", "code": 1 }
```

### `invalid`: mensagem que o servidor não entendeu

```json
{ "type": "invalid", "reason": "Comando desconhecido: probeZ" }
```

## Da tela para o servidor

### Controle

```json
{ "type": "takeControl", "token": "<16 a 128 caracteres, aleatório, um por aba>" }
{ "type": "resumeControl", "token": "<o mesmo token>" }
{ "type": "releaseControl" }
```

Assumir é sempre explícito e sempre funciona: quem tinha o controle recebe
`control` com o motivo. `releaseControl` solta de vez.

**Uma queda curta não tira o controle.** Se a conexão de quem tem o controle cai
(tela apagada, Wi-Fi, reinício do servidor), o controle fica reservado para o
token dela por 60 s; ninguém comanda nesse meio-tempo, e as outras telas veem
`controlled: true`. A mesma aba, ao reconectar, manda `resumeControl` e recebe
`control` com `inControl: true`, ou `false` se a janela passou ou outra tela
assumiu. A reserva sobrevive a reinícios do servidor (`RLIGHT_STATE_DIR/control.json`).
Sem `token`, cair solta na hora, como na primeira versão.

### Placa de toque (tela de Automações)

```json
{ "type": "command", "id": "r9", "command": "probeZ", "thicknessMm": 10 }
```

Exige homing (a descida é limitada pelo fundo do curso do Z) e um apalpador no
perfil da placa. O servidor segue as fases pelos `[PRB:…]` da placa: desce no
máximo 15 mm a F200 até encostar, recua 1,5 mm, mede de novo a F25, zera o Z pela
coordenada do toque menos a espessura (`G10 L2 P0 Z…`) e sobe 5 mm. Todas as
telas recebem o andamento:

```json
{ "type": "probe", "status": "seeking" | "measuring" | "done" | "failed", "reason": "…", "zeroMachineZ": -50.25 }
```

### `command`

Todo comando passa por `allowed()` do core antes de chegar à placa. Sem sinal,
a resposta é imediata e nada é enfileirado nem reenviado depois
([ADR-0007](../docs/adr/0007-a-conexao-vai-cair.md)). `id` é opcional e volta no
`result`.

| Pedido | Vai para a placa |
|---|---|
| `{ "type": "command", "id": "r1", "command": "nudge", "axis": "x", "delta": 0.1, "step": 0.1 }` | `$J=G53 G90 X<alvo> F<avanço>`: o alvo comandado + `delta`, recortado pelo curso. `step` (opcional) é o passo da régua: o limite à frente vira max(2 mm, 4 passos) e o avanço cresce com ele (300 / 1000 / 2000 / máximo do eixo). Sem `step`: 2 mm e 1000 mm/min. Com `to` (o valor absoluto sob a linha da régua, em mm de máquina), o alvo é `to`, recortado pelo curso e pela folga em volta da posição real, **sem recusa**: a tela e o servidor nunca discordam do alvo, e um alvo já aceito além da folga não é puxado para trás. `delta` fica para clientes antigos |
| `{ "type": "command", "command": "jogTo", "x": 410, "y": 220 }` | `$J=G53 G90 X410.000 Y220.000 F<máximo do eixo>`, recortado pelo curso |
| `{ "type": "command", "command": "cancelJog" }` | `0x85` |
| `{ "type": "command", "command": "unlock" }` | `$X` |
| `{ "type": "command", "command": "home" }` | `$H` |
| `{ "type": "command", "command": "feedHold" }` | `!` |
| `{ "type": "command", "command": "resume" }` | `~` |
| `{ "type": "command", "command": "softReset" }` | `0x18` |

### Comandos da v1

| Pedido | Vai para a placa | Notas |
|---|---|---|
| `{ "type": "command", "command": "jogAxisTo", "axis": "z", "value": -12.5 }` | `$J=G53 G90 Z-12.500 F<avanço>` | O destino anunciado da régua ao soltar com inércia ([ADR-0010](../docs/adr/0010-a-regua.md)). Recortado pelo curso; **sem** o limite de 2 mm à frente, porque o destino foi mostrado antes. Exige homing. Avanço: a velocidade máxima do eixo (lida da placa) |
| `{ "type": "command", "command": "zero", "axis": "x" }` (ou `"all"`) | `G10 L20 P0 X0` (ou `X0 Y0 Z0`) | A posição atual vira o zero da peça no sistema ativo. O servidor guarda o offset anterior (`machine.wco`) para o desfazer. A resposta traz `"undoable": true` |
| `{ "type": "command", "command": "undoZero" }` | `G10 L2 P0 X<wco anterior> ...` | Desfaz o último zero, nos mesmos eixos. Vale por 30 s e uma vez só. Sem nada a desfazer: `ok: false`, `reason: "Nada para desfazer"` |
| `{ "type": "command", "command": "spindleOn", "rpm": 12000 }` | `M3 S12000` | Rotação recortada pela faixa do perfil (`profile.spindle`), com `hitLimit`. Sem spindle no perfil: `ok: false`, `reason: "Esta máquina não tem spindle configurado"` |
| `{ "type": "command", "command": "spindleSpeed", "rpm": 9000 }` | `S9000` | Muda a rotação com o spindle ligado. Mesmo recorte do `spindleOn` |
| `{ "type": "command", "command": "spindleOff" }` | `M5` | |

`probeZ` fica para depois (precisa da espessura da placa de toque e da
sequência segura do Romney).

Todo movimento é **absoluto, em coordenadas de máquina**: reenviar o mesmo
pedido por engano não move a máquina a mais. O avanço nunca passa do
`max_rate_mm_per_min` do eixo. O alvo comandado volta a seguir a posição real
depois de parar, cancelar, alarme ou reconexão.

## Frequência de consulta à placa

O servidor pergunta `?` à placa conforme a tabela do ADR-0001: 1/s sem ninguém
olhando, 4/s com alguma tela aberta (ou trabalho rodando), 10/s durante
movimento manual e homing.
