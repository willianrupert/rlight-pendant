import { describe, expect, it } from 'vitest';
import { Odometer } from '../src/odometer';

// O hodômetro da máquina: quanto cada eixo andou e quanto o spindle ficou ligado,
// hoje (no fuso da oficina) e desde sempre. O embrião dos contadores de manutenção.

const at = (x: number, y = 0, z = 0) => ({ x, y, z });
// 18/10/2026 às 10:00 em São Paulo (13:00 UTC).
const T0 = Date.UTC(2026, 9, 18, 13, 0, 0);

describe('Odometer', () => {
  it('soma o quanto cada eixo andou, só com a máquina andando', () => {
    const o = new Odometer(null, 'America/Sao_Paulo');
    o.onReport(at(0, 0, 0), false, 'Idle', T0);
    o.onReport(at(10, 5, -2), false, 'Jog', T0 + 100);
    o.onReport(at(30, 5, -2), false, 'Jog', T0 + 200);
    o.onReport(at(40, 5, -2), false, 'Idle', T0 + 300); // o último trecho conta
    o.onReport(at(40, 5, -2), false, 'Idle', T0 + 400);
    expect(o.snapshot.today).toEqual({ x: 40, y: 5, z: 2, spindleMs: 0 });
    expect(o.snapshot.total).toEqual({ x: 40, y: 5, z: 2, spindleMs: 0 });
  });

  it('um salto de posição (reconexão, reset) não conta como andar', () => {
    const o = new Odometer(null, 'America/Sao_Paulo');
    o.onReport(at(0), false, 'Jog', T0);
    o.onReport(at(900), false, 'Jog', T0 + 100);
    expect(o.snapshot.today.x).toBe(0);
  });

  it('depois de uma queda, o primeiro relatório só marca o ponto', () => {
    const o = new Odometer(null, 'America/Sao_Paulo');
    o.onReport(at(0), false, 'Jog', T0);
    o.reconnected();
    o.onReport(at(50), false, 'Jog', T0 + 5_000);
    expect(o.snapshot.today.x).toBe(0);
  });

  it('conta o tempo de spindle ligado, sem contar os buracos de relatório', () => {
    const o = new Odometer(null, 'America/Sao_Paulo');
    o.onReport(at(0), true, 'Idle', T0);
    o.onReport(at(0), true, 'Idle', T0 + 250);
    o.onReport(at(0), true, 'Idle', T0 + 60_000); // um minuto sem relatório: conta no máximo 2 s
    o.onReport(at(0), false, 'Idle', T0 + 60_250);
    expect(o.snapshot.today.spindleMs).toBe(250 + 2_000 + 250);
  });

  it('virou o dia na oficina: o "hoje" recomeça, o total continua', () => {
    const o = new Odometer(null, 'America/Sao_Paulo');
    const lateNight = Date.UTC(2026, 9, 19, 2, 59, 0); // 23:59 em São Paulo
    o.onReport(at(0), false, 'Jog', lateNight);
    o.onReport(at(10), false, 'Jog', lateNight + 100);
    const nextDay = Date.UTC(2026, 9, 19, 3, 1, 0); // 00:01
    o.onReport(at(10), false, 'Jog', nextDay);
    o.onReport(at(15), false, 'Jog', nextDay + 100);
    expect(o.snapshot.day).toBe('2026-10-19');
    expect(o.snapshot.today.x).toBe(5);
    expect(o.snapshot.total.x).toBe(15);
  });

  it('continua de onde parou (o que foi salvo)', () => {
    const o = new Odometer({ day: '2026-10-18', today: { x: 1, y: 2, z: 3, spindleMs: 4 }, total: { x: 10, y: 20, z: 30, spindleMs: 40 } }, 'America/Sao_Paulo');
    o.onReport(at(0), false, 'Jog', T0);
    o.onReport(at(1), false, 'Jog', T0 + 100);
    expect(o.snapshot.today.x).toBe(2);
    expect(o.snapshot.total.x).toBe(11);
  });
});
