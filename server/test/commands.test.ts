import { describe, expect, it } from 'vitest';
import { applyReport, parseStatus, profileFromConfig, type MachineSnapshot } from '@rlight/core';
import configDump from '../../core/test/fixtures/fluidnc-3.9.9/config-dump.yaml?raw';
import { DEFAULT_MOTION, planCommand, type CommandContext } from '../src/commands';
import { ControlSession, REASON_TAKEN } from '../src/control';
import { parseClientMessage } from '../src/messages';

const profile = profileFromConfig(configDump);
const snap = (line: string): MachineSnapshot => applyReport(null, parseStatus(line)!);
const idleAt = (x: number, y: number, z: number) => snap(`<Idle|MPos:${x},${y},${z}|FS:0,0>`);
/** Parada, com o offset da peça já informado pela placa. */
const idleWithWco = (wco: string) => snap(`<Idle|MPos:100,200,-10|FS:0,0|WCO:${wco}>`);

const ctx = (over: Partial<CommandContext> = {}): CommandContext => ({
  snapshot: idleAt(100, 200, -10),
  profile,
  link: 'live',
  inControl: true,
  homed: true,
  commanded: {},
  motion: DEFAULT_MOTION,
  now: 1_000_000,
  lastZero: null,
  ...over,
});

describe('planCommand: a policy vem antes de tudo', () => {
  it('sem sinal, nada sai, com o motivo', () => {
    expect(planCommand({ command: 'nudge', axis: 'x', delta: 1 }, ctx({ link: 'no-signal' }))).toEqual({
      ok: false,
      reason: 'Sem sinal da máquina',
    });
  });

  it('quem só assiste não comanda', () => {
    const p = planCommand({ command: 'nudge', axis: 'x', delta: 1 }, ctx({ inControl: false }));
    expect(p).toEqual({ ok: false, reason: 'Outra tela está no controle' });
  });

  it('em alarme, só desbloquear, homing e reset', () => {
    const alarm = snap('<Alarm|MPos:0,0,0|FS:0,0>');
    expect(planCommand({ command: 'nudge', axis: 'x', delta: 1 }, ctx({ snapshot: alarm })).ok).toBe(false);
    expect(planCommand({ command: 'unlock' }, ctx({ snapshot: alarm }))).toMatchObject({
      ok: true,
      writes: [{ line: '$X' }],
    });
  });

  it('ir até o fantasma exige homing', () => {
    const p = planCommand({ command: 'jogTo', x: 10, y: 10 }, ctx({ homed: false }));
    expect(p).toEqual({ ok: false, reason: 'Faça o homing para mover pelo mapa' });
  });

  it('sem perfil da placa, nada se move', () => {
    const p = planCommand({ command: 'nudge', axis: 'x', delta: 1 }, ctx({ profile: null }));
    expect(p).toEqual({ ok: false, reason: 'Lendo a configuração da máquina' });
  });
});

