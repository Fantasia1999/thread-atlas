declare module "ssh2" {
  import { EventEmitter } from "node:events";

  export interface ConnectConfig {
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    privateKey?: string | Buffer;
    passphrase?: string;
    readyTimeout?: number;
    sock?: NodeJS.ReadableStream & NodeJS.WritableStream;
  }

  export interface Stats {
    size: number;
    atime: number;
    mtime: number;
  }

  export interface ClientChannel extends EventEmitter {
    stderr: EventEmitter;
    on(event: "close", listener: (code: number | undefined) => void): this;
    on(event: "data", listener: (chunk: Buffer | string) => void): this;
  }

  export interface SFTPWrapper {
    stat(remotePath: string, callback: (error: Error | undefined, stats: Stats) => void): void;
    fastGet(remotePath: string, localPath: string, callback: (error?: Error) => void): void;
    createWriteStream(remotePath: string): NodeJS.WritableStream;
  }

  export class Client extends EventEmitter {
    connect(config: ConnectConfig): this;
    end(): void;
    exec(
      command: string,
      callback: (error: Error | undefined, stream: ClientChannel) => void
    ): void;
    sftp(callback: (error: Error | undefined, sftp: SFTPWrapper) => void): void;
    forwardOut(
      srcIP: string,
      srcPort: number,
      dstIP: string,
      dstPort: number,
      callback: (error: Error | undefined, channel: NodeJS.ReadWriteStream) => void
    ): void;
    on(event: "ready", listener: () => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "close", listener: () => void): this;
  }
}
