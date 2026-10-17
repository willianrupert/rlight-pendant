import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseLine, profileFromConfig } from '@rlight/core';
import { FakeFluidNC } from './fake-fluidnc';
import { rawClient, sleep, until } from './helpers';

// O FluidNC falso precisa falar como a placa real, senão os testes do servidor
// passam contra uma placa que não existe.

let fake: FakeFluidNC;
let client: Awaited<ReturnType<typeof rawClient>>;

beforeEach(async () => {
  fake = new FakeFluidNC();
  client = await rawClient(await fake.listen());
  await until(() => fake.connections === 1);
});

afterEach(async () => {
  client.close();
  await fake.close();
});

const statusLines = () => client.lines.filter((l) => l.startsWith('<'));

describe('FakeFluidNC: respostas no formato real', () => {
  it('responde a ? com o relatório curto gravado', async () => {
    client.send('?');
    await until(() => statusLines().length === 1);
    expect(statusLines()[0]).toBe('<Alarm|MPos:0.000,0.000,0.000|FS:0,0>');
  });

  it('WCO e Ov vêm de tempos em tempos, como no tráfego real', async () => {
    client.send('?'.repeat(20));
    await until(() => statusLines().length === 20);
    expect(statusLines().filter((l) => l.includes('WCO:'))).toHaveLength(2);
    expect(statusLines().filter((l) => l.includes('Ov:'))).toHaveLength(2);
    for (const l of statusLines()) expect(parseLine(l).kind).toBe('status');
  });

  it('$CD devolve a configuração gravada, que vira o perfil da máquina', async () => {
    client.send('$CD\n');
    await until(() => client.lines.includes('ok'));
    const yaml = client.lines.slice(0, client.lines.indexOf('ok')).join('\n');
    const profile = profileFromConfig(yaml);
    expect(profile.name).toBe('CNC RLight');
    expect(profile.axes.x?.max).toBe(1215);
  });

  it('$I, $G e $# como no preâmbulo gravado', async () => {
    client.send('$I\n$G\n$#\n');
    await until(() => client.lines.filter((l) => l === 'ok').length === 3);
    expect(client.lines[0]).toBe('[VER:3.9 FluidNC v3.9.9:]');
    expect(client.lines).toContain('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
    expect(client.lines).toContain('[TLO:0.000]');
  });
});

describe('FakeFluidNC: movimento', () => {
  it('em alarme recusa jog; $X desbloqueia', async () => {
    client.send('$J=G53 G90 X1.000 F1000\n');
    await until(() => client.lines.includes('error:9'));
    client.send('$X\n');
    await until(() => client.lines.includes('ok'));
    expect(fake.state).toBe('Idle');
  });

  it('um jog absoluto leva a posição até o destino', async () => {
    fake.state = 'Idle';
    client.send('$J=G53 G90 X2.000 Y-1.500 F6000\n');
    await until(() => fake.state === 'Jog');
    await until(() => fake.state === 'Idle');
    expect(fake.mpos).toEqual({ x: 2, y: -1.5, z: 0 });
  });

  it('reenviar o mesmo jog absoluto não anda a mais', async () => {
    fake.state = 'Idle';
    client.send('$J=G53 G90 X1.000 F6000\n$J=G53 G90 X1.000 F6000\n');
    await sleep(100);
    expect(fake.mpos.x).toBe(1);
  });

  it('0x85 cancela o jog onde estiver', async () => {
    fake.state = 'Idle';
    client.send('$J=G53 G90 X100.000 F600\n');
    await until(() => fake.mpos.x > 0);
    client.send(Buffer.from([0x85]));
    await until(() => fake.state === 'Idle');
    expect(fake.mpos.x).toBeGreaterThan(0);
    expect(fake.mpos.x).toBeLessThan(100);
  });

  it('o homing mostra Pn e termina em repouso', async () => {
    client.send('$H\n?');
    await until(() => statusLines().length === 1);
    expect(statusLines()[0]).toMatch(/^<Home\|.*\|Pn:X>$/);
    await until(() => fake.state === 'Idle');
  });
});

describe('FakeFluidNC: falhas', () => {
  it('congela sem responder e depois atende o que chegou', async () => {
    fake.freeze(150);
    client.send('?');
    await sleep(100);
    expect(statusLines()).toHaveLength(0);
    await until(() => statusLines().length === 1);
  });

  it('derruba a conexão', async () => {
    const closed = new Promise((r) => client.sock.once('close', r));
    fake.dropConnections();
    await closed;
  });

  it('alarme manda ALARM e muda o estado', async () => {
    fake.state = 'Idle';
    fake.alarm(1);
    await until(() => client.lines.includes('ALARM:1'));
    client.send('?');
    await until(() => statusLines()[0]?.startsWith('<Alarm'));
  });
});
