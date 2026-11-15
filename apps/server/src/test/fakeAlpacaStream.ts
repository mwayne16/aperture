import { decode, encode } from '@msgpack/msgpack';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';

type Frame = Record<string, unknown>;
type Channel = 'trades' | 'quotes';

/**
 * A local stand-in for one of Alpaca's market-data stream endpoints, speaking its protocol as the SDK
 * implements it: msgpack frames in arrays, a "connected" greeting, an auth handshake, subscription
 * acknowledgements and numbered errors. Tests set how it answers and push trades and quotes through it.
 */
export class FakeAlpacaStream {
  /** Every message a client sent, decoded. */
  readonly received: Frame[] = [];
  readonly subscribed: Record<Channel, Set<string>> = { trades: new Set(), quotes: new Set() };
  connections = 0;
  /** How to answer a client's auth message: accept it, or send this error (and close the connection). */
  authReply: 'ok' | { code: number; msg: string } = 'ok';
  /** When set, a subscription that would exceed it is refused with error 405. */
  symbolLimit: number | null = null;

  private readonly server: WebSocketServer;
  private readonly sockets = new Set<WebSocket>();

  private constructor(server: WebSocketServer) {
    this.server = server;
    server.on('connection', (socket) => {
      this.connections += 1;
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
      socket.on('message', (data: Buffer) => {
        this.handle(socket, decode(data) as Frame);
      });
      this.sendTo(socket, [{ T: 'success', msg: 'connected' }]);
    });
  }

  static async start(): Promise<FakeAlpacaStream> {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    return new FakeAlpacaStream(server);
  }

  get url(): string {
    return `ws://127.0.0.1:${String((this.server.address() as AddressInfo).port)}`;
  }

  /** Sends frames to every connected client. Dates become msgpack timestamps, as Alpaca sends them. */
  send(frames: Frame[]): void {
    for (const socket of this.sockets) this.sendTo(socket, frames);
  }

  trade(symbol: string, price: unknown, at: unknown): void {
    this.send([{ T: 't', S: symbol, i: 1, x: 'V', p: price, s: 100, t: at, c: ['@'], z: 'C' }]);
  }

  quote(symbol: string, bid: number, ask: number, at: Date): void {
    this.send([
      { T: 'q', S: symbol, bx: 'V', bp: bid, bs: 2, ax: 'V', ap: ask, as: 3, t: at, c: ['R'], z: 'C' },
    ]);
  }

  /** Drops every connection without a close handshake, like a network failure. */
  dropConnections(): void {
    for (const socket of this.sockets) socket.terminate();
  }

  async stop(): Promise<void> {
    this.dropConnections();
    await new Promise<void>((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }

  private handle(socket: WebSocket, message: Frame): void {
    this.received.push(message);
    if (message.action === 'auth') {
      if (this.authReply === 'ok') {
        this.sendTo(socket, [{ T: 'success', msg: 'authenticated' }]);
      } else {
        this.sendTo(socket, [{ T: 'error', ...this.authReply }]);
        socket.close();
      }
      return;
    }
    const adding = message.action === 'subscribe';
    if (!adding && message.action !== 'unsubscribe') return;
    const wanted = (channel: Channel) =>
      Array.isArray(message[channel]) ? (message[channel] as string[]) : [];
    if (adding && this.symbolLimit !== null) {
      const total = new Set([...this.subscribed.trades, ...wanted('trades')]).size;
      if (total > this.symbolLimit) {
        this.sendTo(socket, [{ T: 'error', code: 405, msg: 'symbol limit exceeded' }]);
        return;
      }
    }
    for (const channel of ['trades', 'quotes'] as const) {
      for (const symbol of wanted(channel)) {
        if (adding) this.subscribed[channel].add(symbol);
        else this.subscribed[channel].delete(symbol);
      }
    }
    this.sendTo(socket, [
      {
        T: 'subscription',
        trades: [...this.subscribed.trades],
        quotes: [...this.subscribed.quotes],
        bars: [],
        updatedBars: [],
        dailyBars: [],
        statuses: [],
        lulds: [],
        corrections: [],
        cancelErrors: [],
      },
    ]);
  }

  private sendTo(socket: WebSocket, frames: Frame[]): void {
    socket.send(encode(frames));
  }
}
