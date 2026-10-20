import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { profileFromConfig, type MachineProfile } from '@rlight/core';
import { cleanName, inspectJob, JobStore, MAX_JOBS } from '../src/jobs';

// A biblioteca de trabalhos e a conferência de cada um contra a máquina.

const square = `G21 G90
G0 Z5
G0 X0 Y0
G1 Z-3 F300
G1 X100 F1200
G1 Y50
G1 X0
G1 Y0
G0 Z5
M30`;

describe('JobStore', () => {
  it('guarda, lista do mais novo ao mais antigo, e apaga', () => {
    const s = new JobStore(null);
    const a = s.add('a.nc', square, 1);
    const b = s.add('b.nc', square, 2);
    expect(a.ok && b.ok).toBe(true);
    expect(s.list.map((j) => j.name)).toEqual(['b.nc', 'a.nc']);
    if (!a.ok) return;
    expect(s.text(a.job.id)).toBe(square);
    expect(s.remove(a.job.id)).toBe(true);
    expect(s.text(a.job.id)).toBeNull();
  });

  it('recusa vazio e binário', () => {
    const s = new JobStore(null);
    expect(s.add('x.nc', '', 1)).toEqual({ ok: false, reason: 'O arquivo está vazio' });
    expect(s.add('x.f3d', 'PK\u0003\u0004\u0000\u0000', 1)).toEqual({ ok: false, reason: 'Isso não é um arquivo de G-code' });
  });

  it('cheia, o mais antigo sai', () => {
    const s = new JobStore(null);
    for (let i = 0; i <= MAX_JOBS; i++) s.add(`${i}.nc`, square, i);
    expect(s.list).toHaveLength(MAX_JOBS);
    expect(s.list.some((j) => j.name === '0.nc')).toBe(false);
  });

  it('sobrevive a um reinício do servidor', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'rlight-jobs-')), 'jobs');
    const first = new JobStore(dir);
    const r = first.add('peça.nc', square, 5);
    if (!r.ok) throw new Error('não guardou');
    const again = new JobStore(dir);
    expect(again.list).toEqual([r.job]);
    expect(again.text(r.job.id)).toBe(square);
  });

  it('o nome é só o do arquivo', () => {
    expect(cleanName('../../etc/passwd')).toBe('passwd');
    expect(cleanName('C:\\Users\\x\\Tampa.nc')).toBe('Tampa.nc');
    expect(cleanName('  \u0007 ')).toBe('Sem nome');
  });
});

/** Uma máquina como a RLight: X e Y de 0 a −800/−600 com o zero no fim de curso, Z de 0 a −100. */
function profile(): MachineProfile {
  const axis = (travel: number, rate: number, accel: number) =>
    `    max_rate_mm_per_min: ${rate}\n    acceleration_mm_per_sec2: ${accel}\n    max_travel_mm: ${travel}\n    soft_limits: true\n    homing:\n      cycle: 1\n      positive_direction: true\n      mpos_mm: 0`;
  const yaml = `axes:\n  x:\n${axis(800, 3000, 250)}\n  y:\n${axis(600, 3000, 250)}\n  z:\n${axis(100, 4000, 200)}\n`;
  return profileFromConfig(yaml);
}

describe('inspectJob', () => {
  it('confere contra o zero da peça e o curso; mede, estima e desenha', () => {
    const s = new JobStore(null);
    const r = s.add('tampa.nc', square, 1);
    if (!r.ok) throw new Error('não guardou');
    const d = inspectJob(r.job, square, { profile: profile(), workOffset: { x: -500, y: -400, z: -60 }, homed: true });
    expect(d.bounds.work).toEqual({ min: { x: 0, y: 0, z: -3 }, max: { x: 100, y: 50, z: 5 } });
    expect(d.bounds.machine?.min).toEqual({ x: -500, y: -400, z: -63 });
    expect(d.maxDepthMm).toBe(3);
    expect(d.problems).toEqual([]);
    expect(d.estimatedS).toBeGreaterThan(0);
    expect(d.preview.cuts[0]).toEqual([0, 0, 100, 0, 100, 50, 0, 50, 0, 0]);
  });

  it('fora do curso: bloqueia, com o eixo e quanto passa', () => {
    const r = new JobStore(null).add('grande.nc', square, 1);
    if (!r.ok) throw new Error('não guardou');
    const d = inspectJob(r.job, square, { profile: profile(), workOffset: { x: -50, y: -400, z: -60 }, homed: true });
    expect(d.problems[0]).toMatchObject({ severity: 'block', code: 'out-of-travel', axis: 'x' });
  });

  it('sem homing: não confere o curso nem põe na mesa', () => {
    const r = new JobStore(null).add('tampa.nc', square, 1);
    if (!r.ok) throw new Error('não guardou');
    const d = inspectJob(r.job, square, { profile: profile(), workOffset: { x: -50, y: -400, z: -60 }, homed: false });
    expect(d.bounds.machine).toBeNull();
    expect(d.problems.some((p) => p.code === 'out-of-travel')).toBe(false);
  });
});
