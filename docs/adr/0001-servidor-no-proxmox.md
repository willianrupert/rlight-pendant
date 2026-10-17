# ADR-0001 · Um servidor no Proxmox é o único que fala com a placa

**Status:** aceito · 2026-10-16 (revisado no mesmo dia: a ponte simples virou servidor)

## Contexto

O app precisa:

- funcionar como PWA de verdade (HTTPS, service worker, instalação) no iPhone,
  no Android e no Mac;
- falar com o FluidNC, que roda num ESP32 na rede da oficina e só fala HTTP e
  WebSocket **sem TLS**;
- mostrar trabalhos rodando, notificar quando terminam e proteger a máquina
  quando um cliente some.

Restrições do navegador:

1. **Mixed content:** uma página `https://` não abre `ws://`.
2. **Service worker e Web Push** só existem em contexto seguro.

Além disso, várias telas (Mac, celular, tablet) devem poder ver a máquina ao
mesmo tempo, e só uma deve comandar.

A máquina fica fixa, na mesma rede do Proxmox que já hospeda outros serviços em
`*.rlight.com.br`.

## Decisão

Um container no Proxmox roda **o servidor do RLight**. Ele é **o único cliente da
placa**: os navegadores falam com o servidor, nunca com o ESP32.

```
iPhone  ┐                 ┌─────────── Proxmox · container rlight ───────────┐
Android ├──https / wss──▶ │ Caddy ─ TLS, arquivos do PWA                    │
Mac     ┘                 │ servidor ─ conexão com a placa · estado · mov.  │──ws──▶ FluidNC
                          │            trabalhos · histórico · push          │        (ESP32)
                          └──────────────────────────────────────────────────┘
```

**Responsabilidades do servidor**

| Peça | Faz |
|---|---|
| Conexão com a placa | Uma conexão permanente, com reconexão automática. Pede o relatório de estado na frequência certa |
| Estado da máquina | Interpreta os relatórios (pelo core) e mantém o estado atual |
| Distribuição | Manda o estado para todos os navegadores conectados |
| Controle | **Uma sessão de controle por vez.** As outras assistem. Assumir o controle é explícito |
| Movimento | Mantém o alvo comandado e transforma gestos em comandos absolutos com limites ([ADR-0002](0002-movimento-por-intencoes-completas.md)) |
| Trabalhos | Recebe, analisa, envia ao SD com verificação e acompanha o progresso ([ADR-0006](0006-trabalhos-rodam-do-sd.md)) |
| Histórico | Registra trabalhos, alarmes, horas de spindle e sessões num SQLite |
| Notificações | Web Push (VAPID) para os aparelhos inscritos |

**Rede e TLS**

- O **Caddy** termina o TLS de `cnc.rlight.com.br` e serve o PWA. O certificado
  vem do Let's Encrypt por **DNS-01**, que não exige exposição à internet.
- **DNS só local:** o roteador resolve `cnc.rlight.com.br` para o container. Não
  existe registro público apontando para a oficina.
- A placa recebe **reserva de DHCP**. O servidor conhece o endereço por
  configuração.
- O servidor sai para a internet só para entregar Web Push. Nada entra.

**Carga na placa: telemetria leve e adaptativa.** Um relatório de estado tem uns
100 bytes. Mesmo a 10 por segundo são cerca de 1 KB/s, menos do que a WebUI do
próprio FluidNC usa, e a placa já gera um relatório interno a cada 500 ms para o
OLED. Ainda assim, o servidor pede só o necessário:

| Situação | Frequência |
|---|---|
| Ninguém olhando, máquina parada | 1 por segundo (para detectar alarme e queda) |
| Alguém olhando, ou trabalho rodando | 4 por segundo |
| Movimento manual em andamento | 10 por segundo |

- **Um consumidor só.** Os celulares nunca consultam a placa. Dez telas abertas
  geram o mesmo tráfego que uma. Sem o servidor, cada uma faria sua própria
  consulta.
- **A fluidez vem do app, não da placa.** Durante um trabalho, o app conhece o
  percurso e anima a ferramenta ao longo dele a 60 quadros por segundo, corrigindo
  pela posição real a cada relatório. Quatro relatórios por segundo parecem vídeo.
- **Relatório automático por canal**, se a versão do FluidNC oferecer, no lugar de
  perguntar a cada vez. A confirmar no spike S1.
- **Trabalho pesado só com a máquina parada:** enviar arquivos ao SD nunca acontece
  durante um corte ([ADR-0006](0006-trabalhos-rodam-do-sd.md)).
- **Medido, não suposto:** o spike S1 roda um corte no ar a partir do SD, com e sem
  telemetria a 10 Hz, e compara o tempo total, a fila do planner e a memória livre.

**Acesso de outros programas.** O FluidNC aceita vários canais ao mesmo tempo
(USB, telnet, WebSocket), então a WebUI e o USB continuam funcionando no Mac. O
cuidado é operacional: **não rodar trabalho por dois caminhos ao mesmo tempo.**
Se a máquina se mover sem um pedido do servidor, ele mostra "Controlada por outro
programa".

## Consequências

**Boas**
- Funciona igual em qualquer navegador moderno, de graça.
- A máquina é observada mesmo com todos os celulares fechados: histórico e
  notificações não dependem de ninguém estar olhando.
- Toda a lógica que importa roda num lugar só, fácil de testar e de atualizar.
- O transporte até a placa fica escondido. Se um dia o servidor rodar num
  mini-PC ao lado da máquina, ele pode usar **USB serial**, mais estável que o
  Wi-Fi do painel metálico, sem mudar o app.

**Ruins**
- O Proxmox vira dependência. Se ele cair, o app não funciona. A WebUI do
  FluidNC continua como plano B, e um trabalho já rodando do SD não é afetado.
- Quem está na LAN alcança o app. A v1 aceita isso, mas a rede de visitantes
  precisa estar isolada. Um PIN para assumir o controle fica previsto.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| PWA servido pelo ESP32 | Sem HTTPS: sem service worker, sem push, sem instalação. Flash pequeno e lento |
| Navegador falando direto com a placa | Bloqueado por mixed content. E cada cliente seria mais uma conexão no ESP32 |
| Só um proxy repassando WebSocket | Não teria histórico, push, limites de movimento nem controle de sessão |
| Expor na internet | Risco sem benefício. A notificação já resolve o "fora de casa" |
