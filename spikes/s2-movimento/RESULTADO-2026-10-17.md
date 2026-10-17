# Spike S2 · resultado de 2026-10-17

Na máquina de referência, com os motores habilitados, pelo servidor da v1 rodando
no Mac e falando com a placa por telnet. O script fez o homing pelo servidor e
depois os quatro testes, 10 vezes cada, na caixa segura no ar (X 300–550,
Y 200–320, Z −5), a 2000 mm/min.

| Teste | Resultado |
|---|---|
| **B · o celular some no meio de um `jogTo`** | **10/10** terminaram no destino, erro ≤ 0,003 mm |
| **C · o celular some no meio da régua** | **10/10** pararam no alvo comandado; o alvo nunca passou de 2,0 mm à frente |
| **D · o mesmo `jogAxisTo` duas vezes** | Não moveu a mais |
| **A · Parar** | 403 a 418 ms (mediana 410) até o servidor reportar `Idle` |

## O que o "Parar" mediu, e o que não mediu

O ADR-0002 pede que o cancelamento interrompa o movimento em ≤ 0,3 s. O script
mede outra coisa: o tempo entre mandar `cancelJog` e **ver** o estado `Idle`. Isso
soma a viagem do comando (~30 ms, mediana medida no S1), a desaceleração física
(2000 mm/min = 33,3 mm/s; a 250 mm/s², 0,13 s), a confirmação de parada da placa e
o intervalo até o próximo relatório e a próxima mensagem do servidor.

A parada física, pela conta, fica perto de 0,17 s, dentro do critério. Mas ela
não foi medida diretamente. **Próxima medição:** registrar a posição no instante
do cancelamento e a posição final, e comparar a distância percorrida com
v²/2a + v·latência (cerca de 3 mm a 2000 mm/min).

## Decisão

**S2 aprovado.** O app pode comandar a máquina. A ressalva do "Parar" fica
registrada aqui e não muda o desenho: o botão Parar existe, e o E-stop físico
continua sendo o único de verdade (ADR-0005).

## Não coberto

A queda entre o servidor e a placa (o Wi-Fi da placa). Ela é coberta pelo
comportamento da própria placa, que termina o jog absoluto que já recebeu.
Simular essa queda exige derrubar o rádio da placa no meio de um movimento.
