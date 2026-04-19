import { useState, useEffect, useCallback, Component, type ReactNode, type ErrorInfo } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(180deg, hsl(0 0% 7%) 0%, hsl(0 0% 4%) 100%)" }}>
      <div className="w-full max-w-sm px-6">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-lg flex items-center justify-center mb-4" style={{ background: "linear-gradient(135deg, hsl(48 100% 45%) 0%, hsl(48 100% 32%) 100%)" }}>
            <span className="text-black font-bold text-2xl tracking-tight">T</span>
          </div>
          <h1 className="text-xl font-bold tracking-widest uppercase" style={{ color: "hsl(48 100% 50%)" }} data-testid="text-login-title">
            Telop Studio
          </h1>
          <p className="text-[11px] tracking-wider uppercase mt-1" style={{ color: "hsl(0 0% 50%)" }}>
            Lyric Subtitle Creator
          </p>
        </div>

        <div className="rounded-lg p-6" style={{ backgroundColor: "hsl(0 0% 10%)", border: "1px solid hsl(0 0% 18%)" }}>
          <div className="flex mb-5 rounded-md overflow-hidden" style={{ border: "1px solid hsl(0 0% 20%)" }}>
            <button
              type="button"
              className="flex-1 py-2 text-xs font-bold tracking-wider uppercase transition-colors"
              style={{
                backgroundColor: mode === "login" ? "hsl(48 100% 45%)" : "transparent",
                color: mode === "login" ? "hsl(0 0% 5%)" : "hsl(0 0% 50%)",
              }}
              onClick={() => { setMode("login"); setError(""); }}
              data-testid="tab-login"
            >
              LOGIN
            </button>
            <button
              type="button"
              className="flex-1 py-2 text-xs font-bold tracking-wider uppercase transition-colors"
              style={{
                backgroundColor: mode === "register" ? "hsl(48 100% 45%)" : "transparent",
                color: mode === "register" ? "hsl(0 0% 5%)" : "hsl(0 0% 50%)",
              }}
              onClick={() => { setMode("register"); setError(""); }}
              data-testid="tab-register"
            >
              NEW ACCOUNT
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div>
              <label className="text-[10px] font-bold tracking-wider uppercase mb-1 block" style={{ color: "hsl(0 0% 45%)" }}>
                USERNAME
              </label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ユーザー名"
                autoFocus
                data-testid="input-login-username"
                className="text-sm"
                style={{ backgroundColor: "hsl(0 0% 14%)", border: "1px solid hsl(0 0% 22%)", color: "hsl(0 0% 90%)" }}
              />
            </div>
            <div>
              <label className="text-[10px] font-bold tracking-wider uppercase mb-1 block" style={{ color: "hsl(0 0% 45%)" }}>
                PASSWORD
              </label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="パスワード"
                data-testid="input-login-password"
                className="text-sm"
                style={{ backgroundColor: "hsl(0 0% 14%)", border: "1px solid hsl(0 0% 22%)", color: "hsl(0 0% 90%)" }}
              />
            </div>
            {mode === "register" && (
              <div>
                <label className="text-[10px] font-bold tracking-wider uppercase mb-1 block" style={{ color: "hsl(0 0% 45%)" }}>
                  DISPLAY NAME <span style={{ color: "hsl(0 0% 35%)" }}>(任意)</span>
                </label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="表示名"
                  data-testid="input-login-displayname"
                  className="text-sm"
                  style={{ backgroundColor: "hsl(0 0% 14%)", border: "1px solid hsl(0 0% 22%)", color: "hsl(0 0% 90%)" }}
                />
              </div>
            )}
            {error && (
              <p className="text-xs" style={{ color: "hsl(0 70% 55%)" }} data-testid="text-login-error">{error}</p>
            )}
            <Button
              type="submit"
              disabled={loading || !username.trim() || !password.trim()}
              className="mt-1 font-bold tracking-wider"
              data-testid="button-login-submit"
              style={{ backgroundColor: "hsl(48 100% 45%)", color: "hsl(0 0% 5%)" }}
            >
              {loading ? "..." : mode === "login" ? "LOGIN" : "CREATE ACCOUNT"}
            </Button>
          </form>
        </div>

        <p className="text-center text-[10px] mt-4" style={{ color: "hsl(0 0% 30%)" }}>
          データはサーバーに自動保存されます
        </p>
      </div>
    </div>
  );
}

function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    syncService.checkAuth().then(user => {
      setAuthUser(user);
      setChecking(false);
    }).catch(() => {
      setChecking(false);
    });
  }, []);

  useEffect(() => {
    const handler = (e: PromiseRejectionEvent) => {
      const msg = String(e.reason?.message || e.reason || "");
      if (msg.includes("Failed to fetch dynamically imported module") || msg.includes("Importing a module script failed")) {
        e.preventDefault();
        window.location.reload();
      }
    };
    window.addEventListener("unhandledrejection", handler);
    return () => window.removeEventListener("unhandledrejection", handler);
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "hsl(0 0% 6%)" }}>
        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, hsl(48 100% 45%) 0%, hsl(48 100% 32%) 100%)" }}>
          <span className="text-black font-bold text-lg tracking-tight">T</span>
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
