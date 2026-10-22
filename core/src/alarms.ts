// Os códigos de alarme do Grbl, herdados pelo FluidNC, em palavras: só a causa.
// A tela junta a ação (homing ou desbloquear); o aviso no celular usa a causa
// sozinha. Um lugar só, para a tela e o aviso dizerem a mesma coisa.

const ALARMS: Record<number, string> = {
  1: 'Um fim de curso foi acionado.',
  2: 'Um movimento passaria do curso da máquina e foi barrado.',
  3: 'A máquina foi resetada no meio de um movimento.',
  4: 'O apalpador já estava acionado antes de começar.',
  5: 'O apalpador não encostou em nada.',
  6: 'O homing foi interrompido.',
  7: 'O homing parou porque a porta abriu.',
  8: 'O homing não conseguiu se afastar do fim de curso.',
  // Com os motores desligados a placa conta os passos, nada anda e a chave nunca chega.
  9: 'O homing não encontrou o fim de curso. Confira se os motores estão ligados.',
};

export function alarmCause(code: number): string {
  return ALARMS[code] ?? `A máquina entrou em alarme (código ${code}).`;
}
