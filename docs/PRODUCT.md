# RLight · Produto

Um servidor no Proxmox conectado à CNC RLight, e um PWA em
`https://cnc.rlight.com.br` para **ver, mexer e confiar** na máquina a partir de
qualquer tela da rede da oficina. É grátis e funciona no iPhone, no Android e no Mac.

A visão completa, e o porquê, estão em [VISION.md](VISION.md). Este documento é
o contrato: o que entra, em que ordem e como saber que deu certo.

---

## A máquina

Uma fresadora CNC portátil construída por Romney Rupert, migrada do Mach3 para o
**FluidNC v3.9.9** numa placa **PiBot ESP32 (V4.96 Pro)** ligada por Wi-Fi.

| | |
|---|---|
| Curso útil | X 1215 · Y 604 · Z 158 mm, com soft limits ativos |
| Velocidade máxima | 3000 mm/min em X e Y, aceleração 250 mm/s² |
| Homing | Z, depois X, depois Y |
| Spindle | Tecmaf 2 CV com inversor WEG CFW300, comandado por PWM 0–10 V: até 18000 rpm, spin-up 5 s, spin-down 10 s. Sem leitura de rotação real |
| Apalpador | Entrada ligada, para a placa de toque do Z |
| Cartão SD | Na placa |
| E-stop | Elétrico, por contator. A entrada na placa é só o aviso |

Este sistema serve a **esta** máquina. Velocidades, cursos e faixa de rotação
vêm da configuração dela.

---

## Escopo por fase

### v0 · Os olhos

O servidor conectado à placa e o app só mostrando. Nenhum comando.

- Estado da máquina por cor e texto, legível a três metros.
- Posição de trabalho e de máquina; avanço real, rotação e overrides.
- Progresso de trabalho rodando do SD (porcentagem e arquivo) e tempo decorrido.
- Várias telas ao mesmo tempo.
- Dados com idade: sem sinal, os números esmaecem e aparece "Sem sinal da máquina · há 4 s". Tocar mostra a corrente celular ─ servidor ─ máquina ([ADR-0007](adr/0007-a-conexao-vai-cair.md)).
- Reconexão automática e silenciosa; reinício da placa detectado e avisado.
- Histórico mínimo: alarmes, horas de spindle e cada queda de conexão (início, duração, o que estava acontecendo).

**Pronto quando:** um trabalho iniciado pela WebUI do FluidNC é acompanhado do
começo ao fim no iPhone e no Android, ao mesmo tempo, e uma queda forçada da
placa no meio aparece como "sem sinal", volta sozinha e não afeta o corte.

### v1 · As mãos

- Assumir e devolver o controle.
- Unlock, homing, soft reset, feed hold e resume.
- Mapa: arrastar o fantasma, ver o caminho, soltar e a máquina vai; o mapa vira Parar durante o deslocamento ([ADR-0002](adr/0002-movimento-por-intencoes-completas.md)).
- Volante por anéis (0,01 / 0,1 / 1 mm), com limites e a barreira do Z0.
- Zerar por eixo, com desfazer.
- Spindle: mostrador, segurar para ligar, spin-up visível.
- Z automático pela placa de toque, com a sequência segura (recolhe primeiro e
  desce os últimos milímetros em avanço lento).
- Alarmes explicados: uma frase e uma ação.
- Háptica progressiva ([ADR-0004](adr/0004-pwa-em-vez-de-app-nativo.md)).

**Pronto quando:** uma sessão de bancada inteira (ligar, homing, posicionar,
zerar, testar o spindle) acontece sem abrir o notebook.

### v2 · Os trabalhos

- Enviar arquivo: arrastar no Mac, compartilhar no Android, seletor no iPhone.
- Análise e prévia: percurso sobre a mesa, dimensões, profundidade máxima, tempo
  estimado, avisos.
- Conferência automática contra curso, soft limits e profundidade da mesa.
- Envio verificado ao SD e início segurando ([ADR-0006](adr/0006-trabalhos-rodam-do-sd.md)).
- Tela de trabalho: percurso com o trecho cortado aceso, ferramenta ao vivo,
  tempo restante, hora prevista de término.
- Web Push: pronto, pausado, alarme.
- Biblioteca com "repetir" e tempo real versus estimado.

**Pronto quando:** uma peça real vai do Fusion à máquina e termina, com o
celular fechado no meio, e o tempo estimado erra menos de 10 %.

### Depois

- **v3 · Câmera:** vídeo da mesa atrás do percurso.
- **v4 · Receitas:** os geradores de peça do Romney como funções puras.

