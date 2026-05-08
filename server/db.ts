import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

// Use SSL for external Postgres hosts (Supabase, Railway public URL, etc.).
// Railway's internal *.railway.internal hosts speak plaintext, so skip SSL there.
const isInternal = /\.railway\.internal(?::|\/|$)/.test(process.env.DATABASE_URL);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isInternal ? undefined : { rejectUnauthorized: false },
});

export const db = drizzle(pool, { schema });

// 起動時のミニマル自動マイグレーション。drizzle-kit push を本番で別途打たなくても
// 必要な新テーブルが揃うようにしておく。冪等な CREATE TABLE IF NOT EXISTS だけ。
// （複雑な ALTER は対象外。スキーマ変更が大きいときは drizzle-kit を別途運用する。）
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS deleted_projects (
        id varchar(64) PRIMARY KEY,
        deleted_at timestamp NOT NULL DEFAULT now()
      );
    `);
  } catch (err: any) {
    console.warn("[db] deleted_projects table ensure failed:", err.message);
  }
})();