describe('planCommand: movimento absoluto (ADR-0002)', () => {
  it('a régua sai como jog absoluto a partir da posição reportada', () => {
    const p = planCommand({ command: 'nudge', axis: 'x', delta: 0.5 }, ctx());
    expect(p).toEqual({
      ok: true,
      writes: [{ line: '$J=G53 G90 X100.500 F1000' }],
      commanded: { x: 100.5 },
      hitLimit: false,
      moves: true,
    });
  });

  it('o alvo comandado acumula: o comando leva o alvo, não o incremento', () => {
    const p = planCommand({ command: 'nudge', axis: 'x', delta: 0.5 }, ctx({ commanded: { x: 101 } }));
    expect(p).toMatchObject({ writes: [{ line: '$J=G53 G90 X101.500 F1000' }], commanded: { x: 101.5 } });
  });

  it('mais de 2 mm à frente da máquina, a régua pesa', () => {
    const p = planCommand({ command: 'nudge', axis: 'x', delta: 0.5 }, ctx({ commanded: { x: 102 } }));
    expect(p).toEqual({ ok: false, reason: 'A régua está à frente da máquina' });
  });

  it('o curso da placa recorta o destino', () => {
    const p = planCommand({ command: 'nudge', axis: 'z', delta: 1 }, ctx({ snapshot: idleAt(0, 0, -0.4) }));
    expect(p).toMatchObject({ ok: true, writes: [{ line: '$J=G53 G90 Z0.000 F1000' }], hitLimit: true });
  });

  it('já na parede, nada a mandar', () => {
    const p = planCommand({ command: 'nudge', axis: 'z', delta: 1 }, ctx({ snapshot: idleAt(0, 0, 0) }));
    expect(p).toMatchObject({ ok: true, writes: [], hitLimit: true, moves: false });
  });

  it('o fantasma é recortado pelo curso e vai na velocidade máxima do eixo (S2 aprovado)', () => {
    const p = planCommand({ command: 'jogTo', x: 5000, y: 300 }, ctx());
    expect(p).toMatchObject({
      ok: true,
      writes: [{ line: '$J=G53 G90 X1215.000 Y300.000 F3000' }],
      hitLimit: true,
      commanded: { x: 1215, y: 300 },
    });
  });

  it('o avanço nunca passa do máximo do eixo', () => {
    const p = planCommand({ command: 'jogTo', x: 10, y: 10 }, ctx({ motion: { ...DEFAULT_MOTION, jogToFeedMmPerMin: 9000 } }));
    expect(p).toMatchObject({ writes: [{ line: '$J=G53 G90 X10.000 Y10.000 F3000' }] });
  });

  it('nudge com o valor absoluto: vai até ele dentro da folga', () => {
    const p = planCommand({ command: 'nudge', axis: 'x', delta: 0, to: 101, step: 0.1 }, ctx());
    expect(p).toMatchObject({ ok: true, writes: [{ line: '$J=G53 G90 X101.000 F1000' }], commanded: { x: 101 } });
  });

  it('nudge absoluto além da folga recorta e segue, nunca recusa (a régua não pula para trás)', () => {
    const p = planCommand({ command: 'nudge', axis: 'x', delta: 0, to: 150, step: 0.1 }, ctx());
    expect(p).toMatchObject({ ok: true, writes: [{ line: '$J=G53 G90 X102.000 F1000' }], commanded: { x: 102 } });
  });

  it('parar manda 0x85 e o alvo volta a seguir a posição real', () => {
    const jog = snap('<Jog|MPos:100,200,-10|FS:1000,0>');
    const p = planCommand({ command: 'cancelJog' }, ctx({ snapshot: jog, commanded: { x: 101 } }));
    expect(p).toMatchObject({ ok: true, writes: [{ realtime: 0x85 }], commanded: {} });
  });

  it('parar com a máquina já parada dá certo em silêncio (soltar a régua no fim do movimento)', () => {
    // Antes virava "Nada em andamento" na tela, um aviso que não fazia sentido para quem só soltou o dedo.
    const p = planCommand({ command: 'cancelJog' }, ctx({ commanded: { x: 101 } }));
    expect(p).toMatchObject({ ok: true, writes: [], commanded: {} });
    expect(planCommand({ command: 'cancelJog' }, ctx({ inControl: false })).ok).toBe(false);
  });
});

describe('planCommand: velocidade do fantasma sem perfil de velocidade', () => {
  it('sem velocidade máxima conhecida no eixo, cai para 2000 mm/min', () => {
    const semVelocidade = { ...profile, axes: { x: { ...profile.axes.x!, maxRateMmPerMin: 0 }, y: { ...profile.axes.y!, maxRateMmPerMin: 0 }, z: profile.axes.z! } };
    expect(planCommand({ command: 'jogTo', x: 10, y: 10 }, ctx({ profile: semVelocidade }))).toMatchObject({
      writes: [{ line: '$J=G53 G90 X10.000 Y10.000 F2000' }],
    });
  });
});

