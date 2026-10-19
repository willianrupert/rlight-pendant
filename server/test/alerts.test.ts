import { describe, expect, it } from 'vitest';
import { ALERT_COOLDOWN_MS, AlertWatcher, LOST_BUSY_MS, SPINDLE_IDLE_MS, type Seen } from '../src/alerts';

// Quando o servidor avisa o celular: só o que precisa de alguém na máquina.
// Normal não vira aviso; o mesmo aviso não se repete em rajada.

const idle = (spindleOn = false): Seen => ({ live: true, state: 'Idle', spindleOn });
const kinds = (w: AlertWatcher, seen: Seen, now: number) => w.observe(seen, now).map((a) => a.kind);

describe('AlertWatcher: alarme', () => {
  it('um alarme com código avisa, com a causa em palavras', () => {
    const w = new AlertWatcher();
    const a = w.onAlarm(1, 1_000);
    expect(a).toMatchObject({ kind: 'alarm', title: 'Alarme na CNC', body: 'Um fim de curso foi acionado.', badge: 1 });
  });

  it('o mesmo alarme em rajada (uma chave batendo) avisa uma vez só', () => {
    const w = new AlertWatcher();
    expect(w.onAlarm(1, 0)).not.toBeNull();
    expect(w.onAlarm(1, 5_000)).toBeNull();
    expect(w.onAlarm(2, 10_000)).toBeNull();
    expect(w.onAlarm(1, ALERT_COOLDOWN_MS + 1)).not.toBeNull();
  });
});

describe('AlertWatcher: spindle esquecido', () => {
  it('girando com a máquina parada por 10 min: avisa uma vez', () => {
    const w = new AlertWatcher();
    expect(kinds(w, idle(true), 0)).toEqual([]);
    expect(kinds(w, idle(true), SPINDLE_IDLE_MS - 1)).toEqual([]);
    expect(kinds(w, idle(true), SPINDLE_IDLE_MS)).toEqual(['spindleIdle']);
    expect(kinds(w, idle(true), SPINDLE_IDLE_MS * 3)).toEqual([]);
  });

  it('um movimento no meio recomeça a conta', () => {
    const w = new AlertWatcher();
    w.observe(idle(true), 0);
    w.observe({ live: true, state: 'Jog', spindleOn: true }, SPINDLE_IDLE_MS - 1_000);
    expect(kinds(w, idle(true), SPINDLE_IDLE_MS + 1_000)).toEqual([]);
    expect(kinds(w, idle(true), 2 * SPINDLE_IDLE_MS)).toEqual([]);
    expect(kinds(w, idle(true), 2 * SPINDLE_IDLE_MS + 1_000)).toEqual(['spindleIdle']);
  });

  it('desligou e ligou de novo: pode avisar outra vez', () => {
    const w = new AlertWatcher();
    w.observe(idle(true), 0);
    expect(kinds(w, idle(true), SPINDLE_IDLE_MS)).toEqual(['spindleIdle']);
    w.observe(idle(false), SPINDLE_IDLE_MS + 1);
    w.observe(idle(true), SPINDLE_IDLE_MS + 2);
    expect(kinds(w, idle(true), 2 * SPINDLE_IDLE_MS + 2)).toEqual(['spindleIdle']);
  });

  it('o spindle parado não conta', () => {
    const w = new AlertWatcher();
    w.observe(idle(false), 0);
    expect(kinds(w, idle(false), 10 * SPINDLE_IDLE_MS)).toEqual([]);
  });
});

describe('AlertWatcher: a máquina saiu do ar', () => {
  it('o sinal caiu com o spindle ligado: avisa depois de um tempo, não num soluço', () => {
    const w = new AlertWatcher();
    w.observe(idle(true), 0);
    const lost: Seen = { live: false, state: 'Idle', spindleOn: true };
    expect(kinds(w, lost, 1_000)).toEqual([]);
    expect(kinds(w, lost, 1_000 + LOST_BUSY_MS - 1)).toEqual([]);
    const [a] = w.observe(lost, 1_000 + LOST_BUSY_MS);
    expect(a).toMatchObject({ kind: 'lost', title: 'A CNC saiu do ar', body: 'O sinal caiu com o spindle ligado.' });
    expect(kinds(w, lost, 10 * LOST_BUSY_MS)).toEqual([]);
  });

  it('no meio de um movimento, diz que foi no movimento', () => {
    const w = new AlertWatcher();
    w.observe({ live: true, state: 'Jog', spindleOn: false }, 0);
    w.observe({ live: false, state: 'Jog', spindleOn: false }, 100);
    const [a] = w.observe({ live: false, state: 'Jog', spindleOn: false }, 100 + LOST_BUSY_MS);
    expect(a?.body).toBe('O sinal caiu no meio de um movimento.');
  });

  it('parada e com o spindle desligado, sair do ar é só desligar: nada a avisar', () => {
    const w = new AlertWatcher();
    w.observe(idle(false), 0);
    expect(kinds(w, { live: false, state: 'Idle', spindleOn: false }, 10 * LOST_BUSY_MS)).toEqual([]);
  });

  it('o sinal volta antes do prazo: nada', () => {
    const w = new AlertWatcher();
    w.observe(idle(true), 0);
    w.observe({ live: false, state: 'Idle', spindleOn: true }, 1_000);
    w.observe(idle(true), 2_000);
    expect(kinds(w, { live: false, state: 'Idle', spindleOn: true }, 3_000 + LOST_BUSY_MS - 1)).toEqual([]);
  });

  it('nunca teve sinal (o servidor acabou de ligar): nada', () => {
    const w = new AlertWatcher();
    expect(kinds(w, { live: false, state: null, spindleOn: false }, 10 * LOST_BUSY_MS)).toEqual([]);
  });
});

