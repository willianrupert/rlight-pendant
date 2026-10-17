import { describe, expect, it } from 'vitest';
import { GhostModel, destinationText, rubber } from './map-view';

const limits = { x: { min: 0, max: 1215 }, y: { min: 0, max: 604 } };

describe('o fantasma', () => {
  it('só se pega perto do ponto real: um toque longe não move nada', () => {
    const g = new GhostModel(limits);
    expect(g.down({ x: 600, y: 300 }, { x: 100, y: 100 }, 30)).toBe(false);
    expect(g.up()).toBeNull();
  });

  it('arrastar e soltar dá um destino; a máquina não recebe nada no caminho', () => {
    const g = new GhostModel(limits);
    expect(g.down({ x: 105, y: 102 }, { x: 100, y: 100 }, 30)).toBe(true);
    g.move({ x: 415, y: 222 });
    expect(g.destination).toEqual({ x: 410, y: 220 });
    expect(g.up()).toEqual({ x: 410, y: 220 });
    expect(g.ghost).toBeNull();
  });

  it('para na borda com elástico, e o destino fica dentro da mesa', () => {
    const g = new GhostModel(limits);
    g.down({ x: 1200, y: 300 }, { x: 1200, y: 300 }, 30);
    g.move({ x: 1400, y: 300 });
    expect(g.ghost!.x).toBeGreaterThan(1215);
    expect(g.ghost!.x).toBeLessThan(1400);
    expect(g.up()).toEqual({ x: 1215, y: 300 });
  });

  it('um movimento minúsculo é só um toque', () => {
    const g = new GhostModel(limits);
    g.down({ x: 100, y: 100 }, { x: 100, y: 100 }, 30);
    g.move({ x: 100.4, y: 100.2 });
    expect(g.up()).toBeNull();
  });
});

describe('elástico', () => {
  it('dentro é identidade, fora encolhe', () => {
    expect(rubber(50, 0, 100, 10)).toBe(50);
    expect(rubber(130, 0, 100, 10)).toBeLessThan(110);
    expect(rubber(-30, 0, 100, 10)).toBeGreaterThan(-10);
  });
});

it('destino nas coordenadas do DRO', () => {
  expect(destinationText({ x: 410, y: 220 }, { x: 10, y: 20 })).toBe('X 400,00 · Y 200,00');
});
