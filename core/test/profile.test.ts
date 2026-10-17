import { describe, expect, it } from 'vitest';
import configDump from './fixtures/fluidnc-3.9.9/config-dump.yaml?raw';
import { parseConfigYaml, profileFromConfig, limitsOf } from '../src/profile';

// ADR-0008: tudo o que o app sabe da máquina vem da configuração da placa.
// A fixture é a saída real de $CD da máquina de referência (2026-10-17).

describe('parseConfigYaml: o subconjunto de YAML que o FluidNC usa', () => {
  const cfg = parseConfigYaml(configDump);

  it('lê mapas aninhados por indentação', () => {
    expect((cfg.axes as any).x.homing.cycle).toBe(2);
  });

  it('números, booleanos, texto com espaços e texto entre aspas', () => {
    const x = (cfg.axes as any).x;
    expect(x.steps_per_mm).toBe(110.616707);
    expect(x.soft_limits).toBe(true);
    expect((cfg['10V'] as any).speed_map).toBe('0=0.00% 1800=10.25% 4500=27.67% 9000=53.77% 13500=76.75% 18000=99.72%');
    expect(x.motor0.limit_all_pin).toBe('gpio.33:pu');
  });

  it('chave sem valor e sem filhos vira null', () => {
    expect((cfg.macros as any).startup_line0).toBeNull();
  });

  it('chave sem valor com filhos vira mapa', () => {
    expect(cfg.kinematics).toEqual({ Cartesian: null });
  });
});

describe('profileFromConfig: a máquina de referência', () => {
  const p = profileFromConfig(configDump);

  it('nome e cinemática', () => {
    expect(p.name).toBe('CNC RLight');
    expect(p.kinematics).toBe('Cartesian');
  });

  it('o curso de cada eixo, pela direção do homing', () => {
    expect(p.axes.x).toMatchObject({ min: 0, max: 1215 }); // homing para o negativo
    expect(p.axes.y).toMatchObject({ min: 0, max: 604 });
    expect(p.axes.z).toMatchObject({ min: -158, max: 0 }); // homing para o positivo
  });

  it('resolução, velocidade e aceleração', () => {
    expect(p.axes.x).toMatchObject({ stepsPerMm: 110.616707, maxRateMmPerMin: 3000, accelMmPerS2: 250, minStepMm: 0.01 });
    expect(p.axes.z).toMatchObject({ stepsPerMm: 401.764648, maxRateMmPerMin: 4000, minStepMm: 0.01 });
  });

  it('a ordem do homing: Z, depois X, depois Y', () => {
    expect(p.homingOrder).toEqual(['z', 'x', 'y']);
    expect(p.canHome).toBe(true);
    expect(p.mustHome).toBe(true);
  });

  it('o spindle: faixa e tempos de rampa', () => {
    expect(p.spindle).toEqual({ type: '10V', minRpm: 0, minRunningRpm: 900, maxRpm: 18000, spinupMs: 5000, spindownMs: 10000 });
  });

  it('apalpador e cartão SD configurados', () => {
    // Configurado não quer dizer presente: em 2026-10-17 a placa não tinha cartão.
    expect(p.hasProbe).toBe(true);
    expect(p.hasSd).toBe(true);
  });

  it('a tolerância de quina do planejador', () => {
    expect(p.junctionDeviationMm).toBe(0.01);
  });

  it('vira limites para o movimento', () => {
    expect(limitsOf(p)).toEqual({ x: { min: 0, max: 1215 }, y: { min: 0, max: 604 }, z: { min: -158, max: 0 } });
  });
});

describe('profileFromConfig: outras máquinas (configurações sintéticas)', () => {
  const minimal = (extra: string) =>
    [
      'name: Pequena',
      'kinematics:',
      '  CoreXY:',
      'axes:',
      '  x:',
      '    steps_per_mm: 80',
      '    max_rate_mm_per_min: 5000',
      '    acceleration_mm_per_sec2: 500',
      '    max_travel_mm: 300',
      extra,
    ].join('\n');

  it('CoreXY é reconhecida', () => {
    expect(profileFromConfig(minimal('')).kinematics).toBe('CoreXY');
  });

  it('sem homing: sem curso conhecido e sem homing possível', () => {
    const p = profileFromConfig(minimal(''));
    expect(p.canHome).toBe(false);
    expect(p.axes.x?.min).toBeNull();
    expect(limitsOf(p)).toEqual({});
  });

  it('sem SD, sem apalpador e sem spindle', () => {
    const p = profileFromConfig(minimal(''));
    expect(p.hasSd).toBe(false);
    expect(p.hasProbe).toBe(false);
    expect(p.spindle).toBeNull();
  });

  it('menor rotação útil: com o mapa partindo de 0=0%, o inversor segue desde baixo; fica em 5% do máximo', () => {
    // A máquina de referência: 1800 rpm é só um ponto da curva, não um piso.
    const ref = profileFromConfig(minimal('10V:\n  speed_map: 0=0.00% 1800=10.25% 18000=99.72%'));
    expect(ref.spindle?.minRunningRpm).toBe(900);
    const p = profileFromConfig(minimal('PWM:\n  speed_map: 0=0% 500=5% 24000=100%'));
    expect(p.spindle?.minRunningRpm).toBe(500);
  });

  it('menor rotação útil: sem 0=0% no mapa, o primeiro valor diferente de zero é o piso', () => {
    expect(profileFromConfig(minimal('PWM:\n  speed_map: 0=20% 6000=20% 24000=100%')).spindle?.minRunningRpm).toBe(6000);
    expect(profileFromConfig(minimal('PWM:\n  speed_map: 6000=20% 24000=100%')).spindle?.minRunningRpm).toBe(6000);
  });

  it('sem speed_map, a menor rotação útil é a mínima', () => {
    const p = profileFromConfig(minimal('Relay:\n  spinup_ms: 1000'));
    expect(p.spindle?.minRunningRpm).toBe(0);
  });

  it('apalpador com NO_PIN não conta', () => {
    expect(profileFromConfig(minimal('probe:\n  pin: NO_PIN')).hasProbe).toBe(false);
  });

  it('passo mínimo honesto para uma máquina grosseira', () => {
    expect(profileFromConfig(minimal('')).axes.x?.minStepMm).toBe(0.02); // 80 passos/mm
  });

  it('homing com mpos_mm deslocado', () => {
    const cfg = minimal('    homing:\n      cycle: 1\n      positive_direction: true\n      mpos_mm: 10');
    expect(profileFromConfig(cfg).axes.x).toMatchObject({ min: -290, max: 10 });
  });
});
