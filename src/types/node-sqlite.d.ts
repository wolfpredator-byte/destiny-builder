/**
 * Type declarations for node:sqlite (Node.js 24.20.0 built-in)
 * 
 * These are minimal declarations sufficient for Italian Manifest Reader.
 */

declare module 'node:sqlite' {
  export interface DatabaseSyncOptions {
    readOnly?: boolean;
  }

  export interface StatementSync {
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
    run(...params: unknown[]): void;
  }

  export class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions);
    prepare(sql: string): StatementSync;
    exec(sql: string): void;
    close(): void;
  }
}
