// A casca do app no aparelho (web/sw/worker.ts): registra o service worker e,
// quando uma versão nova assume, aplica na próxima volta ao app, nunca no meio
// do uso.

/** Fora por mais que isto, voltar ao app conta como abrir de novo. */
export const RELAUNCH_AFTER_MS = 10_000;

/** Recarregar ao voltar: só com versão nova e depois de um tempo fora (não numa troca rápida de app). */
export function reloadOnReturn(updated: boolean, hiddenMs: number): boolean {
  return updated && hiddenMs >= RELAUNCH_AFTER_MS;
}

export function registerShell(base: string): void {
  if (!('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  // A primeira instalação também troca o controlador; isso não é versão nova.
  const hadController = !!sw.controller;
  let updated = false;
  let hiddenAt: number | null = null;
  sw.addEventListener('controllerchange', () => {
    if (hadController) updated = true;
  });
  sw.register(`${base}sw.js`, { scope: base }).then(
    (reg) => {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          hiddenAt = performance.now();
          return;
        }
        const away = hiddenAt === null ? 0 : performance.now() - hiddenAt;
        hiddenAt = null;
        if (reloadOnReturn(updated, away)) location.reload();
        // O iPhone retoma o app sem navegar: procura uma versão nova aqui.
        else if (away >= RELAUNCH_AFTER_MS) reg.update().catch(() => {});
      });
    },
    () => {
      /* sem service worker (modo privado, http): o app só não abre sem rede */
    },
  );
}
