// Os avisos no celular, a parte que fala com o mundo: o envio pela biblioteca
// web-push e o arquivo com as chaves e os aparelhos (push.ts tem o resto).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import webpush from 'web-push';
import type { DeviceMemory, Push, PushSubscriptionJSON, VapidKeys } from './push';

/**
 * O arquivo dos avisos: as chaves do servidor e os aparelhos. Sem chaves ainda
 * (primeiro uso), elas nascem aqui e são gravadas na hora.
 */
export function filePushState(path: string): { vapid: VapidKeys; devices: DeviceMemory } {
  let saved: { vapid?: VapidKeys; devices?: PushSubscriptionJSON[] } = {};
  try {
    saved = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    /* primeiro uso */
  }
  const ok = saved.vapid && typeof saved.vapid.publicKey === 'string' && typeof saved.vapid.privateKey === 'string';
  const vapid = ok ? saved.vapid! : newVapidKeys();
  let devices = Array.isArray(saved.devices) ? saved.devices : [];
  const write = () => {
    try {
      mkdirSync(dirname(path), { recursive: true });
      // A chave privada só serve para assinar avisos; mesmo assim, só o dono lê.
      writeFileSync(path, JSON.stringify({ vapid, devices }) + '\n', { mode: 0o600 });
    } catch {
      // Sem onde gravar: os avisos valem até o próximo reinício.
    }
  };
  if (!ok) write();
  return {
    vapid,
    devices: {
      read: () => devices,
      write(d) {
        devices = d;
        write();
      },
    },
  };
}

/**
 * O envio de verdade, pela biblioteca web-push. `subject` identifica quem manda
 * para o serviço de push (a Apple exige um https: ou mailto:).
 */
export function webPush(vapid: VapidKeys, subject: string): Push {
  return {
    publicKey: vapid.publicKey,
    async send(to, alert) {
      try {
        await webpush.sendNotification(to, JSON.stringify(alert), {
          vapidDetails: { subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
          // Um aviso velho não serve: se o aparelho não pegar em 1 h, que se perca.
          TTL: 3_600,
          urgency: alert.kind === 'test' ? 'normal' : 'high',
          topic: alert.kind,
        });
        return { gone: false };
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status !== 404 && status !== 410) console.log(`aviso não saiu (${status ?? (e as Error).message})`);
        return { gone: status === 404 || status === 410 };
      }
    },
  };
}

export function newVapidKeys(): VapidKeys {
  return webpush.generateVAPIDKeys();
}
