import { connect, type Socket } from 'node:net';
import type { ObjectStream } from './object-storage.js';

/**
 * Two different checks live behind one interface on purpose, so callers never
 * confuse them:
 *
 *  - malware scanning (this file) answers "is this file dangerous?"
 *  - content moderation answers "does this content violate policy?"
 *
 * ClamAV can only do the first. It cannot detect CSAM and does not replace
 * moderation. Without a configured scanner, `available()` is false and media
 * stays 'unscanned' — it is never marked clean by default.
 */

export type ScanResult = {
  status: 'clean' | 'quarantined' | 'scan_failed';
  provider: string;
  details?: string;
};

export interface MediaScanner {
  /** Provider name for operator-facing status; never a credential. */
  readonly name: string;
  /** Whether this scanner is actually operational (daemon reachable/configured). */
  available(): boolean;
  /** Scan the object's real bytes, opened through the storage adapter. */
  scan(objectKey: string, mimeType: string, open: () => Promise<ObjectStream>): Promise<ScanResult>;
}

export const MEDIA_SCANNER = Symbol('MEDIA_SCANNER');

/**
 * Stub scanner: never available. Media stays 'unscanned', which the read path
 * treats as fail-closed for anyone but the owner.
 */
export class NoOpMediaScanner implements MediaScanner {
  readonly name = 'none';
  async scan(): Promise<ScanResult> {
    return { status: 'scan_failed', provider: 'none', details: 'No scanner configured' };
  }
  available(): boolean {
    return false;
  }
}

export type ClamAvOptions = {
  host: string;
  port: number;
  timeoutMs: number;
};

/**
 * ClamAV via clamd's INSTREAM command over TCP.
 *
 * Protocol: "zINSTREAM\0", then repeated [uint32 length][bytes] chunks, then a
 * zero-length chunk to end the stream. The reply is "stream: OK" or
 * "stream: <Signature> FOUND". This is the documented clamd wire format, so a
 * real daemon and the test double speak the same thing.
 */
export class ClamAvMediaScanner implements MediaScanner {
  readonly name = 'clamav';

  constructor(private readonly options: ClamAvOptions) {}

  available(): boolean {
    return this.options.host.length > 0 && this.options.port > 0;
  }

  async scan(objectKey: string, mimeType: string, open: () => Promise<ObjectStream>): Promise<ScanResult> {
    void objectKey;
    void mimeType;
    if (!this.available()) {
      return { status: 'scan_failed', provider: this.name, details: 'clamd is not configured' };
    }
    let socket: Socket | null = null;
    try {
      socket = await this.connect();
      socket.write('zINSTREAM\0');
      const { stream } = await open();
      for await (const chunk of stream) {
        const bytes = Buffer.from(chunk);
        const header = Buffer.alloc(4);
        header.writeUInt32BE(bytes.length, 0);
        socket.write(header);
        socket.write(bytes);
      }
      socket.write(Buffer.from([0, 0, 0, 0]));
      const reply = await this.readReply(socket);
      return this.parse(reply);
    } catch (error) {
      // A scanner we cannot reach is not evidence of a clean file.
      return {
        status: 'scan_failed',
        provider: this.name,
        details: (error instanceof Error ? error.message : String(error)).slice(0, 200),
      };
    } finally {
      socket?.destroy();
    }
  }

  private parse(reply: string): ScanResult {
    const text = reply.replace(/\u0000/g, '').trim();
    if (text.includes('FOUND')) {
      const signature = text.split(':')[1]?.trim() ?? 'malware';
      return { status: 'quarantined', provider: this.name, details: signature.slice(0, 120) };
    }
    if (/\bOK\b/.test(text)) return { status: 'clean', provider: this.name };
    return { status: 'scan_failed', provider: this.name, details: text.slice(0, 200) || 'empty reply' };
  }

  private connect(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.options.host, port: this.options.port });
      const fail = (error: Error) => {
        socket.destroy();
        reject(error);
      };
      socket.setTimeout(this.options.timeoutMs, () => fail(new Error('clamd timeout')));
      socket.once('error', fail);
      socket.once('connect', () => {
        socket.removeListener('error', fail);
        resolve(socket);
      });
    });
  }

  private readReply(socket: Socket): Promise<string> {
    return new Promise((resolve, reject) => {
      let buffer = '';
      const done = () => {
        socket.removeListener('data', onData);
        socket.removeListener('error', onError);
        resolve(buffer);
      };
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        // clamd ends every reply with a NUL terminator.
        if (buffer.includes('\0') || buffer.includes('\n')) done();
      };
      const onError = (error: Error) => {
        socket.removeListener('data', onData);
        reject(error);
      };
      socket.on('data', onData);
      socket.once('error', onError);
      socket.setTimeout(this.options.timeoutMs, () => reject(new Error('clamd reply timeout')));
    });
  }
}
