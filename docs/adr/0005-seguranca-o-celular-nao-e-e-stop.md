# ADR-0005 · Segurança: o celular não é E-stop

**Status:** aceito · 2026-10-16

## Contexto

Um celular parece um controle completo. Ele não é: depende de Wi-Fi, bateria,
navegador, tela travada e de um processo no servidor. A máquina tem um E-stop
elétrico, por contator, que corta a potência independente de qualquer software.

Na bancada a placa já travou uma vez num estado em que respondia pela rede e
reportava movimento sem gerar pulsos. Nenhum software do lado de fora detecta
isso.

## Decisão

1. **Não existe botão de emergência no app.** Existem *Pausar* (feed hold) e
   *Resetar* (soft reset), com esses nomes. Chamar um deles de "emergência"
   ensinaria o operador a procurar o celular em vez do botão vermelho.
2. **Falha de conexão para a máquina.** É garantido pelo ADR-0002 (jog em
   pedaços e watchdog). Desconectado, nada é enfileirado para mandar depois.
3. **A policy do core decide o que aparece.** Cada comando declara em quais
   estados é permitido. A UI pergunta à policy e esconde ou desabilita o resto.
   Exemplos: em Alarm não há jog; em Run não há zerar nem homing; em Hold há
   resume e reset.
4. **Ação perigosa se confirma segurando** (cerca de 0,8 s, com progresso
   visível): ligar o spindle, homing, reset e zerar todos os eixos. Um toque
   acidental nunca liga o spindle.
5. **Nada é otimista.** O DRO, o estado do spindle e os overrides mostram o que a
   placa reportou. Um comando enviado aparece como "pendente" até o status
   confirmar.
6. **Ao perder a conexão, o app mostra isso de forma inequívoca** (tela inteira
   esmaecida, estado "Sem conexão") e só volta quando um status novo chegar.

## Consequências

- Algumas ações levam uma fração de segundo a mais. É intencional.
- A policy é a peça mais testada do core: uma tabela de estados × comandos com
  um teste por célula.
- O procedimento da oficina continua sendo: em dúvida, o botão vermelho.
