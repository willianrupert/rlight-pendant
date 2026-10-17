// Segurar para confirmar (ADR-0005): o perigoso só acontece depois de ~0,8 s
// de dedo parado no botão, com progresso visível. Lógica pura: a tela passa o
// relógio e desenha o progresso.

export const HOLD_MS = 800;

export interface Hold {
  startedAt: number | null;
  fired: boolean;
}

export const idleHold = (): Hold => ({ startedAt: null, fired: false });

export function pressHold(_h: Hold, now: number): Hold {
  return { startedAt: now, fired: false };
}

export function releaseHold(): Hold {
  return idleHold();
}

/** Progresso de 0 a 1 e se a ação deve disparar agora (uma vez só). */
export function holdProgress(h: Hold, now: number, ms = HOLD_MS): { progress: number; fire: boolean; next: Hold } {
  if (h.startedAt === null) return { progress: 0, fire: false, next: h };
  const progress = Math.min(1, Math.max(0, (now - h.startedAt) / ms));
  const fire = progress >= 1 && !h.fired;
  return { progress, fire, next: fire ? { ...h, fired: true } : h };
}
