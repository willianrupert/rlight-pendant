import { describe, expect, it } from 'vitest';
import { parseThickness, probeLine } from './automations';

describe('a placa de toque, em frases', () => {
  it('cada fase diz o que a máquina está fazendo', () => {
    expect(probeLine(null)).toBeNull();
    expect(probeLine({ status: 'seeking' })).toBe('Descendo até encostar na placa…');
    expect(probeLine({ status: 'measuring' })).toBe('Encostou. Medindo de novo, devagar…');
    expect(probeLine({ status: 'done' })).toBe('Z zerado. A fresa está 5 mm acima da placa.');
  });

  it('a falha diz o motivo que a máquina deu', () => {
    expect(probeLine({ status: 'failed', reason: 'A fresa não encostou na placa. Aproxime mais e tente de novo.' })).toBe(
      'A fresa não encostou na placa. Aproxime mais e tente de novo.',
    );
    expect(probeLine({ status: 'failed' })).toBe('A medição não terminou.');
  });
});

describe('a espessura da placa', () => {
  it('aceita vírgula ou ponto', () => {
    expect(parseThickness('10')).toBe(10);
    expect(parseThickness('10,5')).toBe(10.5);
    expect(parseThickness(' 0.8 ')).toBe(0.8);
  });

  it('fora de 0 a 50 mm, ou vazio, não vale', () => {
    expect(parseThickness('')).toBeNull();
    expect(parseThickness('0')).toBeNull();
    expect(parseThickness('60')).toBeNull();
    expect(parseThickness('abc')).toBeNull();
  });
});
