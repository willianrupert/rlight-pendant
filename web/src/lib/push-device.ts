// Os avisos neste aparelho: a ligação entre o navegador (permissão, inscrição
// no serviço de push) e o servidor. As decisões estão em lib/alerts.ts.
//
// A cada conexão o servidor manda a chave; o app confere a inscrição e a
// renova no servidor (que pode ter reiniciado ou trocado de chave). E diz ao
// servidor quando está à vista: quem já está olhando a máquina não precisa de aviso.

import { keyBytes, notifyStatus, sameKey, type NotifyStatus } from './alerts';
import type { Connection } from './connection';

interface SubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export class PushDevice {
  status: NotifyStatus = 'unavailable';
  onStatus: ((s: NotifyStatus) => void) | null = null;

  #key: string | null = null;
  #endpoint: string | null = null;
  #reg: ServiceWorkerRegistration | null = null;

  constructor(private readonly conn: Connection) {
    conn.onPushKey = (key) => {
      this.#key = key;
      void this.#sync();
    };
    document.addEventListener('visibilitychange', () => this.#tellWatching());
  }

  /**
   * Ligar: a inscrição pede a permissão. No iPhone ela precisa sair direto do
   * toque, sem nada esperando antes: por isso o service worker já vem guardado.
   */
  async enable(): Promise<void> {
    const key = this.#key;
    const reg = this.#reg;
    if (!key || !reg) return;
    try {
      this.#send(await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
    } catch {
      /* recusado (na permissão ou no serviço de push): continua desligado */
    }
    return this.#update();
  }

  async disable(): Promise<void> {
    const sub = await (await registration())?.pushManager.getSubscription();
    if (sub) {
      this.conn.pushUnsubscribe(sub.endpoint);
      await sub.unsubscribe().catch(() => {});
    }
    this.#endpoint = null;
    return this.#update();
  }

  /** O número no ícone do app. Sem permissão de avisos, o iPhone ignora: tudo bem. */
  static badge(n: number): void {
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    try {
      void (n > 0 ? nav.setAppBadge?.(n) : nav.clearAppBadge?.())?.catch(() => {});
    } catch {
      /* sem suporte */
    }
  }

  async #sync(): Promise<void> {
    const key = this.#key;
    const reg = await registration();
    let sub = (await reg?.pushManager.getSubscription()) ?? null;
    // O servidor trocou de chave (o estado dele se perdeu): a inscrição velha não vale.
    if (sub && key && !sameKey(sub.options.applicationServerKey, key)) {
      await sub.unsubscribe().catch(() => {});
      sub = null;
      if (reg && Notification.permission === 'granted') {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }).catch(() => null);
      }
    }
    if (sub) this.#send(sub);
    else this.#endpoint = null;
    await this.#update();
  }

  #send(sub: PushSubscription): void {
    const json = sub.toJSON() as SubscriptionJSON;
    if (!json.keys?.p256dh || !json.keys.auth) return;
    this.#endpoint = sub.endpoint;
    this.conn.pushSubscribe({ endpoint: sub.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
    this.#tellWatching();
  }

  #tellWatching(): void {
    if (!this.#endpoint) return;
    this.conn.watching(document.visibilityState === 'visible' ? this.#endpoint : null);
  }

  async #update(): Promise<void> {
    const reg = await registration();
    this.#reg = reg;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    this.status = notifyStatus({
      serverKey: this.#key !== null,
      pushManager: !!reg && 'pushManager' in reg,
      notification: 'Notification' in window,
      standalone: matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true,
      ios,
      permission: 'Notification' in window ? Notification.permission : 'default',
      subscribed: this.#endpoint !== null,
    });
    this.onStatus?.(this.status);
  }
}

/** O service worker do app, se há (em desenvolvimento não há: sem avisos). */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  try {
    return (await navigator.serviceWorker?.getRegistration()) ?? null;
  } catch {
    return null;
  }
}
