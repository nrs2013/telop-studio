import { useState, useEffect, useCallback, Component, type ReactNode, type ErrorInfo } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { syncService, type AuthUser } from "@/lib/syncService";
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

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/project/:id" component={ProjectPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

// Shared design tokens. This is the first surface of the app to get the
// warm-gray PROMPTER STUDIO treatment; accent is TELOP's gold-yellow instead
// of PROMPTER's beige. Inline here (rather than Tailwind classes) so this
// file stays self-contained and we can match PROMPTER's existing HTML index
// one-to-one. Future screens should reach for the same tokens.
const TS_DESIGN = {
  bg: "#262624",
  bg2: "#1f1f1d",
  surface: "#323230",
  border: "#46463f",
  text: "#ece6d8",
  text2: "#a8a8a0",
  text3: "#76766f",
  accent: "#e5bf3d",        // TELOP テーマカラーのゴールドイエロー
  accent2: "#f2d468",       // hover / lighter
  accentGlow: "rgba(229,191,61,0.3)",
  errorRed: "#e07a7a",
};

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

function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Robust auth check: retry a few times before giving up and showing the
    // login screen. Transient network blips or a cold server can otherwise
    // briefly flash the login UI at people who ARE actually logged in.
    let cancelled = false;
    const attempt = async (remaining: number): Promise<AuthUser | null> => {
      try {
        const user = await syncService.checkAuth();
        if (user) return user;
      } catch {
        // fall through to retry
      }
      if (remaining > 0) {
        await new Promise(r => setTimeout(r, 600));
        return attempt(remaining - 1);
      }
      return null;
    };
    attempt(2).then(user => {
      if (cancelled) return;
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

  if (!authUser) {
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
