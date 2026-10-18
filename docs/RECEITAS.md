# Receitas · os geradores do Romney, redesenhados

> Proposta de desenho para a v4. Nada disto está implementado.

## De onde vem

Romney Rupert escreveu, dentro do Mach3, um **CAM conversacional completo**: 50
geradores de G-code em VBScript. O operador digitava parâmetros na própria tela
da máquina e o programa escrevia o arquivo do zero, com os passes de
profundidade calculados, validação e mensagens em português. Cada arquivo saía
assinado: *"Post processor Romney Rupert"*.

Os 50 se resumem a seis famílias:

| Família | O que faz | Geradores originais |
|---|---|---|
| **Aplainar** | Faceja uma área retangular | espiral, rampa em X, rampa em Y, zigue-zague, 0° (7 variantes) |
| **Furos** | Um furo ou uma grade de furos | furo simples, múltiplos furos, múltiplos círculos |
| **Círculo e arruela** | Disco, disco com furo, flange | arruela com furo, círculo com furo, flange de 4 furos |
| **Retângulo e polígono** | Recorta ou rebaixa, com cantos vivos ou arredondados, em grade | polígono, múltiplos polígonos, com borda rebaixada, com furos |
| **Linha e desenho** | Corte reto ou percurso ensinado com a máquina | corte em linha, corte linear, desenho (*teach*) |
| **Texto** | Grava letras com fontes, com teclado na tela | 14 fontes (Times, Broadway, Bauhaus, Stencil, MonoTXT…) |

Todos pedem os mesmos números do Mach3: avanço, velocidade de descida, diâmetro
da ferramenta, altura de movimento rápido, profundidade total, profundidade por
passe, retardo. E todos validam com uma caixa de erro depois que o valor errado
já foi digitado.

## O princípio

**Quem usa descreve a peça, não o percurso.** No Mach3, a tela era um formulário
de máquina; aqui, a tela é a peça.

Três decisões saem disso:

1. **A peça aparece em escala no mapa da mesa**, o mesmo do pendant, no lugar onde
   vai ser cortada, enquanto os números mudam. Não há "gerar e depois ver".
2. **O que é da ferramenta fica na ferramenta.** Avanço, descida, passe e
   diâmetro deixam de ser perguntas de cada receita: vêm de uma ferramenta
   escolhida uma vez ("Fresa 6 mm · MDF"). A receita pergunta só o que é da peça:
   tamanho, profundidade, quantidade.
3. **Valor impossível não existe.** Em vez de `MsgBox "deve ser maior que zero"`,
   o controle não desce abaixo do mínimo, o furo não fica menor que a fresa, e a
   peça que não cabe na mesa aparece em âmbar no mapa, com o motivo numa linha.

## As telas

### 1. Escolher

Uma folha com **seis cartões**, um por família, cada um com o desenho da peça
(não um ícone de menu). Não são 50 opções: as variantes viram escolhas dentro da
receita, e a mais comum já vem escolhida.

### 2. Desenhar

Metade de cima: o mapa da mesa com a peça em escala, sobre a posição atual da
máquina ou o zero da peça. Metade de baixo: **dois ou três controles grandes**,
com os dígitos de largura fixa do resto do app.

- **Arrastar a peça no mapa** a posiciona; **arrastar as alças** muda o tamanho.
  Os números acompanham, e digitar um número move a alça.
- A profundidade usa a régua do Z, com a barreira na superfície da peça.
- O que é raro fica numa linha discreta, "Mais opções": estratégia de
  aplainamento, sentido do corte, cantos arredondados, fonte.
- Embaixo, sempre visível: **tempo estimado** e quantos passes (o estimador do
  `core/gcode.ts`).

**Aplainar**, por exemplo, pergunta só a área (as alças no mapa) e a
profundidade. Espiral ou zigue-zague é decidido pelo formato da área e fica em
"Mais opções" para quem quiser trocar.

### 3. Conferir

Antes de cortar, o que o Romney já fazia em botões separados vira um passo só:

- **Cabe na máquina?** Curso, soft limits e profundidade da mesa, como na v2.
  Se não cabe, a peça já estava em âmbar desde a tela anterior.
- **"Contornar no ar"**: a máquina percorre o retângulo envolvente da peça na
  altura segura, para conferir o enquadramento sobre o material. Era o
  *teste geral de enquadramento* do Romney; aqui é um botão de segurar.

### 4. Cortar

O mesmo caminho dos trabalhos da v2: o G-code gerado é conferido, vai para o
cartão SD e começa segurando. A tela de trabalho é a mesma.

O cabeçalho do arquivo mantém a assinatura:
`(Receita: Arruela · a partir do gerador de Romney Rupert)`.

## O que vira ideia própria

- **Ensinar com a régua e o mapa.** O *teach* do Romney (levar a máquina a um
  ponto, gravar, levar a outro) é a receita que mais combina com o pendant: leve a
  máquina com a régua, toque **Marcar A**, depois **Marcar B**, e o corte em linha
  aparece no mapa entre os dois. O mesmo serve para "desenho": uma sequência de
  pontos marcados vira um percurso.
- **Texto com o teclado do sistema.** O teclado virtual do Mach3 deixa de existir:
  o campo de texto é nativo e a prévia das letras aparece no mapa, no tamanho real.

## Como fica no código

Cada receita é uma **função pura no `core/`**, como o resto (ADR-0003):

```ts
receita(parametros, ferramenta, perfilDaMaquina) → { gcode, percurso, avisos, estimativa }
```

- `percurso` desenha a prévia no mapa; `avisos` vira o âmbar e a linha de motivo.
- **Testes primeiro, com arquivos de ouro:** os `.tap` que os geradores do Romney
  deixaram no pendrive são a referência. Uma receita nova tem que produzir o
  mesmo percurso que o gerador original para os mesmos parâmetros.
- A ordem sugerida é Furos → Aplainar → Círculo e arruela → Retângulo →
  Linha (teach) → Texto. A família Texto é a maior (as fontes) e fica por último.

## Depende de

- **v2 · Os trabalhos**: as receitas geram G-code e usam o mesmo caminho de
  conferência, envio ao SD e tela de trabalho.
- **Biblioteca de ferramentas**: uma lista curta de fresas com avanço, descida e
  passe, que nasce aqui e serve também aos trabalhos do Fusion.
