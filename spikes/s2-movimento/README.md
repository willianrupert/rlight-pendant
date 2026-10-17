# Spike S2 · movimento com a rede caindo

Confere os critérios do [ADR-0002](../../docs/adr/0002-movimento-por-intencoes-completas.md)
agindo como o app: conecta ao servidor do RLight, assume o controle e manda os
mesmos comandos.

| | Critério |
|---|---|
| A · Parar | `cancelJog` interrompe um deslocamento em ≤ 0,3 s (o script tolera +150 ms do intervalo entre relatórios) |
| B · Queda no fantasma | o celular some no meio de um `jogTo`; a máquina termina exatamente no destino (±0,01 mm) |
| C · Queda na régua | `nudge`s seguidos e o celular some; a máquina não passa do alvo comandado, nunca mais de 2 mm à frente |
| D · Duplicado | o mesmo `jogAxisTo` duas vezes não move a máquina a mais |

Tudo acontece numa caixa segura, no ar: X 300–550, Y 200–320, Z entre −10 e −2 mm
(coordenadas de máquina da máquina de referência). Se o servidor não viu um
homing, o script faz o homing primeiro.

```bash
RLIGHT_SIM_QUIET=1 npm run sim                       # ensaio contra o simulador
node spikes/s2-movimento/s2.mjs --vezes 10           # contra o servidor em ws://127.0.0.1:8787
```

Não cobre a queda entre o servidor e a placa (o Wi-Fi da placa): ela é coberta pelo
comportamento da própria placa, que termina o jog que já recebeu.
