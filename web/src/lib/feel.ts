// A sensação do vidro (ADR-0009): um clique sonoro curto, de um buffer pronto e
// reutilizado, e vibração só onde o navegador vibra de verdade. No iPhone não há
// chamada de vibração nenhuma (iOS 26 não deixa páginas vibrarem).

const MIN_GAP_MS = 38; // acima de ~26 por segundo os cliques se espaçam, como no seletor do iOS
const SOUND_KEY = 'rlight.sound';

export function isIOS(nav: Navigator = navigator): boolean {
  const ua = nav.userAgent;
  return !/Android/.test(ua) && (/iP(hone|ad|od)/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1));
}

export type Feel = 'minor' | 'major' | 'confirm' | 'wall';

const VIBRATION: Record<Feel, number | number[]> = { minor: 6, major: 12, confirm: [10, 40, 10], wall: 18 };
const GAIN: Record<Feel, number> = { minor: 0.26, major: 0.48, confirm: 0.5, wall: 0.6 };

/**
 * A afinação do clique pela velocidade da régua (traços por segundo): até 4/s o
 * clique de sempre; mais rápido, sobe devagar, como uma catraca girando mais
 * depressa, até meia oitava acima. Nunca vira um chiado.
 */
export function pitchFor(ticksPerSecond: number): number {
  if (!(ticksPerSecond > 4)) return 1;
  return Math.min(1.5, 1 + Math.log2(ticksPerSecond / 4) * 0.18);
}

export class Clicker {
  #ctx: AudioContext | null = null;
  #buf: AudioBuffer | null = null;
  #last = 0;
  #sound: boolean;
  readonly #vibrate: boolean;

  constructor() {
    this.#vibrate = !isIOS() && typeof navigator.vibrate === 'function';
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(SOUND_KEY);
    } catch {
      /* sem armazenamento: som ligado */
    }
    this.#sound = saved !== 'off';
  }

  get sound(): boolean {
    return this.#sound;
  }

  set sound(on: boolean) {
    this.#sound = on;
    try {
      localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
    } catch {
      /* fica só nesta visita */
    }
  }

  /** O áudio só nasce dentro de um gesto (regra dos navegadores). Chamar no pointerdown. */
  wake(): void {
    if (this.#ctx) {
      if (this.#ctx.state === 'suspended') void this.#ctx.resume();
      return;
    }
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const sr = ctx.sampleRate;
      const n = Math.floor(sr * 0.02);
      const buf = ctx.createBuffer(1, n, sr);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ch[i] = Math.sin(2 * Math.PI * (1900 - (900 * t) / 0.02) * t) * Math.exp(-t * 320) * 0.5;
      }
      this.#ctx = ctx;
      this.#buf = buf;
    } catch {
      this.#ctx = null;
    }
  }

  play(kind: Feel, rate = 1): void {
    const now = performance.now();
    if (kind !== 'confirm' && now - this.#last < MIN_GAP_MS) return;
    this.#last = now;
    if (this.#vibrate) navigator.vibrate(VIBRATION[kind]);
    if (!this.#sound || !this.#ctx || !this.#buf) return;
    const s = this.#ctx.createBufferSource();
    const g = this.#ctx.createGain();
    s.buffer = this.#buf;
    s.playbackRate.value = rate;
    g.gain.value = GAIN[kind];
    s.connect(g).connect(this.#ctx.destination);
    s.start();
  }
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
