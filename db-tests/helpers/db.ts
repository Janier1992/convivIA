import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(HERE, "../../migrations");

export type Row = Record<string, unknown>;

export interface TestDb {
  /** Como el compute service: clave admin (bypassa RLS, auth.uid() nulo). */
  server<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Como un usuario autenticado del panel (rol authenticated + JWT sub). */
  as<T extends Row = Row>(userId: string, sql: string, params?: unknown[]): Promise<T[]>;
  /** Como un visitante anónimo (rol anon). */
  anon<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  createUser(email?: string): Promise<string>;
  close(): Promise<void>;
}

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

/**
 * Levanta un Postgres real en memoria (PGlite), aplica los shims de
 * InsForge y todas las migraciones en orden, cada una en su propia
 * transacción (igual que `insforge db migrations up`).
 */
export async function createTestDb(): Promise<TestDb> {
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec(readFileSync(path.join(HERE, "insforge-shims.sql"), "utf8"));

  for (const file of migrationFiles()) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.transaction((tx) => tx.exec(sql));
    } catch (err) {
      throw new Error(`La migración ${file} falló: ${(err as Error).message}`);
    }
  }

  async function runAs<T extends Row>(role: "authenticated" | "anon", userId: string | null, sql: string, params: unknown[]) {
    return db.transaction(async (tx) => {
      await tx.exec(`set local role ${role}`);
      if (userId) {
        await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
      }
      const result = await tx.query<T>(sql, params);
      return result.rows;
    });
  }

  return {
    server: async <T extends Row>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows,
    as: <T extends Row>(userId: string, sql: string, params: unknown[] = []) => runAs<T>("authenticated", userId, sql, params),
    anon: <T extends Row>(sql: string, params: unknown[] = []) => runAs<T>("anon", null, sql, params),
    createUser: async (email?: string) => {
      const id = randomUUID();
      await db.query("insert into auth.users (id, email, profile) values ($1, $2, $3)", [
        id,
        email ?? `${id.slice(0, 8)}@example.com`,
        JSON.stringify({ name: `Usuario ${id.slice(0, 4)}` })
      ]);
      return id;
    },
    close: () => db.close()
  };
}
