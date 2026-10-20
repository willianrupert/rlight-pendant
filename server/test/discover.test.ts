import { afterEach, describe, expect, it } from 'vitest';
import { BoardFinder, findBoard, identityOf, normalizeMac, parseArp, probeHost, scanForBoard, subnetHosts, type FinderBoard, type KnownBoard } from '../src/discover';
import { Board } from '../src/board';
import { FakeFluidNC } from './fake-fluidnc';
import { until } from './helpers';

// Achar a placa sozinho quando o roteador muda o IP dela: pelo MAC, que a
// própria placa diz no $I, procurando na mesma rede.

const fakes: FakeFluidNC[] = [];
afterEach(async () => {
  for (const f of fakes.splice(0)) await f.close();
});

describe('identidade', () => {
  it('lê o MAC e o nome da máquina da resposta do $I', () => {
    const text = '[VER:3.9 FluidNC v3.9.9:]\n[MSG:Machine: CNC RLight]\n[MSG:Mode=STA:SSID=x:Status=Connected:IP=192.168.88.29:MAC=20-E7-C8-1E-1E-CC]\nok\n';
    expect(identityOf(text)).toEqual({ mac: '20:E7:C8:1E:1E:CC', name: 'CNC RLight' });
    expect(identityOf('login: ')).toEqual({ mac: null, name: null });
  });

  it('MAC escrito de qualquer jeito vira um só', () => {
    expect(normalizeMac('20-e7-c8-1e-1e-cc')).toBe('20:E7:C8:1E:1E:CC');
    expect(normalizeMac('20:E7:C8:1E:1E:CC')).toBe('20:E7:C8:1E:1E:CC');
  });

  it('a rede /24 do endereço de antes', () => {
    const hosts = subnetHosts('192.168.88.52');
    expect(hosts).toHaveLength(254);
    expect(hosts[0]).toBe('192.168.88.1');
    expect(hosts.at(-1)).toBe('192.168.88.254');
    expect(subnetHosts('placa.local')).toEqual([]);
  });
});

describe('probeHost e findBoard', () => {
  it('pergunta à placa falsa quem ela é', async () => {
    const fake = new FakeFluidNC({ state: 'Idle', mac: '20-E7-C8-1E-1E-CC' });
    fakes.push(fake);
    const port = await fake.listen();
    expect(await probeHost('127.0.0.1', port, 1_500)).toMatchObject({ mac: '20:E7:C8:1E:1E:CC' });
    // Só $I: nada que mova a máquina.
    expect(fake.received.filter((l) => l !== '$I')).toEqual([]);
  });

  it('acha o endereço com o MAC certo e ignora os outros', async () => {
    const other = new FakeFluidNC({ state: 'Idle', mac: '11-11-11-11-11-11' });
    const right = new FakeFluidNC({ state: 'Idle', mac: '20-E7-C8-1E-1E-CC' });
    fakes.push(other, right);
    const p1 = await other.listen();
    const p2 = await right.listen();
    // Cada "endereço" aqui é uma porta diferente no mesmo host, pela sonda injetada.
    const ports: Record<string, number> = { a: p1, b: 1, c: p2 };
    const found = await findBoard(['a', 'b', 'c'], { mac: '20:E7:C8:1E:1E:CC' }, {
      probe: (h) => probeHost('127.0.0.1', ports[h]!, 1_000),
    });
    expect(found).toBe('c');
  });

  it('ninguém com esse MAC: nada', async () => {
    expect(await findBoard(['a', 'b'], { mac: '20:E7:C8:1E:1E:CC' }, { probe: async () => null })).toBeNull();
  });
});

