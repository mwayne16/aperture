import type { RealtimeServerMessage } from '@aperture/shared/realtime';
import WebSocket from 'ws';

type MessageOf<T extends RealtimeServerMessage['type']> = Extract<RealtimeServerMessage, { type: T }>;

/**
 * A realtime client for tests. It keeps every message it receives, so a test can wait for the next message
 * of a type or look at all of them.
 */
export class RealtimeTestClient {
  readonly socket: WebSocket;
  readonly messages: RealtimeServerMessage[] = [];
  closeCode: number | null = null;
  private read = 0;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', (data: Buffer) => {
      this.messages.push(JSON.parse(data.toString('utf8')) as RealtimeServerMessage);
    });
    socket.on('close', (code) => {
      this.closeCode = code;
    });
  }

  /** Opens a connection and waits until it is open. Rejects with the HTTP status when it is refused. */
  static open(url: string, options: WebSocket.ClientOptions = {}): Promise<RealtimeTestClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, options);
      const client = new RealtimeTestClient(socket);
      socket.once('open', () => {
        resolve(client);
      });
      socket.once('unexpected-response', (_request, response) => {
        reject(new Error(`HTTP ${String(response.statusCode)}`));
      });
      socket.once('error', reject);
    });
  }

  send(message: unknown): void {
    this.socket.send(typeof message === 'string' ? message : JSON.stringify(message));
  }

  /** The next message of `type` not yet returned by this method, waiting up to `timeoutMs` for it. */
  async next<T extends RealtimeServerMessage['type']>(type: T, timeoutMs = 3_000): Promise<MessageOf<T>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = this.messages.findIndex((message, i) => i >= this.read && message.type === type);
      if (index !== -1) {
        this.read = index + 1;
        return this.messages[index] as MessageOf<T>;
      }
      if (Date.now() > deadline) throw new Error(`No ${type} message within ${String(timeoutMs)} ms`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /** All messages of `type` received so far. */
  all<T extends RealtimeServerMessage['type']>(type: T): MessageOf<T>[] {
    return this.messages.filter((message): message is MessageOf<T> => message.type === type);
  }

  close(): void {
    this.socket.close();
  }
}
