// Os trabalhos (v2, ADR-0006): a biblioteca de arquivos de G-code no servidor e
// a conferência de cada um contra a máquina. O arquivo chega pela tela (o
// seletor de arquivos do iPhone, ou arrastar no Mac) e fica no RLIGHT_STATE_DIR.
// Cortar vai rodar do cartão SD da placa; até lá, o trabalho já é lido,
// conferido, mostrado na mesa e contornado no ar.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  analyzeToolpath,
  checkToolpath,
  estimateTime,
  limitsOf,
  parseGcode,
  previewOf,
  type Box,
  type GcodeProblem,
  type JobPreview,
  type MachineProfile,
  type Vec3,
} from '@rlight/core';

/** O maior arquivo aceito. Um trabalho do Fusion de uma hora tem algumas centenas de KB. */
export const MAX_JOB_BYTES = 8 * 1024 * 1024;
/** Quantos trabalhos a biblioteca guarda; cheia, o mais antigo sai. */
export const MAX_JOBS = 40;

export interface JobInfo {
  id: string;
  name: string;
  bytes: number;
  addedAt: number;
}

export interface JobDetail {
  id: string;
  name: string;
  /** O zero da peça usado na conferência (o G54 da placa); null se a placa ainda não disse. */
  workOffset: Vec3 | null;
  /** O homing vale: a posição na mesa e o curso querem dizer algo. */
  homed: boolean;
  bounds: { work: Box | null; machine: Box | null };
  maxDepthMm: number;
  cuttingDistanceMm: number;
  estimatedS: number;
  tools: number[];
  spindleSpeeds: number[];
  lineCount: number;
  /** Bloqueios antes dos avisos, em português. */
  problems: GcodeProblem[];
  preview: JobPreview;
}

/**
 * Um id de 16 dígitos hexadecimais. Só precisa não repetir (não é segredo), e
 * sem node:crypto o mesmo código roda na demonstração, dentro do navegador.
 */
function newId(): string {
  let id = '';
  while (id.length < 16) id += Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return id;
}

/** Só o nome do arquivo, sem pasta nem caracteres de controle, de tamanho razoável. */
export function cleanName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
  return clean || 'Sem nome';
}

export class JobStore {
  #jobs: JobInfo[] = [];
  readonly #texts = new Map<string, string>();

  /** `dir` null: só na memória (testes, demonstração). */
  constructor(private readonly dir: string | null) {
    if (!dir) return;
    try {
      const saved = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as JobInfo[];
      this.#jobs = Array.isArray(saved) ? saved.filter((j) => typeof j?.id === 'string' && /^[0-9a-f]{16}$/.test(j.id)) : [];
    } catch {
      this.#jobs = [];
    }
  }

  /** Do mais novo para o mais antigo. */
  get list(): JobInfo[] {
    return [...this.#jobs].sort((a, b) => b.addedAt - a.addedAt).map((j) => ({ ...j }));
  }

  get(id: string): JobInfo | null {
    const j = this.#jobs.find((x) => x.id === id);
    return j ? { ...j } : null;
  }

  add(name: string, text: string, now: number): { ok: true; job: JobInfo } | { ok: false; reason: string } {
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes === 0) return { ok: false, reason: 'O arquivo está vazio' };
    if (bytes > MAX_JOB_BYTES) return { ok: false, reason: 'O arquivo passa de 8 MB' };
    // Um arquivo binário (uma imagem, um .f3d) não é G-code.
    if (text.includes('\u0000')) return { ok: false, reason: 'Isso não é um arquivo de G-code' };
    const job: JobInfo = { id: newId(), name: cleanName(name), bytes, addedAt: now };
    if (this.dir) {
      try {
        mkdirSync(this.dir, { recursive: true });
        writeFileSync(join(this.dir, `${job.id}.nc`), text);
      } catch {
        return { ok: false, reason: 'O servidor não conseguiu guardar o arquivo' };
      }
    }
    this.#texts.set(job.id, text);
    this.#jobs.push(job);
    while (this.#jobs.length > MAX_JOBS) {
      const oldest = this.#jobs.reduce((a, b) => (b.addedAt < a.addedAt ? b : a));
      this.remove(oldest.id);
    }
    this.#save();
    return { ok: true, job: { ...job } };
  }

  text(id: string): string | null {
    if (!this.#jobs.some((j) => j.id === id)) return null;
    const cached = this.#texts.get(id);
    if (cached !== undefined) return cached;
    if (!this.dir) return null;
    try {
      const t = readFileSync(join(this.dir, `${id}.nc`), 'utf8');
      this.#texts.set(id, t);
      return t;
    } catch {
      return null;
    }
  }

  remove(id: string): boolean {
    const before = this.#jobs.length;
    this.#jobs = this.#jobs.filter((j) => j.id !== id);
    if (this.#jobs.length === before) return false;
    this.#texts.delete(id);
    if (this.dir) {
      try {
        rmSync(join(this.dir, `${id}.nc`), { force: true });
      } catch {
        /* sobra um arquivo órfão; não atrapalha */
      }
    }
    this.#save();
    return true;
  }

  #save(): void {
    if (!this.dir) return;
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(join(this.dir, 'index.json'), JSON.stringify(this.#jobs) + '\n');
    } catch {
      /* a biblioteca vale até o próximo reinício */
    }
  }
}

/**
 * Lê e confere um trabalho contra a máquina como ela está agora: o zero da
 * peça, o curso e as velocidades. Muda quando o zero muda; por isso é refeito
 * a cada vez que a tela abre o trabalho.
 */
export function inspectJob(
  job: JobInfo,
  text: string,
  machine: { profile: MachineProfile; workOffset: Vec3 | null; homed: boolean },
): JobDetail {
  const workOffset = machine.workOffset;
  const path = parseGcode(text, { workOffset: workOffset ?? { x: 0, y: 0, z: 0 } });
  const a = analyzeToolpath(path);
  // Sem homing, o curso não diz nada sobre onde o trabalho cai: só os problemas do arquivo.
  const limits = machine.homed ? limitsOf(machine.profile) : {};
  const problems = machine.homed ? checkToolpath(path, limits) : orderProblems(path.problems);
  return {
    id: job.id,
    name: job.name,
    workOffset,
    homed: machine.homed,
    bounds: workOffset && machine.homed ? a.bounds : { work: a.bounds.work, machine: null },
    maxDepthMm: a.maxDepthMm,
    cuttingDistanceMm: Math.round(a.cuttingDistanceMm),
    estimatedS: Math.round(estimateTime(path, machine.profile).totalS),
    tools: a.tools,
    spindleSpeeds: a.spindleSpeeds,
    lineCount: a.lineCount,
    problems,
    preview: previewOf(path),
  };
}

function orderProblems(ps: GcodeProblem[]): GcodeProblem[] {
  return [...ps.filter((p) => p.severity === 'block'), ...ps.filter((p) => p.severity === 'warning')];
}
