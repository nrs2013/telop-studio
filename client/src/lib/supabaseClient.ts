// Supabase クライアントの singleton。
//
// Serverless 化（Phase 2）の中核：Express サーバを介さず、ブラウザから直接
// Supabase Postgres にアクセスする。
//
// 必要な環境変数（Vite が build 時に注入）：
//   VITE_SUPABASE_URL       → https://symlplbtdgcvvsriozso.supabase.co
//   VITE_SUPABASE_ANON_KEY  → Supabase Dashboard → Settings → API → "anon public"
//
// anon key は公開可能（GitHub Pages の bundle に焼き込まれて OK）が、
// データの保護は Supabase の RLS（Row Level Security）に頼る。
// 最低限：authenticated ロールに対して全テーブル read/write を許可。

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || "https://symlplbtdgcvvsriozso.supabase.co";
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || "";

let _client: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
}

export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env"
    );
  }
  _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true, // OAuth コールバック対応
    },
  });
  return _client;
}

// ─── 認証ヘルパ ─────────────────────────────────────────────
// Supabase Auth を薄くラップ。今は Magic Link（メール 1 通でログイン）を採用。
// パスワード不要なのでのむさん向け。1 回ログインしたら 1 年は持つ。

export async function signInWithMagicLink(email: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // ログイン完了後の戻り先。ブラウザ環境のみで使う想定。
      emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
    },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const supabase = getSupabase();
  await supabase.auth.signOut();
}

export async function getCurrentUser(): Promise<{ id: string; email: string } | null> {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return { id: data.user.id, email: data.user.email || "" };
}

export function onAuthChange(cb: (user: { id: string; email: string } | null) => void): () => void {
  const supabase = getSupabase();
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) cb({ id: session.user.id, email: session.user.email || "" });
    else cb(null);
  });
  return () => data.subscription.unsubscribe();
}
