import { describe, expect, it } from 'vitest';
import { formatDistance, formatDuration, parseThickness, probeLine } from './automations';

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

describe('o hodômetro, em palavras', () => {
  it('distância: mm perto, metros, quilômetros', () => {
    expect(formatDistance(0)).toBe('0 mm');
    expect(formatDistance(640.4)).toBe('640 mm');
    expect(formatDistance(12_400)).toBe('12,4 m');
    expect(formatDistance(1_234_000)).toBe('1,23 km');
  });

  it('tempo: segundos, minutos, horas e minutos', () => {
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(45_000)).toBe('45 s');
    expect(formatDuration(12 * 60_000 + 20_000)).toBe('12 min');
    expect(formatDuration(72 * 60_000)).toBe('1 h 12 min');
  });
});
