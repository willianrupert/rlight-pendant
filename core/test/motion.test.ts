import { describe, expect, it } from 'vitest';
import { clampToLimits, formatJog, goTo, leadForStep, nudge, resync, zBarrier, type MachineLimits } from '../src/motion';

// ADR-0002: todo movimento manual é absoluto, tem destino e respeita o curso.
// Os limites vêm da placa (ADR-0008); aqui usamos um perfil de exemplo.
const limits: MachineLimits = {
  x: { min: 0, max: 1215 },
  y: { min: 0, max: 604 },
  z: { min: -158, max: 0 },
};

describe('clampToLimits', () => {
  it('mantém valores dentro do curso', () => {
    expect(clampToLimits(limits, 'x', 412.3)).toEqual({ value: 412.3, hitLimit: false });
  });

  it('recorta nas duas pontas e avisa', () => {
    expect(clampToLimits(limits, 'x', 1300)).toEqual({ value: 1215, hitLimit: true });
    expect(clampToLimits(limits, 'z', -200)).toEqual({ value: -158, hitLimit: true });
  });

  it('eixo sem limites conhecidos passa sem recorte', () => {
    expect(clampToLimits({}, 'x', 5000)).toEqual({ value: 5000, hitLimit: false });
  });
});

describe('nudge: a régua move o alvo comandado', () => {
  it('soma o passo ao alvo, não à posição reportada', () => {
    const r = nudge({ axis: 'x', delta: 0.1, commanded: 100.2, reported: 100.15, limits });
    expect(r.target).toBe(100.3);
    expect(r.refused).toBeNull();
  });

  it('não acumula erro de ponto flutuante', () => {
    let target = 0;
    for (let i = 0; i < 3; i++) target = nudge({ axis: 'x', delta: 0.1, commanded: target, reported: target, limits }).target;
    expect(target).toBe(0.3);
  });

  it('para no fim do curso', () => {
    const r = nudge({ axis: 'x', delta: 1, commanded: 1214.5, reported: 1214.5, limits });
    expect(r.target).toBe(1215);
    expect(r.refused).toBe('limit');
  });

  it('não deixa o alvo passar 2 mm à frente da máquina', () => {
    const r = nudge({ axis: 'x', delta: 0.5, commanded: 101.8, reported: 100, limits });
    expect(r.target).toBe(101.8);
    expect(r.refused).toBe('lead');
  });

  it('voltar em direção à máquina é sempre permitido', () => {
    const r = nudge({ axis: 'x', delta: -0.5, commanded: 101.8, reported: 100, limits });
    expect(r.target).toBe(101.3);
    expect(r.refused).toBeNull();
  });

  it('o avanço máximo é configurável', () => {
    const r = nudge({ axis: 'x', delta: 1, commanded: 100, reported: 100, limits, maxLeadMm: 0.5 });
    expect(r.refused).toBe('lead');
  });
});

describe('goTo: o fantasma vai até um ponto', () => {
  it('leva X e Y ao destino', () => {
    expect(goTo({ x: 300, y: 200 }, limits)).toEqual({ target: { x: 300, y: 200 }, hitLimit: false });
  });

  it('o fantasma não passa da borda', () => {
    expect(goTo({ x: -20, y: 700 }, limits)).toEqual({ target: { x: 0, y: 604 }, hitLimit: true });
  });
});

describe('zBarrier: a superfície da peça', () => {
  it('descendo de cima, para no zero da peça', () => {
    expect(zBarrier({ startWorkZ: 3, requestedWorkZ: -0.5 })).toEqual({ workZ: 0, stopped: true });
  });

  it('um gesto novo que começa na superfície passa abaixo dela', () => {
    expect(zBarrier({ startWorkZ: 0, requestedWorkZ: -0.5 })).toEqual({ workZ: -0.5, stopped: false });
  });

  it('subir nunca é barrado', () => {
    expect(zBarrier({ startWorkZ: -2, requestedWorkZ: 1 })).toEqual({ workZ: 1, stopped: false });
  });

  it('descer sem cruzar a superfície não é barrado', () => {
    expect(zBarrier({ startWorkZ: 5, requestedWorkZ: 1 })).toEqual({ workZ: 1, stopped: false });
  });
});

describe('formatJog: o comando que vai para a placa', () => {
  it('é absoluto, em coordenadas de máquina, com três casas', () => {
    expect(formatJog({ x: 412.3 }, 2000)).toBe('$J=G53 G90 X412.300 F2000');
  });

  it('ordena os eixos e omite os que não mudam', () => {
    expect(formatJog({ y: 10, x: 5.0006 }, 1500)).toBe('$J=G53 G90 X5.001 Y10.000 F1500');
  });

  it('números negativos e zero', () => {
    expect(formatJog({ z: -0 }, 300)).toBe('$J=G53 G90 Z0.000 F300');
    expect(formatJog({ z: -3.2 }, 300)).toBe('$J=G53 G90 Z-3.200 F300');
  });

  it('reenviar o mesmo comando dá o mesmo texto: é idempotente', () => {
    expect(formatJog({ x: 1 }, 100)).toBe(formatJog({ x: 1 }, 100));
  });

  it('recusa comando sem eixo ou com avanço inválido', () => {
    expect(() => formatJog({}, 1000)).toThrow();
    expect(() => formatJog({ x: 1 }, 0)).toThrow();
    expect(() => formatJog({ x: Number.NaN }, 1000)).toThrow();
  });
});

describe('resync: ao voltar o sinal, o alvo vira a posição real', () => {
  it('descarta o alvo antigo', () => {
    expect(resync({ x: 120, y: 40, z: -1 })).toEqual({ x: 120, y: 40, z: -1 });
  });
});

describe('leadForStep: quanto a régua pode ficar à frente, conforme o passo', () => {
  it('nunca menos que 2 mm', () => {
    expect(leadForStep(0.01)).toBe(2);
    expect(leadForStep(0.1)).toBe(2);
  });

  it('quatro passos nos passos grandes', () => {
    expect(leadForStep(1)).toBe(4);
    expect(leadForStep(10)).toBe(40);
    expect(leadForStep(100)).toBe(400);
  });
});
