# ADR-0006 · Trabalhos rodam do SD, enviados e verificados pelo servidor

**Status:** aceito, condicionado ao spike S4 · 2026-10-16

## Contexto

Um trabalho pode levar uma hora. Se o G-code for transmitido linha a linha pela
rede, qualquer queda deixa a máquina sem a próxima linha. Ela para no meio do
corte e a peça se perde.

A placa tem cartão SD, e o FluidNC roda arquivos de lá sozinho, reportando o
progresso no relatório de estado.

Restrição medida na bancada: com o painel energizado, o Wi-Fi da placa
falhou em envios acima de uns 3 KB, e uma sequência de envios falhos chegou a
apagar um arquivo da placa. Um trabalho tem centenas de KB.

## Decisão

1. **Todo trabalho roda do SD.** O servidor nunca transmite G-code linha a linha
   durante um corte.
2. **O envio é responsabilidade do servidor**, em pedaços pequenos com nova
   tentativa. Ao final, o servidor lê o arquivo de volta (ou o tamanho e um hash,
   se a placa oferecer) e compara com o original. **Só um arquivo verificado pode
   ser iniciado.**
3. **Nunca sobrescrever no lugar:** o envio vai para um nome temporário e só é
   renomeado depois de verificado. Uma falha no meio nunca apaga um trabalho bom.
4. **Antes do envio, o servidor analisa o arquivo** com o core: limites do
   percurso contra o curso e os soft limits, profundidade máxima, ferramentas,
   tempo estimado. Problemas bloqueiam ou viram avisos explícitos.
5. **Durante o corte, o servidor acompanha:** a porcentagem do SD diz em que
   ponto do arquivo a máquina está. Cruzada com a simulação feita antes, ela dá
   o tempo restante e o trecho do percurso já cortado.

## Critério de aceitação (spike S4)

Com o painel energizado e a antena na posição final, enviar um arquivo de
500 KB dez vezes.

- **Aprova:** dez envios verificados, sem intervenção, em menos de 2 min cada.
- **Reprova:** resolver o físico primeiro (antena externa fora do painel, ou o
  servidor num mini-PC com USB ao lado da máquina). A v2 não começa antes disso.

## Consequências

- Um celular travado, uma bateria descarregada ou o Proxmox reiniciando não
  estragam uma peça em andamento.
- O Wi-Fi da placa deixa de ser crítico durante o corte, mas continua crítico
  para enviar. Por isso o spike S4 é pré-requisito da v2.
- A estimativa de tempo depende da simulação no core, que é testada contra
  trabalhos reais ([ADR-0003](0003-arquitetura-em-camadas-e-testes-primeiro.md)).
