// Os avisos no celular (Web Push). O aparelho dá ao servidor um endereço no
// serviço de push do navegador dele (o da Apple, no iPhone); o servidor manda
// para lá, assinado com as chaves dele (VAPID), e o serviço entrega mesmo com o
// app fechado. As chaves nascem no primeiro uso e ficam no RLIGHT_STATE_DIR:
// ninguém precisa criar nem colar segredo nenhum.

// O envio de verdade e o arquivo das chaves ficam em push-send.ts: este aqui
// vai também para a demonstração no navegador, que não tem a web-push.

import type { Alert } from './alerts';

/** Até quantos aparelhos recebem avisos. */
export const MAX_DEVICES = 8;

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

// Os serviços de push dos navegadores. O servidor só manda para eles: um
// endereço qualquer vindo da rede viraria o servidor fazendo pedidos por alguém.
const PUSH_HOSTS = ['push.apple.com', 'fcm.googleapis.com', 'push.services.mozilla.com', 'notify.windows.com'];

export function isPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
}

function valid(s: PushSubscriptionJSON): boolean {
  return (
    typeof s?.endpoint === 'string' &&
    s.endpoint.length <= 1024 &&
    isPushEndpoint(s.endpoint) &&
    typeof s.keys?.p256dh === 'string' &&
    typeof s.keys?.auth === 'string' &&
    s.keys.p256dh.length > 0 &&
    s.keys.auth.length > 0 &&
    s.keys.p256dh.length <= 256 &&
    s.keys.auth.length <= 256
  );
}

export class PushStore {
  #devices: PushSubscriptionJSON[];

  constructor(saved: readonly PushSubscriptionJSON[]) {
    this.#devices = saved.filter(valid).slice(-MAX_DEVICES).map(copy);
  }

  get list(): PushSubscriptionJSON[] {
    return this.#devices.map(copy);
  }

  /** Guarda o aparelho (ou as chaves novas dele). Cheio, o mais antigo sai. */
  add(s: PushSubscriptionJSON): boolean {
    if (!valid(s)) return false;
    this.#devices = this.#devices.filter((d) => d.endpoint !== s.endpoint);
    this.#devices.push(copy(s));
    if (this.#devices.length > MAX_DEVICES) this.#devices.shift();
    return true;
  }

  remove(endpoint: string): boolean {
    const before = this.#devices.length;
    this.#devices = this.#devices.filter((d) => d.endpoint !== endpoint);
    return this.#devices.length !== before;
  }
}

const copy = (s: PushSubscriptionJSON): PushSubscriptionJSON => ({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } });

/** Manda um aviso a um aparelho. `gone`: o aparelho desistiu (apagar o endereço). */
export type PushSend = (to: PushSubscriptionJSON, alert: Alert) => Promise<{ gone: boolean }>;

export interface Push {
  publicKey: string;
  send: PushSend;
}

/** Onde ficam os aparelhos que pediram avisos. */
export interface DeviceMemory {
  read(): PushSubscriptionJSON[];
  write(devices: PushSubscriptionJSON[]): void;
}

export const noDeviceMemory: DeviceMemory = { read: () => [], write: () => {} };