describe('planCommand: a escala da régua acompanha o passo (step)', () => {
  // Com o passo de 1 mm e só 2 mm à frente, a máquina andava aos trancos: cada
  // jog terminava antes do próximo chegar. O limite e o avanço crescem com o passo.
  it('sem step, nada muda: 2 mm à frente e o avanço da régua', () => {
    expect(planCommand({ command: 'nudge', axis: 'x', delta: 0.5 }, ctx())).toMatchObject({ writes: [{ line: '$J=G53 G90 X100.500 F1000' }] });
  });

  it('passo de 1 mm: até 4 mm à frente, a 2000 mm/min', () => {
    const ok = planCommand({ command: 'nudge', axis: 'x', delta: 1, step: 1 }, ctx({ commanded: { x: 103 } }));
    expect(ok).toMatchObject({ ok: true, writes: [{ line: '$J=G53 G90 X104.000 F2000' }] });
    const far = planCommand({ command: 'nudge', axis: 'x', delta: 1, step: 1 }, ctx({ commanded: { x: 104 } }));
    expect(far).toEqual({ ok: false, reason: 'A régua está à frente da máquina' });
  });

  it('passo fino, avanço baixo: 0,01 mm a 300 mm/min, ainda com 2 mm à frente', () => {
    expect(planCommand({ command: 'nudge', axis: 'x', delta: 0.05, step: 0.01 }, ctx())).toMatchObject({
      writes: [{ line: '$J=G53 G90 X100.050 F300' }],
    });
    expect(planCommand({ command: 'nudge', axis: 'x', delta: 0.01, step: 0.01 }, ctx({ commanded: { x: 102 } }))).toMatchObject({ ok: false });
  });

  it('passos grandes: 10 e 100 mm cabem à frente, no avanço máximo do eixo', () => {
    expect(planCommand({ command: 'nudge', axis: 'x', delta: 10, step: 10 }, ctx())).toMatchObject({
      writes: [{ line: '$J=G53 G90 X110.000 F3000' }],
    });
    expect(planCommand({ command: 'nudge', axis: 'x', delta: 100, step: 100 }, ctx())).toMatchObject({
      writes: [{ line: '$J=G53 G90 X200.000 F3000' }],
    });
  });

  it('o curso continua recortando, qualquer que seja o passo', () => {
    expect(planCommand({ command: 'nudge', axis: 'z', delta: 100, step: 100 }, ctx({ snapshot: idleAt(0, 0, -10) }))).toMatchObject({
      writes: [{ line: '$J=G53 G90 Z0.000 F3000' }],
      hitLimit: true,
    });
  });
});

describe('planCommand: ir até um ponto num eixo (jogAxisTo)', () => {
  it('vai ao destino anunciado, absoluto, no avanço do fantasma', () => {
    const p = planCommand({ command: 'jogAxisTo', axis: 'z', value: -12.5 }, ctx());
    expect(p).toEqual({
      ok: true,
      writes: [{ line: '$J=G53 G90 Z-12.500 F4000' }],
      commanded: { z: -12.5 },
      hitLimit: false,
      moves: true,
    });
  });

  it('sem o limite de 2 mm à frente: o destino já foi mostrado', () => {
    const p = planCommand({ command: 'jogAxisTo', axis: 'x', value: 600 }, ctx({ commanded: { x: 101, y: 3 } }));
    expect(p).toMatchObject({ ok: true, writes: [{ line: '$J=G53 G90 X600.000 F3000' }], commanded: { x: 600, y: 3 } });
  });

  it('o curso recorta o destino e avisa', () => {
    const p = planCommand({ command: 'jogAxisTo', axis: 'z', value: -500 }, ctx());
    expect(p).toMatchObject({ ok: true, writes: [{ line: '$J=G53 G90 Z-158.000 F4000' }], hitLimit: true, commanded: { z: -158 } });
    const q = planCommand({ command: 'jogAxisTo', axis: 'x', value: -3 }, ctx());
    expect(q).toMatchObject({ writes: [{ line: '$J=G53 G90 X0.000 F3000' }], hitLimit: true });
  });

  it('o avanço nunca passa do máximo do eixo', () => {
    const motion = { ...DEFAULT_MOTION, jogToFeedMmPerMin: 9000 };
    const p = planCommand({ command: 'jogAxisTo', axis: 'x', value: 10 }, ctx({ motion }));
    expect(p).toMatchObject({ writes: [{ line: '$J=G53 G90 X10.000 F3000' }] });
  });

  it('exige homing, pela policy do core', () => {
    const p = planCommand({ command: 'jogAxisTo', axis: 'x', value: 10 }, ctx({ homed: false }));
    expect(p).toEqual({ ok: false, reason: 'Faça o homing para mover até um ponto' });
  });

  it('sem perfil da placa, não sai', () => {
    const p = planCommand({ command: 'jogAxisTo', axis: 'x', value: 10 }, ctx({ profile: null }));
    expect(p).toEqual({ ok: false, reason: 'Lendo a configuração da máquina' });
  });
});

