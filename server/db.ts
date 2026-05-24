import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

// DATABASE_URL が設定されていない場合は dev / serverless 移行中モード。
// サーバ側 DB 操作は全部失敗するが、クライアントは IndexedDB ベースで動くので、
// /api/auth と /api/dropbox/* と /api/export/* だけ機能していれば OK。
// （serverless 化完成時にこの分岐ごと消す予定）
const hasDb = !!process.env.DATABASE_URL;

const isInternal = hasDb && /\.railway\.internal(?::|\/|$)/.test(process.env.DATABASE_URL!);

export const pool: pg.Pool | null = hasDb
  ? new pg.Pool({
      connectionString: process.env.DATABASE_URL!,
      ssl: isInternal ? undefined : { rejectUnauthorized: false },
    })
  : null;

// db を null にすると import 側で TS が怒るので、access するとエラーを throw する
// Proxy にしておく。dev / serverless 移行中は呼ぶこと自体がない想定。
function makeDbDisabledProxy(): any {
  const err = () => {
    throw new Error("Database is disabled (DATABASE_URL not set). This is expected in dev / serverless mode.");
  };
  return new Proxy({}, {
    get: () => err,
    apply: err,
  });
}

export const db = hasDb
  ? drizzle(pool!, { schema })
  : (makeDbDisabledProxy() as ReturnType<typeof drizzle>);

if (!hasDb) {
  console.warn("[db] DATABASE_URL not set — database access disabled. Server is in dev / serverless-migration mode.");
}

// 起動時のミニマル自動マイグレーション。drizzle-kit push を本番で別途打たなくても
// 必要な新テーブルが揃うようにしておく。冪等な CREATE TABLE IF NOT EXISTS だけ。
// （複雑な ALTER は対象外。スキーマ変更が大きいときは drizzle-kit を別途運用する。）
if (hasDb) {
  (async () => {
    try {
      await pool!.query(`
        CREATE TABLE IF NOT EXISTS deleted_projects (
          id varchar(64) PRIMARY KEY,
          deleted_at timestamp NOT NULL DEFAULT now()
        );
      `);
    } catch (err: any) {
      console.warn("[db] deleted_projects table ensure failed:", err.message);
    }
  })();
}
