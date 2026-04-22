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
