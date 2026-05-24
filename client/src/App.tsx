import { useState, useEffect, useCallback, Component, type ReactNode, type ErrorInfo } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { syncService, type AuthUser } from "@/lib/syncService";
import { isDropboxLoggedIn, startDropboxOAuth, handleOAuthCallback } from "@/lib/dropboxAuth";
import { probeDevProxy } from "@/lib/dropboxFetch";
import Home from "@/pages/home";
import ProjectPage from "@/pages/project";
import NotFound from "@/pages/not-found";

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, color: "#fff", background: "#111", minHeight: "100vh", fontFamily: "monospace" }}>
          <h2 style={{ color: "#f44" }}>Application Error</h2>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 16, fontSize: 13, color: "#ccc" }}>
            {this.state.error?.message}
            {"\n\n"}
            {this.state.error?.stack}
          </pre>
          <button onClick={() => window.location.reload()} style={{ marginTop: 20, padding: "8px 16px", background: "#333", color: "#fff", border: "1px solid #555", cursor: "pointer" }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// GitHub Pages 用 base path 取得。
// dev (Express): "/" → wouter base = "" (空)
// Pages: "/telop-studio/" → wouter base = "/telop-studio"（末尾スラッシュは付けない）
function getRouterBase(): string {
  const base = import.meta.env.BASE_URL || "/";
  if (base === "/" || base === "") return "";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

function Router() {
  return (
    <WouterRouter base={getRouterBase()}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/project/:id" component={ProjectPage} />
        <Route component={NotFound} />
      </Switch>
    </WouterRouter>
  );
}

import { TS_DESIGN } from "@/lib/designTokens";

function LoginScreen({ onLogin }: { onLogin: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setLoading(true);
    setError("");
    try {
      if (mode === "login") {
        const user = await syncService.login(username.trim(), password.trim());
        toast({ title: `ようこそ、${user.username}さん` });
        onLogin(user);
      } else {
        const user = await syncService.register(username.trim(), password.trim(), displayName.trim() || undefined);
        toast({ title: `アカウントを作成しました` });
        onLogin(user);
      }
    } catch (err: any) {
      setError(err.message || "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }, [username, password, displayName, mode, onLogin, toast]);

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: TS_DESIGN.surface,
    border: `1px solid ${TS_DESIGN.border}`,
    borderRadius: 8,
    padding: "12px 14px",
    color: TS_DESIGN.text,
    fontFamily: "inherit",
    fontSize: 14,
  };
  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 11,
    color: TS_DESIGN.text3,
    letterSpacing: "0.15em",
    textTransform: "uppercase",
    fontWeight: 700,
    marginBottom: 8,
    marginTop: 18,
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "linear-gradient(135deg, #1e1e1c 0%, #2e2e2b 50%, #1a1a18 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: '"Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif',
        color: TS_DESIGN.text,
      }}
    >
      <div
        style={{
          background: TS_DESIGN.bg2,
          border: `1px solid ${TS_DESIGN.border}`,
          borderRadius: 16,
          padding: "48px 56px",
          width: 440,
          boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
        }}
      >
        {/* Brand block: ■ T + wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              background: TS_DESIGN.accent,
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: '"Helvetica Neue", "Hiragino Sans", sans-serif',
              fontWeight: 900,
              fontSize: 28,
              color: "#262624",
              letterSpacing: "-0.02em",
              boxShadow: `0 0 20px ${TS_DESIGN.accentGlow}`,
            }}
          >
            T
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div
              style={{
                fontFamily: '"Helvetica Neue", "Hiragino Sans", sans-serif',
                fontWeight: 300,
                letterSpacing: "0.03em",
                fontSize: 26,
                color: TS_DESIGN.text,
                lineHeight: 1,
              }}
              data-testid="text-login-title"
            >
              <b style={{ fontWeight: 800, color: TS_DESIGN.accent }}>TELOP</b> STUDIO
            </div>
            <div
              style={{
                fontSize: 10,
                color: TS_DESIGN.text3,
                letterSpacing: "0.25em",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              Lyric Subtitle Creator
            </div>
          </div>
        </div>

        {/* Mode toggle (TELOP keeps this — PROMPTER doesn't have register mode) */}
        <div
          style={{
            display: "flex",
            marginTop: 32,
            borderRadius: 8,
            overflow: "hidden",
            border: `1px solid ${TS_DESIGN.border}`,
          }}
        >
          <button
            type="button"
            style={{
              flex: 1,
              padding: "10px 0",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              cursor: "pointer",
              border: "none",
              background: mode === "login" ? TS_DESIGN.accent : "transparent",
              color: mode === "login" ? "#1a1a18" : TS_DESIGN.text3,
              transition: "background 0.15s",
              fontFamily: "inherit",
            }}
            onClick={() => { setMode("login"); setError(""); }}
            data-testid="tab-login"
          >
            Login
          </button>
          <button
            type="button"
            style={{
              flex: 1,
              padding: "10px 0",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              cursor: "pointer",
              border: "none",
              background: mode === "register" ? TS_DESIGN.accent : "transparent",
              color: mode === "register" ? "#1a1a18" : TS_DESIGN.text3,
              transition: "background 0.15s",
              fontFamily: "inherit",
            }}
            onClick={() => { setMode("register"); setError(""); }}
            data-testid="tab-register"
          >
            New Account
          </button>
        </div>

        {/* Form body */}
        <form onSubmit={handleSubmit} style={{ marginTop: 4 }}>
          <label style={labelStyle}>Username</label>
          <input
            style={inputStyle}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="ユーザー名"
            autoFocus
            autoComplete="username"
            data-testid="input-login-username"
            onFocus={(e) => { e.currentTarget.style.borderColor = TS_DESIGN.accent; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = TS_DESIGN.border; }}
          />

          <label style={labelStyle}>Password</label>
          <input
            type="password"
            style={inputStyle}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            data-testid="input-login-password"
            onFocus={(e) => { e.currentTarget.style.borderColor = TS_DESIGN.accent; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = TS_DESIGN.border; }}
          />

          {mode === "register" && (
            <>
              <label style={labelStyle}>
                Display Name <span style={{ color: TS_DESIGN.text3, letterSpacing: 0, textTransform: "none", fontWeight: 400 }}>(任意)</span>
              </label>
              <input
                style={inputStyle}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="表示名"
                data-testid="input-login-displayname"
                onFocus={(e) => { e.currentTarget.style.borderColor = TS_DESIGN.accent; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = TS_DESIGN.border; }}
              />
            </>
          )}

          {error && (
            <p
              style={{ fontSize: 12, color: TS_DESIGN.errorRed, marginTop: 14 }}
              data-testid="text-login-error"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !username.trim() || !password.trim()}
            data-testid="button-login-submit"
            style={{
              width: "100%",
              marginTop: 28,
              background: TS_DESIGN.accent,
              border: "none",
              color: "#1a1a18",
              borderRadius: 8,
              padding: 14,
              fontFamily: "inherit",
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: "0.05em",
              cursor: loading ? "not-allowed" : "pointer",
              opacity: (loading || !username.trim() || !password.trim()) ? 0.5 : 1,
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => {
              if (!loading && username.trim() && password.trim()) e.currentTarget.style.background = TS_DESIGN.accent2;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = TS_DESIGN.accent;
            }}
          >
            {loading ? "..." : mode === "login" ? "Sign In" : "Create Account"}
          </button>

          <div
            style={{
              marginTop: 18,
              textAlign: "center",
              fontSize: 12,
              color: TS_DESIGN.text3,
            }}
          >
            データはサーバーに自動保存されます
          </div>
        </form>
      </div>
    </div>
  );
}

// Dropbox ログイン専用画面（GitHub Pages 等のサーバ無し環境向け）。
// 旧 LoginScreen（ユーザー名 + パスワード）はサーバが居る前提なので Pages では
// 何を入れても "Unexpected token '<', '<html>'" になる。代わりにこれを出す。
function DropboxLoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setError("");
    try {
      await startDropboxOAuth(); // window.location 遷移なのでここには戻らない
    } catch (err: any) {
      setError(err?.message || String(err));
      setConnecting(false);
    }
  }, []);

  // 既に localStorage に token がある（リロード直後など）→ 即上に通知
  useEffect(() => {
    if (isDropboxLoggedIn()) onLoggedIn();
  }, [onLoggedIn]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "linear-gradient(135deg, #1e1e1c 0%, #2e2e2b 50%, #1a1a18 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: '"Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif',
        color: TS_DESIGN.text,
      }}
    >
      <div
        style={{
          background: TS_DESIGN.bg2,
          border: `1px solid ${TS_DESIGN.border}`,
          borderRadius: 16,
          padding: "48px 56px",
          width: 440,
          boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 32 }}>
          <div
            style={{
              width: 44, height: 44,
              background: TS_DESIGN.accent, borderRadius: 8,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: '"Helvetica Neue", "Hiragino Sans", sans-serif',
              fontWeight: 900, fontSize: 28, color: "#262624",
              letterSpacing: "-0.02em",
              boxShadow: `0 0 20px ${TS_DESIGN.accentGlow}`,
            }}
          >T</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{
              fontFamily: '"Helvetica Neue", "Hiragino Sans", sans-serif',
              fontWeight: 300, letterSpacing: "0.03em", fontSize: 26,
              color: TS_DESIGN.text, lineHeight: 1,
            }}>
              <b style={{ fontWeight: 800, color: TS_DESIGN.accent }}>TELOP</b> STUDIO
            </div>
            <div style={{
              fontSize: 10, color: TS_DESIGN.text3,
              letterSpacing: "0.25em", textTransform: "uppercase", fontWeight: 700,
            }}>Lyric Subtitle Creator</div>
          </div>
        </div>

        <div style={{ fontSize: 13, color: TS_DESIGN.text2, lineHeight: 1.7, marginBottom: 24 }}>
          このアプリは Dropbox に直接データを保存します。<br />
          Dropbox にログインして始めてください。
        </div>

        <button
          type="button"
          disabled={connecting}
          onClick={handleConnect}
          style={{
            width: "100%",
            background: TS_DESIGN.accent,
            border: "none",
            color: "#1a1a18",
            borderRadius: 8,
            padding: 14,
            fontFamily: "inherit",
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: "0.05em",
            cursor: connecting ? "not-allowed" : "pointer",
            opacity: connecting ? 0.5 : 1,
          }}
        >
          {connecting ? "Dropbox に接続中..." : "Dropbox にログイン"}
        </button>

        {error && (
          <p style={{ fontSize: 12, color: TS_DESIGN.errorRed, marginTop: 14 }}>{error}</p>
        )}

        <div style={{ marginTop: 18, textAlign: "center", fontSize: 12, color: TS_DESIGN.text3 }}>
          データはあなたの Dropbox に保存されます
        </div>
      </div>
    </div>
  );
}

