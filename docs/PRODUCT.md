# RLight · Produto

Um servidor sempre ligado na rede da oficina, conectado a uma máquina FluidNC, e
um PWA para **ver, mexer e confiar** nela a partir de qualquer tela da rede. É
grátis e funciona no iPhone, no Android e no Mac.

**Serve qualquer máquina FluidNC** ([ADR-0008](adr/0008-qualquer-maquina-fluidnc.md)):
tudo o que o app sabe da máquina vem da configuração da placa. A instalação de
referência é a da CNC RLight, num Proxmox, em `https://cnc.rlight.com.br`.

A visão completa, e o porquê, estão em [VISION.md](VISION.md). Este documento é
o contrato: o que entra, em que ordem e como saber que deu certo.

---

## A máquina de referência

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

É nela que se desenvolve e se roda o teste de contrato. **Nenhum destes números
está no código:** o app os lê da placa, como leria de qualquer outra máquina.

---

## Escopo por fase

### v0 · Os olhos

> **Estado em 2026-10-17:** a tela roda e foi validada na máquina de referência,
> servida pelo Mac: jogs pela WebUI e um percurso de 225 jogs no ar (X, Y e Z
> juntos) acompanhados no iPhone, "muito fluida". Queda forçada testada contra o
> simulador. Instalada no Proxmox em `https://cnc.rlight.com.br` (CT 107, sempre
> ligada, HTTPS válido). **Falta para fechar a v0:** conferir no Android e o
> histórico mínimo.

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
- Régua de ajuste fino (passo 0,01 / 0,1 / 1 mm), com inércia de destino anunciado, limites e a barreira do Z0 ([ADR-0010](adr/0010-a-regua.md)).
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

### Ideias anotadas

- ✅ *Feito em 18/10/2026.* **O alvo fica no mapa até a máquina chegar.** Depois do "Ir", o ponto escolhido
  não some: fica na mesa como um anel vazado na cor de destaque (o azul do
  fantasma, `--acc`), com a linha tracejada do caminho encolhendo à medida que a
  máquina se aproxima. Sai com um esmaecer curto quando a posição real chega ao
  alvo. Se o movimento parar antes (Parar, alarme, queda), o anel some na hora:
  o mapa nunca mostra um destino que a máquina não vai mais buscar.
  *(Pedido do usuário, 17/10/2026.)*

- ✅ *Feito em 19/10/2026.* **Avisos no celular.** O servidor, que vê a máquina o
  tempo todo, avisa pelo Web Push (o app instalado recebe mesmo fechado): alarme,
  spindle esquecido girando, máquina fora do ar no meio do trabalho. Ligado em
  Automações; o ícone do app mostra 1 em alarme. E telas de abertura no tema
  escuro, para o app não abrir num flash branco.

### Roteiro do ecossistema (18/10/2026)

Em ordem. Cada passo usa o que o anterior deixou pronto.

1. **Fechar a v1 na máquina.** Validar na bancada o que mudou em 17–18/10
   (spindle sem fila, desligar no spin-up, régua com folga e histerese, alvo no
   mapa); PROC-07 (homing de X e Y juntos); a placa de toque do Z; alarmes
   explicados.
2. **v2 · Os trabalhos** (acima). Precisa de um cartão microSD na placa. É o
   salto de pendant para companheiro da máquina.
3. **Ver de fora da oficina.** Só assistir, por Tailscale, com Web Push de
   pronto/pausa/alarme. Comandar continua só na rede local (ADR-0005).
4. **Demonstração pública para o portfólio.** O app contra o simulador rodando no
   próprio navegador (o FluidNC falso e o servidor num Web Worker), publicado no
   GitHub Pages. Sem placa, sem servidor, sem dados da oficina:
   `cnc.rlight.com.br` aponta para a rede local e continua só da oficina.
5. **A máquina cuidando de si.** O servidor já vê tempo de spindle ligado e o
   quanto cada eixo anda: contadores de manutenção (lubrificar, correias, horas
   do spindle). E um diário de sessão escrito sozinho no Cortex: o que foi
   cortado, quanto tempo, qual ferramenta.
6. **Depois:** câmera da mesa (v3), as receitas do Romney (v4, abaixo) e um
   volante físico (ESP32 + encoder) falando o mesmo protocolo do app: o servidor
   é o único cliente da placa, então qualquer aparelho pode ser um pendant.

### Depois

- **v3 · Câmera:** vídeo da mesa atrás do percurso.
- **v4 · Receitas:** os geradores de peça do Romney como funções puras, com a
  peça desenhada em escala no mapa da mesa. O desenho das telas está em
  [RECEITAS.md](RECEITAS.md).

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
| **S1** ✅ · [script](../spikes/s1-elo/README.md) · [resultado](../spikes/s1-elo/RESULTADO-2026-10-17.md) | Como se comporta o elo servidor → placa (Wi-Fi no painel)? | Relatório de estado a 10 Hz ou mais por 1 h com o painel energizado; **cada queda registrada** (quantas, quanto duram); reconexão sozinha em todas; tráfego gravado como fixture; WebUI no Mac junto sem conflito; um corte no ar do SD com e sem telemetria a 10 Hz leva o mesmo tempo, sem esvaziar a fila do planner. Mais de uma queda por hora → antena externa ou ponto de acesso antes da v1 | v0 |
| **S2** ✅ · [resultado](../spikes/s2-movimento/RESULTADO-2026-10-17.md) | O movimento por intenções completas é exato e seguro com a rede caindo? | Parar em ≤ 0,3 s com link bom; com queda, a máquina termina exatamente no destino e não passa do alvo da régua; reenviar o último comando não move nada (ADR-0002) | v1 |
| **S3** ✅ | Que háptica e que fluidez um PWA entrega? | **Concluído em 2026-10-16** ([laboratório](../spikes/s3-haptica/index.html)). iPhone (iOS 26.5): nenhuma vibração por código, nem em página direta. Números interpolados: lisos. Ajuste fino: a régua venceu o volante (precisa e com uma mão) e, na rodada 5, foi aprovada em fluidez, precisão, inércia, destino e clique, com 1,3 % de quadros lentos ([ADR-0010](adr/0010-a-regua.md)). Android: a medir | Nada: o iPhone segue com som e movimento ([ADR-0009](adr/0009-fluidez-sem-mentir.md)) |
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
| [0008](adr/0008-qualquer-maquina-fluidnc.md) | Qualquer máquina FluidNC: tudo vem da placa |
| [0009](adr/0009-fluidez-sem-mentir.md) | Fluidez sem mentir: zero atraso, números como na Apple, háptica a sério |
| [0010](adr/0010-a-regua.md) | O ajuste fino é uma régua, com inércia de destino anunciado |