describe('planCommand: zerar a peça e desfazer', () => {
  it('zera um eixo e guarda o offset anterior para desfazer', () => {
    const p = planCommand({ command: 'zero', axis: 'x' }, ctx({ snapshot: idleWithWco('10,20,-5') }));
    expect(p).toEqual({
      ok: true,
      writes: [{ line: 'G10 L20 P0 X0' }],
      commanded: {},
      hitLimit: false,
      moves: false,
      undoable: true,
      lastZero: { wco: { x: 10 }, at: 1_000_000 },
    });
  });

  it('zera os três eixos de uma vez', () => {
    const p = planCommand({ command: 'zero', axis: 'all' }, ctx({ snapshot: idleWithWco('10,20,-5') }));
    expect(p).toMatchObject({
      ok: true,
      writes: [{ line: 'G10 L20 P0 X0 Y0 Z0' }],
      undoable: true,
      lastZero: { wco: { x: 10, y: 20, z: -5 }, at: 1_000_000 },
    });
  });

  it('sem saber o offset atual, não zera: não haveria como desfazer', () => {
    const p = planCommand({ command: 'zero', axis: 'z' }, ctx());
    expect(p).toEqual({ ok: false, reason: 'Ainda não sei o zero atual da peça; tente de novo em instantes' });
  });

  it('zerar passa pela policy: não durante um movimento', () => {
    const jog = snap('<Jog|MPos:100,200,-10|FS:1000,0|WCO:0,0,0>');
    expect(planCommand({ command: 'zero', axis: 'x' }, ctx({ snapshot: jog }))).toEqual({
      ok: false,
      reason: 'Espere o movimento terminar',
    });
  });

  it('desfazer devolve o offset anterior, nos mesmos eixos, uma vez só', () => {
    const lastZero = { wco: { x: 10, z: -5.25 }, at: 1_000_000 };
    const p = planCommand({ command: 'undoZero' }, ctx({ lastZero, now: 1_000_000 + 29_999 }));
    expect(p).toEqual({
      ok: true,
      writes: [{ line: 'G10 L2 P0 X10.000 Z-5.250' }],
      commanded: {},
      hitLimit: false,
      moves: false,
      lastZero: null,
    });
  });

  it('depois de 30 s, não há o que desfazer', () => {
    const lastZero = { wco: { x: 10 }, at: 1_000_000 };
    const p = planCommand({ command: 'undoZero' }, ctx({ lastZero, now: 1_000_000 + 30_001 }));
    expect(p).toEqual({ ok: false, reason: 'Nada para desfazer' });
  });

  it('sem zero recente, não há o que desfazer', () => {
    expect(planCommand({ command: 'undoZero' }, ctx())).toEqual({ ok: false, reason: 'Nada para desfazer' });
  });

  it('desfazer também passa pela policy', () => {
    const lastZero = { wco: { x: 10 }, at: 1_000_000 };
    expect(planCommand({ command: 'undoZero' }, ctx({ lastZero, inControl: false }))).toEqual({
      ok: false,
      reason: 'Outra tela está no controle',
    });
  });
});