function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [serverAlive, setServerAlive] = useState<boolean | null>(null); // null = 判定中
  const [dbxOk, setDbxOk] = useState<boolean>(() => isDropboxLoggedIn());
  const [checking, setChecking] = useState(true);

  // ─── 起動時 OAuth callback 処理（?code= が URL にあれば access_token に交換） ───
  // 旧 home.tsx 側でも handleOAuthCallback を呼んでいたが、App.tsx で先に処理しないと
  // checkAuth 失敗 → LoginScreen 表示 → callback 処理されずに ?code= が消える、になる。
  useEffect(() => {
    (async () => {
      try {
        const ok = await handleOAuthCallback();
        if (ok) setDbxOk(true);
      } catch (err) {
        console.warn("[App] OAuth callback failed:", err);
      }
    })();
  }, []);

  // ─── 起動時に localhost dev サーバを probe ───
  // 居れば書き出し系（/api/export/*, /api/audio/convert-to-mp3）の fetch がそっちに
  // proxy される。30 秒ごとに再 probe して、起動／停止が変わったら即反映。
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try { await probeDevProxy(); } catch {}
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    // サーバ生存確認 + auth 取得をまとめてやる。
    //   - 200/401 → サーバ生存。401 なら未ログイン
    //   - 404/network err → サーバ無し（GitHub Pages 等）
    let cancelled = false;
    const attempt = async (remaining: number): Promise<{ alive: boolean; user: AuthUser | null }> => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        if (res.status === 404) {
          // 完全に Pages 経路。サーバ無し。
          return { alive: false, user: null };
        }
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          return { alive: true, user: data?.user || null };
        }
        // 401, 5xx 等：サーバ生存 + 未ログイン
        return { alive: true, user: null };
      } catch {
        // fetch 失敗 → サーバ不在の可能性大
        if (remaining > 0) {
          await new Promise(r => setTimeout(r, 600));
          return attempt(remaining - 1);
        }
        return { alive: false, user: null };
      }
    };
    attempt(2).then(({ alive, user }) => {
      if (cancelled) return;
      setServerAlive(alive);
      setAuthUser(user);
      setChecking(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // When a stale client chunk can't be fetched (e.g. after a redeploy), we
    // used to hard-reload unconditionally. That bounces the user to the login
    // screen during the reload flash. Reload at most once per session, and
    // only when really necessary.
    const KEY = "telop-reloaded-once";
    const handler = (e: PromiseRejectionEvent) => {
      const msg = String(e.reason?.message || e.reason || "");
      const isChunkErr =
        msg.includes("Failed to fetch dynamically imported module") ||
        msg.includes("Importing a module script failed");
      if (!isChunkErr) return;
      e.preventDefault();
      if (sessionStorage.getItem(KEY)) return; // already reloaded this session
      sessionStorage.setItem(KEY, "1");
      window.location.reload();
    };
    window.addEventListener("unhandledrejection", handler);
    return () => window.removeEventListener("unhandledrejection", handler);
  }, []);

  if (checking) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "linear-gradient(135deg, #1e1e1c 0%, #2e2e2b 50%, #1a1a18 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            background: TS_DESIGN.accent,
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#262624",
            fontFamily: '"Helvetica Neue", "Hiragino Sans", sans-serif',
            fontWeight: 900,
            fontSize: 28,
            letterSpacing: "-0.02em",
            boxShadow: `0 0 20px ${TS_DESIGN.accentGlow}`,
          }}
        >
          T
        </div>
      </div>
    );
  }

  // ─── ログイン経路の振り分け ───
  // Pages（サーバ無し）：Dropbox ログインを使う。dbxOk になったら認証済み扱い。
  // dev（サーバ有り）：従来のユーザー名/パスワード LoginScreen を出す。
  //                    ただし Dropbox にもログイン済みなら無条件で通す（dev mode 認証 bypass）。
  const isServerless = serverAlive === false;
  const dbxAuthenticated = dbxOk;

  if (!authUser && !dbxAuthenticated) {
    if (isServerless) {
      // サーバ不在 → Dropbox ログイン画面
      return (
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <Toaster />
            <DropboxLoginScreen onLoggedIn={() => setDbxOk(true)} />
          </TooltipProvider>
        </QueryClientProvider>
      );
    }
    // サーバ生存 → 従来の Login 画面
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <LoginScreen onLogin={setAuthUser} />
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
