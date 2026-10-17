# ADR-0001 · Hospedagem: ponte no Proxmox, só na LAN

**Status:** aceito · 2026-10-16

## Contexto

O pendant precisa ser um PWA de verdade: instalável na tela de início, com service
worker e funcionando sem internet. Ele precisa falar com o FluidNC, que roda num
ESP32 na rede da oficina e expõe HTTP e WebSocket **sem TLS**.

Duas restrições do Safari decidem a arquitetura:

1. **Mixed content:** uma página servida por `https://` não pode abrir `ws://`.
2. **Service worker só em contexto seguro:** sem HTTPS não há PWA offline.

O ESP32 não serve TLS de forma viável. Servir o PWA a partir da própria placa
resolveria a conexão, mas sem HTTPS, sem domínio e num flash pequeno e lento.

A máquina fica fixa, na mesma rede do servidor Proxmox que já hospeda outros
serviços em `*.rlight.com.br`.

## Decisão

Um container no Proxmox faz a ponte entre o iPhone e a placa:

```
iPhone ──wss──▶ Caddy ──▶ ponte ──ws──▶ FluidNC (ESP32)
                  │
                  └── arquivos estáticos do PWA
```

- **Caddy** termina o TLS de `cnc.rlight.com.br` e serve os arquivos do PWA.
  O certificado vem do Let's Encrypt por **desafio DNS-01**, que não exige que o
  host seja acessível pela internet.
- **ponte** é um processo pequeno que repassa as mensagens do WebSocket do
  cliente para o da placa e faz o watchdog do jog ([ADR-0002](0002-jog-continuo-em-pedacos.md)).
  Fora isso, não interpreta o protocolo.
- **DNS só local:** o roteador resolve `cnc.rlight.com.br` para o IP do container.
  **Não existe registro público** apontando para a rede da oficina.
- **Uma sessão de controle por vez:** uma conexão nova assume e a anterior é
  fechada com o motivo "outra sessão assumiu". Isso evita trava esquecida e
  dois operadores comandando ao mesmo tempo.
- A placa recebe **reserva de DHCP**. A ponte conhece o endereço dela por
  configuração.

## Consequências

**Boas**
- HTTPS, domínio, service worker e instalação funcionam como em qualquer PWA.
- O transporte até a placa fica escondido atrás da ponte. Se um dia a ponte
  rodar num mini-PC ao lado da máquina, ela pode falar por **USB serial** (mais
  estável que o Wi-Fi do painel metálico) sem mudar uma linha do PWA.
- A ponte é um ponto de segurança independente do celular (watchdog).

**Ruins**
- Mais uma peça que precisa estar no ar. Se o Proxmox cair, o pendant não
  funciona. A WebUI do FluidNC em `http://` continua como plano B.
- São dois saltos de rede em vez de um. Na LAN a latência extra é desprezível,
  e o spike S1 mede isso.
- Quem estiver na LAN alcança a máquina. A v1 aceita isso porque a rede é
  doméstica. A rede de visitantes precisa estar isolada.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| PWA servido pelo ESP32 | Sem HTTPS: sem service worker e sem domínio. Flash pequeno e servidor lento |
| PWA hospedado na internet falando direto com a placa | Bloqueado por mixed content |
| Expor a ponte na internet | Risco sem benefício: ninguém opera a máquina de longe |
| Só Caddy, sem a ponte | O Caddy repassaria o WebSocket, mas não teria como cancelar o jog quando o cliente some |