describe('BoardFinder', () => {
  function rig(known: KnownBoard | null, scanResult: string | null) {
    let now = 0;
    const board: FinderBoard & { host: string; isConnected: boolean; mac: string | null } = {
      host: known?.host ?? '192.168.88.52',
      isConnected: false,
      mac: null,
      setHost(h: string) {
        this.host = h;
      },
    };
    let saved = known;
    const scans: string[][] = [];
    const finder = new BoardFinder({
      board,
      memory: { read: () => saved, write: (k) => (saved = k) },
      scan: async (hosts) => {
        scans.push(hosts);
        return scanResult;
      },
      now: () => now,
      log: () => {},
    });
    return { board, finder, scans, saved: () => saved, at: (t: number) => (now = t) };
  }

  it('conectada: guarda o endereço e o MAC que a placa disse', async () => {
    const r = rig(null, null);
    r.board.isConnected = true;
    r.board.mac = '20:E7:C8:1E:1E:CC';
    await r.finder.tick();
    expect(r.saved()).toEqual({ host: '192.168.88.52', mac: '20:E7:C8:1E:1E:CC' });
  });

  it('sumiu por 30 s: procura na rede e passa a usar o endereço novo', async () => {
    const r = rig({ host: '192.168.88.52', mac: '20:E7:C8:1E:1E:CC' }, '192.168.88.29');
    r.at(0);
    await r.finder.tick();
    r.at(29_000);
    await r.finder.tick();
    expect(r.scans).toHaveLength(0);
    r.at(30_000);
    await r.finder.tick();
    expect(r.scans).toHaveLength(1);
    expect(r.board.host).toBe('192.168.88.29');
    expect(r.saved()).toEqual({ host: '192.168.88.29', mac: '20:E7:C8:1E:1E:CC' });
  });

  it('não achou (a máquina está desligada): tenta de novo só de tempos em tempos', async () => {
    const r = rig({ host: '192.168.88.52', mac: '20:E7:C8:1E:1E:CC' }, null);
    await r.finder.tick();
    r.at(30_000);
    await r.finder.tick();
    r.at(60_000);
    await r.finder.tick();
    expect(r.scans).toHaveLength(1);
    r.at(30_000 + 120_000);
    await r.finder.tick();
    expect(r.scans).toHaveLength(2);
    expect(r.board.host).toBe('192.168.88.52');
    // Cada procura vazia dobra a espera: 2, 4, 8 min, até 15.
    r.at(30_000 + 120_000 + 239_000);
    await r.finder.tick();
    expect(r.scans).toHaveLength(2);
    r.at(30_000 + 120_000 + 240_000);
    await r.finder.tick();
    expect(r.scans).toHaveLength(3);
  });

  it('sem saber o MAC (nunca conectou), não procura: não há como reconhecer a placa', async () => {
    const r = rig(null, '192.168.88.29');
    await r.finder.tick();
    r.at(10 * 60_000);
    await r.finder.tick();
    expect(r.scans).toHaveLength(0);
  });
});

describe('ARP', () => {
  const ARP = `IP address       HW type     Flags       HW address            Mask     Device
192.168.88.1     0x1         0x2         cc:2d:e0:65:9a:f1     *        eth0
192.168.88.29    0x1         0x2         20:e7:c8:1e:1e:cc     *        eth0
192.168.88.52    0x1         0x0         00:00:00:00:00:00     *        eth0
`;

  it('lê a tabela ARP do Linux, sem as entradas incompletas', () => {
    const t = parseArp(ARP);
    expect(t.get('20:E7:C8:1E:1E:CC')).toBe('192.168.88.29');
    expect([...t.values()]).not.toContain('192.168.88.52');
  });

  it('confirma com $I só o endereço que a tabela ARP aponta', async () => {
    const fake = new FakeFluidNC({ state: 'Idle', mac: '20-E7-C8-1E-1E-CC' });
    fakes.push(fake);
    const port = await fake.listen();
    const arp = `IP address HW type Flags HW address Mask Device\n127.0.0.1 0x1 0x2 20:e7:c8:1e:1e:cc * lo\n`;
    expect(await scanForBoard(['127.0.0.1'], '20:E7:C8:1E:1E:CC', port, () => arp)).toBe('127.0.0.1');
    // Outro MAC na tabela: não acha, e não pergunta a ninguém.
    const before = fake.received.length;
    expect(await scanForBoard(['127.0.0.1'], '11:11:11:11:11:11', port, () => arp)).toBeNull();
    expect(fake.received.length).toBe(before);
  });
});

describe('Board: o MAC e o endereço novo', () => {
  it('aprende o MAC no $I e, com um endereço novo, conecta nele na hora', async () => {
    const fake = new FakeFluidNC({ state: 'Idle', mac: '20-E7-C8-1E-1E-CC' });
    fakes.push(fake);
    const port = await fake.listen();
    // Um endereço onde não há placa (como o .52 depois que o roteador mudou o IP).
    const board = new Board({ host: '203.0.113.1', port, backoffMs: [5_000], deadAfterMs: 5_000 });
    board.start();
    try {
      board.setHost('127.0.0.1');
      await until(() => board.isConnected && board.mac, { what: 'conectar no endereço novo' });
      expect(board.host).toBe('127.0.0.1');
      expect(board.mac).toBe('20:E7:C8:1E:1E:CC');
    } finally {
      board.stop();
    }
  });
});