describe('planCommand: spindle', () => {
  it('desligar durante o spin-up passa na frente: reset de tempo real, não um M5 na fila', () => {
    // O FluidNC espera o spinup_ms depois do M3 antes de ler a próxima linha: um M5
    // ficava ~5 s na fila com o spindle acelerando (visto na máquina real).
    expect(planCommand({ command: 'spindleOff' }, ctx({ spindleDwelling: true }))).toMatchObject({ ok: true, writes: [{ realtime: 0x18 }] });
    expect(planCommand({ command: 'spindleOff' }, ctx())).toMatchObject({ ok: true, writes: [{ line: 'M5' }] });
  });

  it('liga no sentido horário com a rotação pedida', () => {
    const p = planCommand({ command: 'spindleOn', rpm: 12000 }, ctx());
    expect(p).toEqual({ ok: true, writes: [{ line: 'M3 S12000' }], commanded: {}, hitLimit: false, moves: false });
  });

  it('a rotação é recortada pela faixa do perfil (0 a 18000 na RLight)', () => {
    expect(planCommand({ command: 'spindleOn', rpm: 30000 }, ctx())).toMatchObject({
      writes: [{ line: 'M3 S18000' }],
      hitLimit: true,
    });
    const narrow = { ...profile, spindle: { ...profile.spindle!, minRpm: 6000, minRunningRpm: 6000 } };
    expect(planCommand({ command: 'spindleSpeed', rpm: 1000 }, ctx({ profile: narrow }))).toMatchObject({
      writes: [{ line: 'S6000' }],
      hitLimit: true,
    });
  });

  it('puxar a rotação para 0 desliga o spindle (esta máquina não desliga com S0)', () => {
    expect(planCommand({ command: 'spindleSpeed', rpm: 0 }, ctx())).toMatchObject({ ok: true, writes: [{ line: 'M5' }] });
  });

  it('abaixo da menor rotação útil, sobe para ela (900 na RLight: 5% do máximo, a curva parte de 0=0%)', () => {
    expect(planCommand({ command: 'spindleSpeed', rpm: 500 }, ctx())).toMatchObject({ writes: [{ line: 'S900' }], hitLimit: true });
    expect(planCommand({ command: 'spindleOn', rpm: 500 }, ctx())).toMatchObject({ writes: [{ line: 'M3 S900' }], hitLimit: true });
  });

  it('ligar em 0 não faz sentido: pede uma rotação', () => {
    expect(planCommand({ command: 'spindleOn', rpm: 0 }, ctx())).toEqual({ ok: false, reason: 'Escolha uma rotação para ligar' });
    expect(planCommand({ command: 'spindleOn', rpm: -5 }, ctx())).toEqual({ ok: false, reason: 'Escolha uma rotação para ligar' });
  });

  it('muda a rotação e desliga', () => {
    expect(planCommand({ command: 'spindleSpeed', rpm: 9000.4 }, ctx())).toMatchObject({
      ok: true,
      writes: [{ line: 'S9000' }],
      hitLimit: false,
    });
    expect(planCommand({ command: 'spindleOff' }, ctx())).toMatchObject({ ok: true, writes: [{ line: 'M5' }] });
  });

  it('máquina sem spindle no perfil recusa ligar e mudar a rotação', () => {
    const none = { ...profile, spindle: null };
    const reason = 'Esta máquina não tem spindle configurado';
    expect(planCommand({ command: 'spindleOn', rpm: 1000 }, ctx({ profile: none }))).toEqual({ ok: false, reason });
    expect(planCommand({ command: 'spindleSpeed', rpm: 1000 }, ctx({ profile: none }))).toEqual({ ok: false, reason });
  });

  it('a policy vale também para o spindle', () => {
    const alarm = snap('<Alarm|MPos:0,0,0|FS:0,0>');
    expect(planCommand({ command: 'spindleOn', rpm: 1000 }, ctx({ snapshot: alarm }))).toEqual({
      ok: false,
      reason: 'Desbloqueie a máquina primeiro',
    });
  });
});

