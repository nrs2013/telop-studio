import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

// Supabase / Railway public URLs need SSL without strict CA verification.
// Railway internal URLs don't support SSL at all.
const isInternal = /\.railway\.internal(?::|\/|$)/.test(process.env.DATABASE_URL);

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
    ssl: isInternal ? undefined : { rejectUnauthorized: false },
  },
});
