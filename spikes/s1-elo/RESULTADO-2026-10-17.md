# Spike S1 · resultado de 2026-10-17

Uma hora na máquina de referência (FluidNC v3.9.9, PiBot ESP32, Wi-Fi dentro do
painel metálico), com o painel energizado. O script rodou de um Mac na mesma rede,
por Wi-Fi; o roteador estava a um salto.

## Números

| | |
|---|---|
| Duração | 60 min |
| Conexões | **1** (nenhuma queda) |
| Relatórios | 35.636 · **9,9 por segundo** |
| Tempo de resposta do `?` | mediana 28 ms · p95 76 ms · máx 1,5 s |
| Pausas > 1 s | **13** · a maior com 1,57 s · nenhuma > 2 s |
| Estados vistos | Alarm, Home, Idle, Jog |
| Ping para a placa (0,2 s, 50 min) | 0,11 % perdidos · mediana 12 ms · p99 81 ms |
| Ping para o roteador, em paralelo | 0,01 % perdidos · mediana 3 ms · p99 7 ms |

Os quatro critérios automáticos passaram: frequência, nenhuma lacuna > 2 s,
reconexão (não foi preciso) e no máximo uma queda por hora.

## As pausas e suas duas causas

| | Pausas > 1 s por hora |
|---|---|
| WebUI do FluidNC aberta no Mac (21,7 min) | **27,6** |
| WebUI fechada (38,3 min) | **4,7** |

1. **A WebUI.** Cada pedido dela trava a placa por cerca de 1 s. Sem cartão SD, cada
   pedido também dispara uma leitura do cartão que falha devagar
   (`[MSG:ERR: sdmmc_card_init failed code 0x108]`). Confirmado recarregando a
   página: a pausa veio no mesmo segundo.
2. **O Wi-Fi da placa.** Com a WebUI fechada, ainda há perda de pacote ocasional no
   rádio da placa (o Wi-Fi do Mac estava limpo no mesmo período). Cada perda vira
   uma pausa de 1,1 a 1,6 s enquanto o TCP reenvia. Não derruba a conexão.

## Decisões tomadas a partir disto

- **ADR-0007:** o limiar de "sem sinal" sobe de 1 s para **2,5 s**. Com 1 s, a tela
  piscaria a cada reenvio do TCP.
- **ADR-0001:** a WebUI sai do ESP32 quando o app cobrir o uso diário, com as
  condições registradas lá.
- **ADR-0002 confirmado na prática:** com o jog "seguir o dedo", cada pausa seria um
  tranco na máquina; com destinos completos, ela nem percebe.
- **Cartão SD:** a placa está sem cartão. É pré-requisito da v2 (ADR-0006).

## O que ficou para depois

- **Impacto da telemetria num corte** (rodar o mesmo arquivo com o S1 a 10 Hz e a
  1 Hz e comparar o tempo): precisa do cartão SD.
- **Repetir com o cartão SD** e com a WebUI aberta, para ver se a urgência de tirá-la
  cai.
- **Rodar do servidor cabeado no Proxmox**, o caminho real, em vez do Mac.

## Fixtures gravadas

Em `core/test/fixtures/fluidnc-3.9.9/`, sem os dados da rede: preâmbulo, saída de
`$CD`, relatórios em Alarm, durante o homing (com `Pn:X`) e durante um jog do Z.
