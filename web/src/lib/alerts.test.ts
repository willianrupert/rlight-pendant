import { describe, expect, it } from 'vitest';
import { alertFromPush, badgeFor, keyBytes, notifyStatus, sameKey, type DeviceFacts } from './alerts';

// Os avisos no celular, do lado do app: o que a tela de Automações mostra, o que
// o service worker faz com um aviso, e o número no ícone.

const iphone = (over: Partial<DeviceFacts> = {}): DeviceFacts => ({
  serverKey: true,
  pushManager: true,
  notification: true,
  standalone: true,
  ios: true,
  permission: 'default',
  subscribed: false,
  ...over,
});

describe('notifyStatus', () => {
  it('servidor sem avisos: nada a mostrar', () => {
    expect(notifyStatus(iphone({ serverKey: false }))).toBe('unavailable');
  });

  it('no Safari do iPhone, fora da tela de início: pede para instalar', () => {
    expect(notifyStatus(iphone({ standalone: false, pushManager: false, notification: false }))).toBe('install');
  });

  it('navegador sem push, fora do iPhone: não dá', () => {
    expect(notifyStatus(iphone({ ios: false, standalone: false, pushManager: false }))).toBe('unsupported');
  });

  it('recusado nos ajustes: diz onde ligar', () => {
    expect(notifyStatus(iphone({ permission: 'denied' }))).toBe('blocked');
  });

  it('pronto: ligado ou desligado conforme a inscrição', () => {
    expect(notifyStatus(iphone())).toBe('off');
    expect(notifyStatus(iphone({ permission: 'granted', subscribed: true }))).toBe('on');
    // Permissão dada, mas a inscrição sumiu (o servidor trocou de chave): desligado.
    expect(notifyStatus(iphone({ permission: 'granted', subscribed: false }))).toBe('off');
  });
});

describe('keyBytes e sameKey', () => {
  it('a chave do servidor (base64url) vira bytes, e compara com a da inscrição', () => {
    const key = 'AQID_-8';
    expect([...keyBytes(key)]).toEqual([1, 2, 3, 255, 239]);
    expect(sameKey(new Uint8Array([1, 2, 3, 255, 239]).buffer, key)).toBe(true);
    expect(sameKey(new Uint8Array([1, 2, 3]).buffer, key)).toBe(false);
    expect(sameKey(null, key)).toBe(false);
  });
});

describe('alertFromPush', () => {
  it('lê o aviso do servidor', () => {
    expect(alertFromPush('{"kind":"alarm","title":"Alarme na CNC","body":"Um fim de curso foi acionado.","badge":1}')).toEqual({
      kind: 'alarm',
      title: 'Alarme na CNC',
      body: 'Um fim de curso foi acionado.',
      badge: 1,
    });
  });

  it('aviso ilegível ainda vira uma notificação (o iPhone exige uma por aviso)', () => {
    expect(alertFromPush('lixo')).toEqual({ kind: 'other', title: 'CNC', body: 'Abra o app para ver a máquina.', badge: 0 });
    expect(alertFromPush(undefined).title).toBe('CNC');
  });
});

describe('badgeFor', () => {
  it('1 no alarme, nada no resto; sem leitura ao vivo, não mexe', () => {
    expect(badgeFor('Alarm', true)).toBe(1);
    expect(badgeFor('Idle', true)).toBe(0);
    expect(badgeFor('Alarm', false)).toBeNull();
    expect(badgeFor(null, true)).toBeNull();
  });
});
