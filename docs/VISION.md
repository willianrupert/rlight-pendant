# Visão

> **Um servidor na sua rede que nunca tira os olhos da máquina.
> Um app que mostra a máquina como ela é, em qualquer tela.**

A CNC RLight hoje é uma caixa preta com uma WebUI de desktop. Para saber o que
ela está fazendo é preciso estar na frente dela. Para mexer nela é preciso um
notebook.

O RLight muda isso com duas peças:

- **O servidor**, um container no Proxmox, fica conectado à placa 24 horas por
  dia. Ele é o único que fala com o FluidNC. Ele entende o que a máquina está
  fazendo, guarda tudo, avisa quando algo acontece e protege a máquina quando
  alguém some no meio de um movimento.
- **O app**, um PWA servido por esse servidor, funciona no iPhone, no Android,
  no iPad e no Mac. Ele é instalado na tela de início, não custa nada e não
  passa por loja.

Três verbos guiam tudo: **ver, mexer e confiar.**

---

## Ver: a máquina ao vivo

Sim, dá para ver um trabalho rodando, e com mais detalhe do que a própria
máquina mostra. O FluidNC manda, várias vezes por segundo, um relatório de
estado. O servidor junta esse relatório com o que ele sabe do arquivo que está
rodando:

| O que você vê | De onde vem |
|---|---|
| Estado (rodando, pausado, alarme) | Relatório de estado da placa |
| Posição X, Y, Z da máquina e da peça | Relatório de estado |
| Avanço real (mm/min) e rotação comandada | Relatório de estado (`FS:`) |
| Overrides de avanço e rotação | Relatório de estado (`Ov:`) |
| Progresso do arquivo | Relatório de estado durante trabalho do SD (`SD:` com a porcentagem) |
| **Tempo decorrido** | O servidor marca o início |
| **Tempo restante** | O servidor simulou o arquivo inteiro antes de começar, com aceleração e avanço reais da máquina, e sabe em que ponto do percurso ela está |
| **O percurso, com a ferramenta andando por ele** | O servidor transformou o G-code em geometria; o app desenha e pinta o que já foi cortado |

**A tela de trabalho** mostra o percurso visto de cima, com o trecho já cortado
aceso, o resto apagado e a ferramenta como um ponto vivo. Embaixo, grande: tempo
restante, a hora prevista de término e a porcentagem. Avanço e rotação aparecem
como dois mostradores discretos. No Mac, a mesma tela vira um painel de oficina
em tela cheia.

**Várias telas ao mesmo tempo.** O Mac na bancada, o celular no bolso e um
tablet na parede, todos vendo a mesma máquina. O servidor distribui o estado
para todos. Só um tem o controle por vez ([ADR-0001](adr/0001-servidor-no-proxmox.md)).

**Notificações**, inclusive fora de casa: "Trabalho pronto em 42 min", "Pausado:
troca de ferramenta", "Alarme: fim de curso do X". Elas chegam por Web Push no
iPhone (com o app instalado) e no Android. A notificação sai da rede, mas o
controle não: a máquina continua acessível só pela LAN.

**Câmera, numa fase posterior:** uma câmera barata apontada para a mesa,
repassada pelo servidor com baixa latência, aparece atrás do percurso. É o
recurso que faz as impressoras 3D modernas parecerem mágicas.

---

## Mexer: um pendant que parece físico

Para testar, posicionar e trocar ferramenta. São uma tela e três gestos, sem
setas nem seletor de passo.

```
┌─────────────────────────────┐
│  ONDE   a mesa vista de cima│   arrastar o fantasma e soltar = a máquina vai
├─────────────────────────────┤
│  QUANTO   X  412,30         │   tocar = escolhe o eixo
│           Y  118,05         │   segurar = zera (com desfazer)
│           Z   −3,20         │
├─────────────────────────────┤
│  COMO     o volante         │   anel externo 0,01 · meio 0,1 · centro 1 mm
│  ● 12.000 rpm    ❙❙ PAUSAR   │
└─────────────────────────────┘
```

1. **Arrastar o fantasma e soltar:** você arrasta um fantasma do spindle pelo
   mapa e vê a linha do caminho e o destino. A máquina não se mexe enquanto você
   arrasta. Soltou, ela desliza até lá, ao vivo, e o mapa vira um botão Parar.
   Como soltar um alfinete no Mapas. É o movimento grosso.

   **O gesto nunca espera a rede:** tudo o que você sente acontece no aparelho, e
   a máquina recebe só intenções completas, com destino conhecido. O Wi-Fi da
   placa pode soluçar à vontade que nada gagueja ([ADR-0002](adr/0002-movimento-por-intencoes-completas.md)).
2. **Girar o volante:** cada detente é um passo exato. **O anel em que o polegar
   está escolhe a resolução.** O volante comanda distância, não velocidade: se a
   conexão cair, a máquina faz no máximo o que você já girou.
3. **Tocar e segurar nos números:** tocar escolhe o eixo, segurar zera, e logo
   aparece **"Desfazer"**. Zerar no lugar errado é o erro caro clássico, e aqui
   ele custa um toque.

**A folha do spindle** é um mostrador grande. Você gira para escolher a rotação e
segura para ligar: o anel enche durante a confirmação e continua durante o
spin-up do inversor.

