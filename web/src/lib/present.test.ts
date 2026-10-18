import { describe, expect, it } from 'vitest';
import { boardErrorText, formatMm, formatRpm, formatFeed, presentState, linkLine, splitMm } from './present';

// DESIGN.md: palavras do ponto de vista de quem opera, vírgula decimal, ponto de milhar.

describe('números', () => {
  it('milímetros com vírgula e duas casas', () => {
    expect(formatMm(412.3)).toBe('412,30');
    expect(formatMm(-3.2)).toBe('−3,20');
    expect(formatMm(1215)).toBe('1.215,00');
    expect(formatMm(-0.001)).toBe('0,00');
  });

  it('separa inteiros e decimais para a hierarquia do DRO', () => {
    expect(splitMm(412.3)).toEqual({ sign: '', int: '412', dec: '30' });
    expect(splitMm(-12.5)).toEqual({ sign: '−', int: '12', dec: '50' });
  });

  it('rotação e avanço', () => {
    expect(formatRpm(12000)).toBe('12.000');
    expect(formatFeed(1480)).toBe('1.480');
  });
});

describe('presentState: o estado é a interface', () => {
  it('cada estado tem palavra e tom', () => {
    expect(presentState({ state: 'Idle', homed: true })).toMatchObject({ label: 'Em repouso', tone: 'idle' });
    expect(presentState({ state: 'Jog', homed: true })).toMatchObject({ label: 'Movendo', tone: 'moving' });
    expect(presentState({ state: 'Run', homed: true })).toMatchObject({ label: 'Cortando', tone: 'moving' });
    expect(presentState({ state: 'Hold', homed: true })).toMatchObject({ label: 'Em pausa', tone: 'hold' });
    expect(presentState({ state: 'Home', homed: false })).toMatchObject({ label: 'Fazendo homing', tone: 'moving' });
  });

  it('alarme ao ligar, sem homing: diz o que fazer', () => {
    expect(presentState({ state: 'Alarm', homed: false })).toEqual({
      label: 'Alarme',
      tone: 'alarm',
      detail: 'A máquina precisa de homing antes de se mover.',
    });
  });

  it('alarme com código conhecido vira causa e ação, nunca ALARM:n', () => {
    // O fim de curso faz perder a posição: a ação é o homing, não o desbloqueio.
    const p = presentState({ state: 'Alarm', homed: false, alarmCode: 1 });
    expect(p.detail).toBe('Um fim de curso foi acionado. Faça o homing para continuar.');
    expect(p.detail).not.toMatch(/ALARM/);
  });

  it('a ação vem do estado real: com a posição valendo, desbloquear', () => {
    expect(presentState({ state: 'Alarm', homed: true, alarmCode: 2 }).detail).toBe(
      'Um movimento passaria do curso da máquina e foi barrado. Desbloqueie para continuar.',
    );
  });

  it('alarme sem código com o homing valendo: a placa foi resetada (ex.: desligar no spin-up)', () => {
    expect(presentState({ state: 'Alarm', homed: true }).detail).toBe('A placa foi resetada e está travada. Desbloqueie para continuar.');
  });

  it('alarme com código desconhecido ainda é uma frase, com a ação', () => {
    expect(presentState({ state: 'Alarm', homed: true, alarmCode: 99 }).detail).toBe(
      'A máquina entrou em alarme (código 99). Desbloqueie para continuar.',
    );
  });

  it('sem leitura da máquina ainda', () => {
    expect(presentState({ state: null, homed: false })).toMatchObject({ label: 'Conectando', tone: 'idle' });
  });
});

describe('linkLine: um indicador, não três', () => {
  it('ao vivo não diz nada', () => {
    expect(linkLine({ mode: 'live', ageMs: 40, showBack: false, failedHop: null })).toBeNull();
  });

  it('"de volta" por um instante', () => {
    expect(linkLine({ mode: 'live', ageMs: 40, showBack: true, failedHop: null })).toBe('De volta');
  });

  it('sem sinal, com a idade em segundos', () => {
    expect(linkLine({ mode: 'no-signal', ageMs: 4_200, showBack: false, failedHop: 'machine' })).toBe('Sem sinal da máquina · há 4 s');
  });

  it('sem nunca ter recebido nada', () => {
    expect(linkLine({ mode: 'no-signal', ageMs: null, showBack: false, failedHop: 'server' })).toBe('Procurando a máquina');
  });

  it('idade longa em minutos', () => {
    expect(linkLine({ mode: 'no-signal', ageMs: 125_000, showBack: false, failedHop: 'server' })).toBe('Sem sinal da máquina · há 2 min');
  });
});

describe('a placa recusou', () => {
  it('cada código conhecido vira uma frase; o resto diz o número', () => {
    expect(boardErrorText(15)).toBe('A placa recusou: o destino passa do curso da máquina.');
    expect(boardErrorText(9)).toBe('A placa recusou: a máquina está travada.');
    expect(boardErrorText(8)).toBe('A placa recusou: espere a máquina parar.');
    expect(boardErrorText(77)).toBe('A placa recusou o comando (erro 77).');
  });
});
