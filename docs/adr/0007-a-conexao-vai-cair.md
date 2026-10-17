# ADR-0007 · A conexão com a máquina vai cair: projetar para isso

**Status:** aceito · 2026-10-16

## Contexto

O caminho até a máquina tem um elo forte e um fraco:

```
celular ──Wi-Fi──▶ roteador ──cabo──▶ Proxmox ──cabo──▶ roteador ──Wi-Fi──▶ placa (dentro do painel metálico)
                                                                    ▲
                                                             o elo fraco
```

O servidor é cabeado. A placa é um ESP32 no Wi-Fi, dentro de um painel de aço,
ao lado de um inversor de frequência. Na bancada, a conexão com ela caiu várias
vezes com o sinal marcando 100 %. **Não é uma questão de "se", é de "quando".**

O celular também cai: sai do alcance, bloqueia a tela, troca de rede.

O risco de verdade não é a queda. É **o operador acreditar numa tela que parou
de ser verdade**: um DRO congelado que parece atual, ou um botão que aceita um
comando que vai chegar tarde.

## Decisão

### 1. Separar a máquina da nossa visão da máquina

A máquina segue a vida dela. O app mostra **a última coisa que sabemos e há
quanto tempo sabemos**. Como o Buscar do iPhone, que mostra onde um aparelho
estava "há 2 min" em vez de fingir que é agora.

Cada dado na tela carrega uma idade. A interface tem só dois modos:

| Modo | Quando | Como aparece |
|---|---|---|
| **Ao vivo** | Último relatório tem menos de 1 s | Normal. **Nada indica que está tudo bem**, porque normal não precisa de aviso |
| **Sem sinal** | Mais de 1 s sem relatório, em qualquer trecho | Os números esmaecem e param. Uma linha discreta: "Sem sinal da máquina · há 4 s". Os comandos somem |

Ao voltar, a linha diz "De volta" por um instante e some. Os números voltam a
ficar nítidos já com os valores atuais.

**Um indicador, não três.** O operador não precisa saber qual trecho caiu para
agir certo. Quem quiser saber toca na linha e vê a corrente:
`Seu celular ● ─ Servidor ● ─ Máquina ○`.

### 2. Nunca enfileirar, nunca reenviar

- Sem sinal, **nenhum comando é aceito**. Os controles não ficam só cinza:
  saem de cena, e a área deles mostra o motivo.
- Na reconexão, **nada pendente é enviado**. Gestos interrompidos são descartados.
  Quem quiser mover, toca de novo, já vendo a posição real.
- O servidor também não guarda comandos para a placa. Se a placa não estiver ao
  vivo, ele responde ao app "máquina sem sinal" na hora.

### 3. O que a máquina faz sozinha quando ninguém a vê

| Estava acontecendo | Ao cair a conexão com a placa |
|---|---|
| Repouso | Nada muda |
| Indo até o fantasma | Termina exatamente no destino escolhido e para ([ADR-0002](0002-movimento-por-intencoes-completas.md)) |
| Volante | Termina os cliques já recebidos (no máximo 2 mm à frente) e para |
| **Trabalho do SD** | **Continua cortando.** O trabalho não depende da rede ([ADR-0006](0006-trabalhos-rodam-do-sd.md)) |
| Spindle ligado, sem trabalho | Continua ligado. A tela avisa disso em destaque ao voltar, e o histórico registra |

Na tela de trabalho, durante a queda: "A máquina continua cortando. Voltamos a
vê-la em instantes." O tempo restante continua correndo como **estimativa**,
marcado assim, e se corrige quando o sinal volta.

### 4. Reconectar com inteligência, em silêncio

O servidor tenta de novo sozinho, com intervalos de 0,5, 1, 2 e no máximo 5 s,
para sempre. Ao reconectar, antes de declarar "ao vivo":

1. Lê o estado, o modo (`$G`) e os offsets (`$#`).
2. Compara com o que sabia. **A placa reiniciou?** (Por exemplo, perdeu o homing
   ou mostra alarme de reset.) Se sim, isso vira um evento claro: "A placa
   reiniciou às 14:32", com a ação certa (homing).
3. Se havia trabalho e ele não está mais rodando, diz o que se sabe: terminou,
   foi interrompido ou não dá para saber.

### 5. Avisar só o que importa

- Queda curta (menos de 30 s): só a linha na tela. Nada de notificação.
- Queda longa **durante um trabalho**: uma notificação. "Perdemos a máquina de
  vista. O trabalho continua na placa." E outra quando volta, com o estado.
- Placa reiniciada ou alarme ao voltar: sempre notificado.

### 6. Medir para melhorar o elo fraco

O servidor registra cada queda: início, duração e o que estava acontecendo.
Esse registro responde à pergunta física com dados em vez de palpite:

1. **Medir** (spike S1): quantas quedas por hora e quanto duram.
2. Se incomodar: **antena externa** fora do painel, ou um **ponto de acesso
   perto da máquina**.
3. Último recurso: **um módulo pequeno ao lado da máquina, ligado por USB**, como
   "braço" do servidor ([ADR-0001](0001-servidor-no-proxmox.md) já prevê a troca
   de transporte sem mudar o app).

## Consequências

- A tela nunca mente. Um número nítido é um número atual.
- Quedas viram inconveniência, nunca perigo nem peça perdida.
- O estado de conexão é uma peça do core (idade dos dados → modo), testável com
  relógio falso e com quedas injetadas no FakeFluidNC.
- O normal é silencioso e o anormal é claro. Isso custa disciplina de design:
  nada de ícones de "conectado" piscando.
