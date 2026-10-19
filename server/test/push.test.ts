import { describe, expect, it } from 'vitest';
import { isPushEndpoint, MAX_DEVICES, PushStore, type PushSubscriptionJSON } from '../src/push';

// Os aparelhos que pediram avisos: quem é, até quantos, e para onde o servidor
// aceita mandar (só os serviços de push dos navegadores, nunca um endereço qualquer).

const sub = (n: number, host = 'web.push.apple.com'): PushSubscriptionJSON => ({
  endpoint: `https://${host}/QG${n}`,
  keys: { p256dh: `p${n}`, auth: `a${n}` },
});

describe('isPushEndpoint', () => {
  it('aceita os serviços de push da Apple, do Google, da Mozilla e da Microsoft', () => {
    for (const host of ['web.push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com', 'wns2-by3p.notify.windows.com']) {
      expect(isPushEndpoint(`https://${host}/x`)).toBe(true);
    }
  });

  it('recusa http, outros endereços e imitações', () => {
    expect(isPushEndpoint('http://web.push.apple.com/x')).toBe(false);
    expect(isPushEndpoint('https://192.168.1.1/x')).toBe(false);
    expect(isPushEndpoint('https://push.apple.com.evil.example/x')).toBe(false);
    expect(isPushEndpoint('https://evilpush.apple.com/x')).toBe(false);
    expect(isPushEndpoint('nada')).toBe(false);
  });
});

describe('PushStore', () => {
  it('guarda, troca as chaves do mesmo aparelho e apaga', () => {
    const s = new PushStore([]);
    expect(s.add(sub(1))).toBe(true);
    expect(s.add({ ...sub(1), keys: { p256dh: 'novo', auth: 'a' } })).toBe(true);
    expect(s.list).toHaveLength(1);
    expect(s.list[0]?.keys.p256dh).toBe('novo');
    expect(s.remove(sub(1).endpoint)).toBe(true);
    expect(s.remove(sub(1).endpoint)).toBe(false);
  });

  it('recusa endereço que não é de push e chaves faltando', () => {
    const s = new PushStore([]);
    expect(s.add(sub(1, 'example.com'))).toBe(false);
    expect(s.add({ endpoint: sub(2).endpoint, keys: { p256dh: '', auth: 'a' } })).toBe(false);
    expect(s.list).toEqual([]);
  });

  it('cheio, o aparelho mais antigo dá lugar ao novo', () => {
    const s = new PushStore([]);
    for (let i = 0; i < MAX_DEVICES + 1; i++) s.add(sub(i));
    expect(s.list).toHaveLength(MAX_DEVICES);
    expect(s.list.some((d) => d.endpoint === sub(0).endpoint)).toBe(false);
  });

  it('o que veio do disco também passa pela conferência', () => {
    const s = new PushStore([sub(1), sub(2, 'example.com')]);
    expect(s.list.map((d) => d.endpoint)).toEqual([sub(1).endpoint]);
  });
});
