/** A D1-shaped wrapper over node:sqlite so the package is tested against real SQL, not mocks. */
import { DatabaseSync } from "node:sqlite";
import type { Db, DbStatement } from "../src/types";
import { AUTH_SCHEMA_SQL } from "../src/schema";

class Stmt implements DbStatement {
  private params: unknown[] = [];
  constructor(private db: DatabaseSync, private sql: string) {}
  bind(...values: unknown[]): DbStatement { const s = new Stmt(this.db, this.sql); s.params = values.map((v) => (v === undefined ? null : v)); return s; }
  async first<T>(): Promise<T | null> { const row = this.db.prepare(this.sql).get(...(this.params as any[])); return (row as T) ?? null; }
  async run(): Promise<unknown> { return this.db.prepare(this.sql).run(...(this.params as any[])); }
  async all<T>(): Promise<{ results: T[] }> { return { results: this.db.prepare(this.sql).all(...(this.params as any[])) as T[] }; }
  exec() { return this.run(); }
}

export class ShimDb implements Db {
  readonly raw: DatabaseSync;
  constructor(extraSql = "") {
    this.raw = new DatabaseSync(":memory:");
    this.raw.exec(AUTH_SCHEMA_SQL);
    if (extraSql) this.raw.exec(extraSql);
  }
  prepare(sql: string): DbStatement { return new Stmt(this.raw, sql); }
  async batch(statements: DbStatement[]): Promise<unknown> { const out = []; for (const s of statements) out.push(await s.run()); return out; }
  /** Test helper: shift timestamps on a table to simulate the passage of time. */
  age(table: string, column: string, minutes: number, where = "1=1") {
    this.raw.exec(`UPDATE ${table} SET ${column} = strftime('%Y-%m-%dT%H:%M:%fZ', datetime(${column}, '-${minutes} minutes')) WHERE ${where}`);
  }
}
