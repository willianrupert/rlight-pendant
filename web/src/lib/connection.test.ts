import { describe, expect, it } from 'vitest';
import { Connection, type SocketLike } from './connection';

// A Connection fala com qualquer coisa que se comporte como um WebSocket do
// navegador: o de verdade, em produção, ou o cano em memória da demonstração.

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  deliver(msg: object): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

describe('Connection com um socket injetado', () => {
  it('abre pelo socket dado e conversa por ele', () => {
    const sockets: FakeSocket[] = [];
    const conn = new Connection('demo:', (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    });
    conn.start();
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.url).toBe('demo:');
    expect(conn.open).toBe(false);
    expect(conn.command({ command: 'unlock' })).toBeNull();

    sockets[0]!.open();
    expect(conn.open).toBe(true);
    const id = conn.command({ command: 'jogTo', x: 10, y: 20 });
    expect(id).not.toBeNull();
    expect(JSON.parse(sockets[0]!.sent.at(-1)!)).toEqual({ type: 'command', id, command: 'jogTo', x: 10, y: 20 });

    const results: unknown[] = [];
    conn.onResult = (rid, command, result) => results.push({ rid, command, result });
    sockets[0]!.deliver({ type: 'result', id, ok: true });
    expect(results).toEqual([{ rid: id, command: 'jogTo', result: { ok: true, hitLimit: undefined, undoable: undefined } }]);
    conn.stop();
  });
});
