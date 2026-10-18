import { describe, expect, it } from 'vitest';
import preamble from './fixtures/fluidnc-3.9.9/preamble.txt?raw';
import statusAlarm from './fixtures/fluidnc-3.9.9/status-alarm.txt?raw';
import statusHome from './fixtures/fluidnc-3.9.9/status-home.txt?raw';
import statusJog from './fixtures/fluidnc-3.9.9/status-jog.txt?raw';
import { applyReport, parseLine, parseStatus } from '../src/protocol';

const lines = (s: string) => s.split('\n').filter(Boolean);

// Fixtures reais: tráfego gravado da máquina de referência no spike S1
// (FluidNC v3.9.9, 2026-10-17), sem os dados da rede.

describe('relatório de estado: tráfego real', () => {
  it('toda linha gravada é lida como estado', () => {
    for (const line of lines(statusAlarm)) expect(parseLine(line).kind).toBe('status');
  });

  it('o relatório curto: estado, posição de máquina e avanço/rotação', () => {
    expect(parseStatus('<Alarm|MPos:0.000,0.000,0.000|FS:0,0>')).toEqual({
      state: 'Alarm',
      subState: null,
      mpos: { x: 0, y: 0, z: 0 },
      feed: 0,
      spindle: 0,
    });
  });

  it('o relatório com o offset da peça, que vem de tempos em tempos', () => {
    const r = parseStatus('<Alarm|MPos:0.000,0.000,0.000|FS:0,0|WCO:0.000,0.000,0.000>');
    expect(r?.wco).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('relatório de estado: homing e jog reais', () => {
  it('o homing traz o estado Home, a velocidade de busca e o pino do fim de curso', () => {
    const reports = lines(statusHome).map((l) => parseStatus(l));
    expect(reports.every((r) => r !== null)).toBe(true);
    expect(reports.some((r) => r!.state === 'Home')).toBe(true);
    expect(reports.some((r) => r!.pins === 'X')).toBe(true);
  });

  it('um jog real do Z: posição descendo, avanço reportado e volta a Idle', () => {
    const reports = lines(statusJog).map((l) => parseStatus(l)!);
    const jog = reports.filter((r) => r.state === 'Jog');
    expect(jog.length).toBeGreaterThan(50);
    expect(jog.some((r) => r.feed === 100)).toBe(true);
    const zs = jog.map((r) => r.mpos!.z);
    for (let i = 1; i < zs.length; i++) expect(zs[i]!).toBeLessThanOrEqual(zs[i - 1]!);
    expect(reports[reports.length - 1]!.state).toBe('Idle');
  });
});

describe('relatório de estado: formatos documentados do FluidNC', () => {
  // Ainda não vistos na bancada; a confirmar quando a máquina rodar.
  it('subestado do Hold', () => {
    const r = parseStatus('<Hold:0|MPos:412.300,118.050,-3.200|FS:0,12000>');
    expect(r?.state).toBe('Hold');
    expect(r?.subState).toBe(0);
  });

  it('corte rodando do SD, com overrides', () => {
    const r = parseStatus('<Run|MPos:412.300,118.050,-3.200|FS:1480,12000|Ov:100,100,110|SD:42.50,/sd/placa.nc>');
    expect(r).toMatchObject({
      state: 'Run',
      feed: 1480,
      spindle: 12000,
      overrides: { feed: 100, rapid: 100, spindle: 110 },
      sd: { percent: 42.5, file: '/sd/placa.nc' },
    });
  });

  it('posição de trabalho, buffer, pinos e acessórios', () => {
    const r = parseStatus('<Jog|WPos:1.000,-2.500,0.000|Bf:15,128|FS:2000,0|Pn:XZ|A:SF>');
    expect(r).toMatchObject({
      state: 'Jog',
      wpos: { x: 1, y: -2.5, z: 0 },
      buffer: { blocks: 15, bytes: 128 },
      pins: 'XZ',
      accessories: 'SF',
    });
  });

  it('só o avanço, sem rotação', () => {
    expect(parseStatus('<Idle|MPos:0.000,0.000,0.000|F:500>')?.feed).toBe(500);
  });

  it('eixos extras são ignorados sem quebrar X, Y e Z', () => {
    expect(parseStatus('<Idle|MPos:1.000,2.000,3.000,90.000|FS:0,0>')?.mpos).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('estado desconhecido ou linha malformada não vira estado', () => {
    expect(parseStatus('<Dancing|MPos:0,0,0>')).toBeNull();
    expect(parseStatus('<Idle|MPos:a,b,c>')).toBeNull();
    expect(parseStatus('Idle|MPos:0,0,0')).toBeNull();
  });
});

describe('outras mensagens', () => {
  it('ok, erro e alarme', () => {
    expect(parseLine('ok')).toEqual({ kind: 'ok' });
    expect(parseLine('error:15')).toEqual({ kind: 'error', code: 15 });
    expect(parseLine('ALARM:1')).toEqual({ kind: 'alarm', code: 1 });
  });

  it('mensagens, modos do G-code, offsets e versão', () => {
    expect(parseLine('[MSG:Machine: CNC RLight]')).toEqual({ kind: 'msg', text: 'Machine: CNC RLight' });
    expect(parseLine('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]')).toEqual({
      kind: 'gcodeState',
      words: ['G0', 'G54', 'G17', 'G21', 'G90', 'G94', 'M5', 'M9', 'T0', 'F0', 'S0'],
    });
    expect(parseLine('[G54:188.000,182.000,-105.000]')).toEqual({
      kind: 'offset',
      name: 'G54',
      value: { x: 188, y: 182, z: -105 },
    });
    expect(parseLine('[TLO:0.000]')).toEqual({ kind: 'toolLength', value: 0 });
    expect(parseLine('[VER:3.9 FluidNC v3.9.9:]')).toEqual({ kind: 'version', text: 'FluidNC v3.9.9' });
  });

  it('o preâmbulo real é todo reconhecido', () => {
    const kinds = lines(preamble).map((l) => parseLine(l).kind);
    expect(kinds).not.toContain('other');
    expect(kinds.filter((k) => k === 'offset')).toHaveLength(9); // G54–G59, G28, G30, G92
  });
});

describe('applyReport: o estado vivo da máquina', () => {
  it('lembra o offset da peça entre relatórios que não o trazem', () => {
    let s = applyReport(null, parseStatus('<Idle|MPos:100.000,50.000,-10.000|FS:0,0|WCO:20.000,10.000,-5.000>')!);
    s = applyReport(s, parseStatus('<Idle|MPos:101.000,50.000,-10.000|FS:0,0>')!);
    expect(s.wco).toEqual({ x: 20, y: 10, z: -5 });
    expect(s.wpos).toEqual({ x: 81, y: 40, z: -5 });
  });

  it('com posição de trabalho e offset, calcula a de máquina', () => {
    let s = applyReport(null, parseStatus('<Idle|MPos:0.000,0.000,0.000|FS:0,0|WCO:20.000,10.000,-5.000>')!);
    s = applyReport(s, parseStatus('<Jog|WPos:1.000,2.000,3.000|FS:0,0>')!);
    expect(s.mpos).toEqual({ x: 21, y: 12, z: -2 });
  });

  it('lembra os overrides e esquece o SD quando ele some do relatório', () => {
    let s = applyReport(null, parseStatus('<Run|MPos:0.000,0.000,0.000|FS:0,0|Ov:90,100,110|SD:10.00,/sd/a.nc>')!);
    s = applyReport(s, parseStatus('<Idle|MPos:0.000,0.000,0.000|FS:0,0>')!);
    expect(s.overrides).toEqual({ feed: 90, rapid: 100, spindle: 110 });
    expect(s.sd).toBeNull();
  });

  it('spindle ligado vem do campo A:, que chega junto com o Ov', () => {
    // Como no Grbl: o A: só aparece no relatório que traz o Ov; Ov sem A: = tudo desligado.
    let s = applyReport(null, parseStatus('<Idle|MPos:0.000,0.000,0.000|FS:0,0>')!);
    expect(s.spindleOn).toBe(false);
    s = applyReport(s, parseStatus('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100|A:S>')!);
    expect(s.spindleOn).toBe(true);
    s = applyReport(s, parseStatus('<Idle|MPos:0.000,0.000,0.000|FS:0,0>')!);
    expect(s.spindleOn).toBe(true); // relatório sem Ov: mantém o que se sabia
    s = applyReport(s, parseStatus('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>')!);
    expect(s.spindleOn).toBe(false);
  });

  it('rotação reportada acima de zero já prova que está ligado, sem esperar o A:', () => {
    // O A: vem a cada ~10 relatórios; a rotação vem em todos. O Grbl zera a rotação
    // no M5, então rotação > 0 só existe com o spindle acionado. Antes, "Ligando…"
    // durava ~2,5 s para uma rampa de 0,3 s (visto na máquina).
    let s = applyReport(null, parseStatus('<Idle|MPos:0.000,0.000,0.000|FS:0,0>')!);
    s = applyReport(s, parseStatus('<Idle|MPos:0.000,0.000,0.000|FS:0,1100>')!);
    expect(s.spindleOn).toBe(true);
  });

  it('spindle girando em S0 (máquina que não desliga com S0) continua ligado', () => {
    const s = applyReport(null, parseStatus('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100|A:S>')!);
    expect(s.spindle).toBe(0);
    expect(s.spindleOn).toBe(true);
  });

  it('anti-horário (C) também é ligado; refrigeração sozinha não', () => {
    expect(applyReport(null, parseStatus('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100|A:C>')!).spindleOn).toBe(true);
    expect(applyReport(null, parseStatus('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100|A:F>')!).spindleOn).toBe(false);
  });

  it('sem offset conhecido, a posição de trabalho fica desconhecida', () => {
    const s = applyReport(null, parseStatus('<Idle|MPos:1.000,2.000,3.000|FS:0,0>')!);
    expect(s.wpos).toBeNull();
  });
});
