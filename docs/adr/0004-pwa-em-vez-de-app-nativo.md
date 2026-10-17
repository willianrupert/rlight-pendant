# ADR-0004 · PWA em vez de app nativo

**Status:** aceito, condicionado ao spike S3 · 2026-10-16

## Contexto

O objetivo é uma experiência no nível de um app da Apple. As duas formas de
chegar lá no iPhone:

| | PWA | App nativo (SwiftUI) |
|---|---|---|
| Distribuição | Uma URL e "Adicionar à Tela de Início" | Conta de desenvolvedor (US$ 99/ano) ou reinstalar a cada 7 dias |
| Atualização | Publicar os arquivos | Compilar e reinstalar |
| Rede local | Precisa de HTTPS e da ponte (ADR-0001) | Fala direto com a placa |
| **Háptica** | **Safari não implementa a Vibration API** | Core Haptics completo |
| Apple Watch | Não existe | Possível (abaixo) |
| Testes | Vitest e Playwright WebKit | XCTest |
| Plataformas | Qualquer navegador | Só Apple |

A háptica é a maior perda do PWA. Num pendant, sentir cada passo de jog é parte
do que faz a interface parecer física.

**Apple Watch e Digital Crown.** Não há como fazer isso sem Swift: o watchOS não
roda PWA nem página web como app, e a rotação da Crown só é exposta a apps
nativos. Mesmo nativo, a documentação da Apple restringe rede de baixo nível
(como WebSocket) no relógio a apps de streaming de áudio. Um app de relógio
precisaria passar pelo iPhone, o que exige um app nativo no iPhone também, ou
usar requisições HTTP simples até a ponte.

## Decisão

**A v1 é um PWA.** Iterar rápido, testar com as ferramentas web e distribuir por
uma URL vale mais agora que a háptica.

A háptica é investigada no **spike S3**: no iOS 18, tocar num
`<input type="checkbox" switch>` gera vibração no Safari. O truque é frágil e
pode sumir numa atualização.

- **S3 aprova:** usar o truque atrás da porta `Haptics`, com fallback silencioso.
- **S3 reprova:** seguir sem háptica, com feedback visual e sonoro.

**Gatilho para reavaliar o nativo:** se depois de um mês de uso real a falta de
háptica for a reclamação principal, ou se o volante na Crown virar um desejo
concreto.

## Consequências

- Graças ao ADR-0003, uma migração para nativo reaproveita as **decisões**
  (protocolo, policy, jog, simulador e fixtures como especificação), não o
  código. O core em TypeScript teria de ser portado para Swift, guiado pelos
  mesmos testes.
- Um app de relógio, se vier, é um produto separado que fala com a ponte por
  HTTP, com o mesmo cuidado do ADR-0002 adaptado a requisições.
