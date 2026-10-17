# Spike S1 · o elo servidor → placa

Responde à primeira pergunta do [PRODUCT.md](../../docs/PRODUCT.md#spikes-antes-de-qualquer-código-de-produção):
**como se comporta a conexão com uma placa FluidNC no Wi-Fi, dentro de um painel
metálico?** E grava o tráfego real, que vira fixture para escrever o parser de
protocolo com testes primeiro ([ADR-0003](../../docs/adr/0003-arquitetura-em-camadas-e-testes-primeiro.md)).

**Somente leitura.** O script só envia comandos de uma lista fechada: `?`
(relatório de estado), `$I`, `$G`, `$#`, `$CD` e `$SS`. Nenhum movimento, nenhum
spindle, nenhuma configuração alterada. Qualquer outro comando é recusado no
próprio código.

Usa a porta telnet do FluidNC (TCP 23), o mesmo canal de `nc <ip> 23`. Requer
Node 18 ou mais novo, sem dependências.

## Na bancada

1. Painel energizado e a placa no Wi-Fi, como em uso real.
2. Rode a partir de um computador da mesma rede, de preferência o próprio servidor:

   ```bash
   node spikes/s1-elo/s1.mjs <ip-da-placa> --hz 10 --minutes 60
   ```

3. **Durante a hora**, abra a WebUI do FluidNC no Mac e use normalmente por alguns
   minutos, para ver duas conexões juntas.
4. Ctrl+C encerra antes da hora; o resumo sai do mesmo jeito.

Saída em `./saida/s1-<data>/`:

| Arquivo | Conteúdo |
|---|---|
| `resumo.json` | Frequência real, quedas (quando e quanto duraram), lacunas acima de 2 s, latência do `?`, campos e estados vistos, e o critério de aprovação |
| `trafego.jsonl` | Cada linha enviada e recebida, com o instante. É a fixture |

## Impacto da telemetria num corte

A outra metade do S1 (ADR-0001): um corte no ar, rodando do SD pela WebUI, com o
spindle desligado e o Z bem acima da mesa. Rode duas vezes o mesmo arquivo:

1. com `node s1.mjs <ip> --hz 10` rodando;
2. com `node s1.mjs <ip> --hz 1` rodando.

Compare o tempo total que a WebUI mostra. **Aprova** se a diferença for menor que
1 %. O script em si não move nada: quem roda o corte é você, pela WebUI.

## Sem a placa

`fake-fluidnc.mjs` é um FluidNC falso que responde a `?` e derruba a conexão a
cada N segundos, para testar o próprio script:

```bash
node spikes/s1-elo/fake-fluidnc.mjs --port 2323 --drop-every 20 &
node spikes/s1-elo/s1.mjs 127.0.0.1 --port 2323 --minutes 1
```

## Critério de aprovação

O resumo calcula sozinho os itens que dependem só do tráfego:

- relatórios a pelo menos 95 % da frequência pedida;
- nenhuma lacuna acima de 2 s;
- reconexão automática em todas as quedas;
- no máximo uma queda por hora. Mais que isso: antena externa ou ponto de acesso
  perto da máquina antes da v1 ([ADR-0007](../../docs/adr/0007-a-conexao-vai-cair.md)).