**A máquina tem forma.** O app conhece o curso, os soft limits e o zero da peça.
Chegando ao fim do curso, os cliques ficam mais fortes até virar uma parede.
Descendo o Z em direção à peça, eles pesam, e no Z0 há uma barreira que só se
passa girando de novo, de propósito. **Um alarme aparece como uma frase e uma
ação**, nunca como `ALARM:1`.

**Háptica onde o aparelho deixa.** No Android, o navegador vibra com padrões
completos. No iPhone, o Safari não oferece vibração para páginas. Existe um
truque experimental, e o resto do feedback vem por som curto e movimento na
tela. A interface funciona igual com ou sem vibração.

---

## Confiar: a máquina não depende do celular

- **O trabalho roda do cartão SD da placa.** O servidor envia o arquivo em
  pedaços pequenos, confere cada um e só libera o início quando o arquivo na
  placa bate com o original. Se o celular travar, a bateria acabar ou você sair
  de perto, a máquina termina a peça ([ADR-0006](adr/0006-trabalhos-rodam-do-sd.md)).
- **Antes de começar, o servidor confere o arquivo:** o percurso cabe no curso?
  Respeita os soft limits? Desce abaixo da profundidade permitida para a mesa?
  O que ele consegue verificar, ele verifica. Você só confirma o que ele não vê:
  "peça presa".
- **Todo movimento manual tem destino.** A máquina nunca anda "até alguém mandar
  parar". Se a conexão cair no meio, ela termina exatamente o que você pediu e
  viu, e nada mais. Os comandos são absolutos: repetir um por engano não move a
  máquina ([ADR-0002](adr/0002-movimento-por-intencoes-completas.md)).
- **Tudo fica registrado:** trabalhos, alarmes, horas de spindle, quem estava no
  controle. Quando algo dá errado, dá para ver o que aconteceu antes.
- **A conexão com a máquina vai cair**, porque ela está no Wi-Fi dentro de um
  painel de aço. A tela nunca finge: cada número carrega a idade dele, como o
  Buscar mostra "há 2 min". Sem sinal, os números esmaecem, os comandos somem e
  nada fica na fila. O trabalho do SD continua cortando, e o app volta a vê-lo
  sozinho ([ADR-0007](adr/0007-a-conexao-vai-cair.md)).
- **O celular nunca é E-stop.** O E-stop é o botão vermelho na máquina ([ADR-0005](adr/0005-seguranca-o-celular-nao-e-e-stop.md)).

---

## Enviar trabalho: arrastar e soltar

- **No Mac:** arrastar o `.nc` do Fusion (ou de qualquer CAM) para a janela.
- **No celular:** compartilhar o arquivo para o app, no Android, ou escolher pelo
  seletor de arquivos, no iPhone.
- O servidor analisa e mostra a prévia: o percurso sobre a mesa, as dimensões, a
  profundidade máxima, o tempo estimado e os avisos. Um botão: **Enviar para a
  máquina**. Outro, segurando: **Iniciar**.
- **A biblioteca** guarda os trabalhos já feitos, com tempo real versus
  estimado. "Repetir" fica a um toque.

---

## Por que web e não nativo

| | Web (PWA + servidor) | Nativo |
|---|---|---|
| Custo | **Zero** | US$ 99/ano por plataforma Apple, mais o Android à parte |
| iPhone e Android | **Os dois, com um código** | Dois apps |
| Mac e tablet | **De graça** | Mais trabalho |
| Atualização | Publicar no servidor | Loja ou reinstalação |
| Ver trabalho, notificar, enviar arquivo | ✅ | ✅ |
| Háptica | Android sim; iPhone experimental | ✅ |
| Live Activity, Watch, Botão de Ação | ❌ | ✅ |

O servidor compensa boa parte do que a web não tem: ele mantém a conexão,
notifica, registra e protege. O que fica de fora (a vibração confiável no iPhone
e a integração com o sistema) não é o centro do produto. **Ver a máquina ao
vivo de qualquer tela, sem custo, é.**

---

## O que este app nunca vai ter

- Um botão de emergência. O E-stop é o vermelho.
- Um CAM. Os desenhos vêm de fora, como arquivo.
- Um editor de G-code.
- Acesso de controle pela internet.
- Iniciar um corte sem segurar para confirmar.

## Fases

| Fase | Entrega | Já serve para |
|---|---|---|
| **v0 · Os olhos** | Servidor conectado à placa; app mostrando estado, posição, avanço e rotação ao vivo em qualquer tela; histórico | Acompanhar trabalhos iniciados pela WebUI, hoje |
| **v1 · As mãos** | Pendant: mapa, volante, zero com desfazer, spindle, homing, unlock, Z pela placa de toque | Testes e preparação sem notebook |
| **v2 · Os trabalhos** | Enviar arquivo, prévia, conferência, envio verificado ao SD, iniciar, tela de trabalho com percurso ao vivo e tempo restante, notificações | Rodar peças do começo ao fim pelo app |
| **v3 · A câmera** | Vídeo da mesa ao vivo atrás do percurso | Acompanhar de longe |
| **v4 · As receitas** | Os geradores de peça do Romney (aplainar, furos, recortes, texto) como funções puras | Peças simples sem CAM |

A v0 é pequena e já útil no primeiro dia. Ela também valida o mais arriscado: a
estabilidade da conexão entre o servidor e a placa.
