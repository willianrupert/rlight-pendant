# ADR-0010 · O ajuste fino é uma régua, com inércia de destino anunciado

**Status:** aceito, fluidez a confirmar na rodada 4 do S3 · 2026-10-16

## Contexto

O ajuste fino de um eixo é o gesto mais repetido do modo manual: encostar a
ferramenta na peça, centralizar, afastar um décimo. Ele precisa ser preciso no
centésimo, confortável com uma mão e liso.

Três rodadas de teste num iPhone com iOS 26.5 (spike S3):

| Rodada | Forma | Resultado |
|---|---|---|
| 2 | Volante circular que prendia a roda no dente (catraca) | Soou certo, **perdeu a fluidez**. Descartado |
| 3 | Volante circular liso, resolução pelo anel | Preciso, **não dá para usar com uma mão**, não fluido |
| 3 | Régua linear, como o ajuste de ângulo do Fotos | Preciso, **confortável com uma mão**, não fluido |

A régua venceu na forma. Nenhuma das duas foi fluida, e a investigação achou
causas de implementação, não de forma:

- A cada detente, o laboratório ainda criava e removia um elemento na página
  para tentar uma vibração que não existe no iPhone. Trabalho de DOM no meio do
  gesto.
- Cada clique sonoro montava peças de áudio novas.
- O canvas não seguia a densidade de pixels da tela.
- **Não havia inércia.** No iOS, "liso" inclui poder dar um peteleco e ver a
  coisa deslizar com atrito. Ela tinha sido tirada de propósito, por segurança.

## Decisão

### 1. Régua, não volante

Os traços correm sob uma linha fixa enquanto o polegar arrasta para os lados.
Cada traço é um passo; os traços maiores marcam cada dez. É o gesto que o próprio
iOS usa para ajuste fino com o polegar (o ângulo no Fotos, o zoom da Câmera). Um
círculo no vidro pede um movimento de punho que não se faz bem com uma mão.

### 2. Inércia com destino anunciado

Ao soltar com velocidade, a régua desliza e desacelera como uma lista do iOS
(constante de 325 ms). Isso não fere o [ADR-0002](0002-movimento-por-intencoes-completas.md):

- **O destino é calculado no instante em que o dedo solta**, porque a
  desaceleração exponencial tem ponto de parada conhecido. A régua mostra esse
  ponto com um traço azul-claro antes de chegar lá.
- **Sai um único comando absoluto** para o destino, como no fantasma do mapa. A
  animação da régua é só a régua chegando lá.
- **Tocar segura.** Um toque durante o deslize para a régua no traço mais próximo,
  e o servidor recebe o novo destino.
- **Para sempre num traço.** Nunca fica entre dois centésimos.
- **Nas pontas do curso** a régua resiste com o efeito elástico do iOS e volta para
  o limite. O destino nunca passa do soft limit.

### 3. Passo escolhido em três pílulas

`0,01 · 0,1 · 1 mm`, acima da régua, com `0,1` como padrão. É uma escolha
explícita e previsível, como os modos de ajuste do Fotos. Fica lembrada por eixo.
Atravessar distâncias grandes é papel do fantasma no mapa, não da régua.

### 4. O caminho quente não toca o DOM

Durante o gesto, só o canvas da régua e os dígitos do DRO mudam. O canvas segue a
densidade da tela. O clique sonoro é um único buffer pronto, reutilizado, e se
espaça acima de ~26 por segundo, como o seletor do iOS. O iPhone não recebe
chamadas de vibração ([ADR-0009](0009-fluidez-sem-mentir.md)); o Android recebe
pulsos de 6 a 12 ms.

## Critério de aceitação (rodada 4 do S3)

No iPhone, com uma mão:
- **Fluido:** a pessoa diz que sim, e o medidor do laboratório não conta quadros
  lentos (> 22 ms) durante arrastos e deslizes.
- **Preciso:** para exatamente no centésimo desejado em arrasto lento.
- **Inércia e marcador:** a inércia ajuda e o marcador de destino é claro. Se a
  inércia atrapalhar, ela sai e fica só o arrasto.

## Consequências

- O volante circular sai do produto. Os documentos passam a falar em régua.
- A régua vira um componente do core de interface com física pura e testável:
  dado velocidade e posição ao soltar, o destino é uma função determinística.
- O clique sonoro passa a ser parte da identidade do produto e merece desenho
  próprio, com o mesmo cuidado de um som de sistema.
