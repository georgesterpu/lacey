import type { InStatement } from "@libsql/client/web";
export type DatabaseInput = string | InStatement;
export interface DatabaseRows {
  columns: string[];
  rows: Record<string, unknown>[];
  rowsAffected: number;
}
export interface DatabaseTransaction {
  execute(input: DatabaseInput): Promise<DatabaseRows>;
  batch(inputs: DatabaseInput[]): Promise<DatabaseRows[]>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): void;
}
export interface DatabaseClient {
  dialect?: "sqlite" | "postgres";
  execute(input: DatabaseInput): Promise<DatabaseRows>;
  batch(
    inputs: DatabaseInput[],
    mode?: "write" | "read" | "deferred",
  ): Promise<DatabaseRows[]>;
  transaction(
    mode?: "write" | "read" | "deferred",
  ): Promise<DatabaseTransaction>;
  close(): void | Promise<void>;
}