### Nunca

Botão de emergência, CAM, editor de G-code, controle pela internet, iniciar sem
segurar para confirmar.

---

## Segurança

Resumo do [ADR-0005](adr/0005-seguranca-o-celular-nao-e-e-stop.md):

1. **O celular nunca é o E-stop.** O app tem *Pausar* e *Resetar*, com esses nomes.
2. **Uma conexão perdida para a máquina** (ADR-0002). Nada fica enfileirado para depois.
3. **A interface só oferece o que o estado permite**, pela policy do core.
4. **Ação perigosa se confirma segurando.**
5. **Nada é otimista:** a tela mostra o que a placa reportou.
6. **Trabalho não depende do celular** (ADR-0006).
7. **A tela nunca mente:** um número nítido é atual; sem sinal, nada é aceito nem enfileirado (ADR-0007).

Limite conhecido: na bancada, a placa já travou depois de um panic,
respondendo pela rede e "movendo" eixos sem gerar pulsos. Nenhum software de
fora detecta isso.

---

## Princípios de experiência

| Princípio | Na prática |
|---|---|
| **Uma mão, polegar** | O frequente fica no terço de baixo. O que é só leitura fica em cima |
| **Alvos grandes** | No mínimo 60 pt, para luva e pó |
| **O estado é a interface** | A cor do fundo diz o estado; dá para ler de longe |
| **Movimento com significado** | Animação só para transições reais: spin-up, homing, progresso |
| **Oficina** | Escuro por padrão, alto contraste, tela acesa enquanto conectado |
| **Instalado, não navegado** | Standalone, sem barra do navegador |
| **Uma tela por tarefa** | Ver, mexer e trabalho. Sem menus nem tela de configurações |

---

## Spikes: antes de qualquer código de produção

Cada spike tem o critério escrito **antes** de rodar.

| # | Pergunta | Aprova se | Bloqueia |
|---|---|---|---|
| **S1** | Como se comporta o elo servidor → placa (Wi-Fi no painel)? | Relatório de estado a 10 Hz ou mais por 1 h com o painel energizado; **cada queda registrada** (quantas, quanto duram); reconexão sozinha em todas; tráfego gravado como fixture; WebUI no Mac junto sem conflito; um corte no ar do SD com e sem telemetria a 10 Hz leva o mesmo tempo, sem esvaziar a fila do planner. Mais de uma queda por hora → antena externa ou ponto de acesso antes da v1 | v0 |
| **S2** | O movimento por intenções completas é exato e seguro com a rede caindo? | Parar em ≤ 0,3 s com link bom; com queda, a máquina termina exatamente no destino e não passa do alvo do volante; reenviar o último comando não move nada (ADR-0002) | v1 |
| **S3** | Dá para ter háptica no iPhone? | Toque perceptível e consistente no iOS atual | Nada: sem ela, segue sem vibração no iPhone |
| **S4** | O envio ao SD é confiável com o painel energizado? | 10 envios de 500 KB verificados, sem intervenção (ADR-0006) | v2 |

**Pré-requisitos de rede:** reserva de DHCP para a placa (o IP já mudou uma
vez), DNS local de `cnc.rlight.com.br` para o container, e a rede de visitantes
isolada.

---

## Métricas de sucesso

- **O notebook sai da bancada:** nas sessões de teste, ele não é aberto.
- **Do bolso ao primeiro movimento:** < 5 s.
- **Tempo estimado:** erro < 10 % nos trabalhos reais.
- **Zero surpresas:** nenhum movimento inesperado. Cada um vira registro e teste.

---

## Decisões

| ADR | Decisão |
|---|---|
| [0001](adr/0001-servidor-no-proxmox.md) | Um servidor no Proxmox é o único que fala com a placa |
| [0002](adr/0002-movimento-por-intencoes-completas.md) | Movimento manual por intenções completas: o gesto nunca espera a rede |
| [0003](adr/0003-arquitetura-em-camadas-e-testes-primeiro.md) | Arquitetura em camadas, core puro, testes primeiro |
| [0004](adr/0004-pwa-em-vez-de-app-nativo.md) | PWA em vez de app nativo |
| [0005](adr/0005-seguranca-o-celular-nao-e-e-stop.md) | Segurança: o celular não é E-stop |
| [0006](adr/0006-trabalhos-rodam-do-sd.md) | Trabalhos rodam do SD, enviados e verificados pelo servidor |
| [0007](adr/0007-a-conexao-vai-cair.md) | A conexão com a máquina vai cair: projetar para isso |