describe('ControlSession: uma tela comanda', () => {
  it('assumir é explícito e devolve quem tinha o controle', () => {
    const s = new ControlSession();
    expect(s.controller).toBeNull();
    expect(s.take('a')).toEqual({ previous: null });
    expect(s.take('b')).toEqual({ previous: 'a' });
    expect(s.isController('b')).toBe(true);
    expect(s.isController('a')).toBe(false);
    expect(REASON_TAKEN).toBeTruthy();
  });

  it('só quem tem o controle pode largá-lo', () => {
    const s = new ControlSession();
    s.take('a');
    expect(s.release('b')).toBe(false);
    expect(s.release('a')).toBe(true);
    expect(s.controller).toBeNull();
  });
});

describe('parseClientMessage', () => {
  it('nudge aceita o passo, e só um passo válido', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'command', command: 'nudge', axis: 'x', delta: 1, step: 1 }))).toEqual({
      type: 'command', command: 'nudge', axis: 'x', delta: 1, step: 1,
    });
    expect(parseClientMessage(JSON.stringify({ type: 'command', command: 'nudge', axis: 'x', delta: 1, step: 0 }))).toEqual({ invalid: 'Passo inválido' });
    expect(parseClientMessage(JSON.stringify({ type: 'command', command: 'nudge', axis: 'x', delta: 1, step: 'a' }))).toEqual({ invalid: 'Passo inválido' });
  });

  it('aceita as mensagens do protocolo', () => {
    expect(parseClientMessage('{"type":"takeControl"}')).toEqual({ type: 'takeControl' });
    expect(parseClientMessage('{"type":"command","id":"1","command":"nudge","axis":"x","delta":0.1}')).toEqual({
      type: 'command',
      id: '1',
      command: 'nudge',
      axis: 'x',
      delta: 0.1,
    });
    expect(parseClientMessage('{"type":"command","command":"cancelJog"}')).toEqual({
      type: 'command',
      command: 'cancelJog',
    });
  });

  it('aceita os comandos da v1', () => {
    expect(parseClientMessage('{"type":"command","command":"jogAxisTo","axis":"z","value":-12.5}')).toEqual({
      type: 'command',
      command: 'jogAxisTo',
      axis: 'z',
      value: -12.5,
    });
    expect(parseClientMessage('{"type":"command","command":"zero","axis":"all"}')).toEqual({
      type: 'command',
      command: 'zero',
      axis: 'all',
    });
    expect(parseClientMessage('{"type":"command","command":"undoZero"}')).toEqual({
      type: 'command',
      command: 'undoZero',
    });
    expect(parseClientMessage('{"type":"command","id":"s","command":"spindleOn","rpm":12000}')).toEqual({
      type: 'command',
      id: 's',
      command: 'spindleOn',
      rpm: 12000,
    });
    expect(parseClientMessage('{"type":"command","command":"spindleSpeed","rpm":9000}')).toEqual({
      type: 'command',
      command: 'spindleSpeed',
      rpm: 9000,
    });
    expect(parseClientMessage('{"type":"command","command":"spindleOff"}')).toEqual({
      type: 'command',
      command: 'spindleOff',
    });
  });

  it('recusa o que não entende, com o motivo', () => {
    expect(parseClientMessage('não é json')).toEqual({ invalid: 'JSON inválido' });
    expect(parseClientMessage('{"type":"command","command":"nudge","axis":"a","delta":1}')).toEqual({
      invalid: 'Eixo inválido',
    });
    expect(parseClientMessage('{"type":"command","command":"jogTo","x":"1","y":2}')).toEqual({
      invalid: 'Destino inválido',
    });
    expect(parseClientMessage('{"type":"command","command":"probeZ"}')).toEqual({
      invalid: 'Comando desconhecido: probeZ',
    });
    expect(parseClientMessage('{"type":"command","command":"spindleOn"}')).toEqual({ invalid: 'Rotação inválida' });
    expect(parseClientMessage('{"type":"command","command":"zero","axis":"a"}')).toEqual({ invalid: 'Eixo inválido' });
    expect(parseClientMessage('{"type":"command","command":"jogAxisTo","axis":"z","value":"1"}')).toEqual({
      invalid: 'Destino inválido',
    });
  });
});
