// Os avisos no celular, do lado do app (o servidor decide quando avisar:
// server/src/alerts.ts). Puro, para servir à tela e ao service worker.

import type { MachineState } from '@rlight/core';

/** O aviso como o servidor manda. */
export interface PushAlert {
  kind: string;
  title: string;
  body: string;
  badge: number;
}

/** O que a tela de Automações mostra sobre os avisos. */
export type NotifyStatus =
  /** O servidor não manda avisos: nada a mostrar. */
  | 'unavailable'
  /** No iPhone, só o app da tela de início recebe avisos. */
  | 'install'
  | 'unsupported'
  /** Recusado: só nos Ajustes do aparelho. */
  | 'blocked'
  | 'off'
  | 'on';

export interface DeviceFacts {
  /** O servidor mandou a chave dos avisos. */
  serverKey: boolean;
  pushManager: boolean;
  notification: boolean;
  /** Aberto da tela de início (display-mode: standalone). */
  standalone: boolean;
  ios: boolean;
  permission: NotificationPermission;
  /** Este aparelho tem inscrição no servidor de agora. */
  subscribed: boolean;
}

export function notifyStatus(d: DeviceFacts): NotifyStatus {
  if (!d.serverKey) return 'unavailable';
  if (!d.pushManager || !d.notification) return d.ios && !d.standalone ? 'install' : 'unsupported';
  if (d.permission === 'denied') return 'blocked';
  return d.permission === 'granted' && d.subscribed ? 'on' : 'off';
}

/** A chave pública do servidor (base64url, como o VAPID usa) em bytes. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** A inscrição foi feita com esta chave? Se o servidor trocou de chave, ela não vale mais. */
export function sameKey(subscriptionKey: ArrayBuffer | null, serverKey: string): boolean {
  if (!subscriptionKey) return false;
  const a = new Uint8Array(subscriptionKey);
  const b = keyBytes(serverKey);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

const FALLBACK: PushAlert = { kind: 'other', title: 'CNC', body: 'Abra o app para ver a máquina.', badge: 0 };

/** O aviso que chegou ao service worker. Sempre vira uma notificação: o iPhone exige. */
export function alertFromPush(text: string | undefined): PushAlert {
  try {
    const a = JSON.parse(text ?? '') as Partial<PushAlert>;
    if (typeof a.title !== 'string' || typeof a.body !== 'string') return FALLBACK;
    return { kind: typeof a.kind === 'string' ? a.kind : 'other', title: a.title, body: a.body, badge: typeof a.badge === 'number' ? a.badge : 0 };
  } catch {
    return FALLBACK;
  }
}

/** O número no ícone do app: 1 em alarme. Sem leitura ao vivo, null (não mexe). */
export function badgeFor(state: MachineState | null, live: boolean): number | null {
  if (!live || !state) return null;
  return state === 'Alarm' ? 1 : 0;
}
