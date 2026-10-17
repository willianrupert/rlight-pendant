# ADR-0004 · PWA em vez de app nativo

**Status:** aceito · 2026-10-16 (confirmado depois de reavaliar o nativo)

## Contexto

O nativo foi considerado a sério: em SwiftUI ele teria háptica completa, Live
Activity, Apple Watch, Botão de Ação e Siri. Os requisitos decidiram:

- **Custo zero.** O Apple Developer Program custa US$ 99/ano. Sem ele, o app
  precisa ser reinstalado a cada 7 dias.
- **Funcionar no Android também.** O nativo exigiria um segundo app.

## Decisão

**PWA**, servido pelo servidor do RLight no Proxmox ([ADR-0001](0001-servidor-no-proxmox.md)).

| Capacidade | iPhone (Safari, instalado) | Android (Chrome) | Mac / desktop |
|---|---|---|---|
| Estado ao vivo, pendant, trabalhos | ✅ | ✅ | ✅ |
| Instalar na tela de início | ✅ | ✅ | ✅ |
| Web Push (notificações) | ✅ iOS 16.4+ instalado | ✅ | ✅ |
| Tela sempre acesa (Wake Lock) | ✅ | ✅ | ✅ |
| Receber arquivo compartilhado | ❌ (usa o seletor de arquivos) | ✅ Web Share Target | Arrastar e soltar |
| Vibração | ⚠️ truque experimental | ✅ Vibration API | — |

**Háptica como melhoria progressiva**, atrás da porta `Haptics`:
- **Android:** padrões completos da linguagem de háptica.
- **iPhone:** no iOS 18, acionar um `<input type="checkbox" switch>` gera um
  toque. Usado se o spike S3 aprovar, com saída silenciosa se sumir numa
  atualização.
- **Todos:** som curto opcional e resposta visual imediata. Nenhuma função
  depende de vibração.

## Consequências

- Um código só para iPhone, Android, tablet e Mac, sem loja e sem custo.
- Ficam de fora a Live Activity, o Apple Watch e o Botão de Ação. As
  notificações por push cobrem o essencial do "saber sem olhar".
- Se um dia valer pagar, um app nativo pode ser só mais um cliente do mesmo
  servidor. Nada aqui impede isso.
