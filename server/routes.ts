import express from "express";
import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import { spawn, spawnSync } from "child_process";
import archiver from "archiver";

// Resolve FFmpeg binary: prefer bundled bin/ffmpeg7, otherwise use system ffmpeg.
// Detect the system ffmpeg major version so we only warn when it's actually old (< 7).
const FFMPEG7_PATH = path.join(process.cwd(), "bin", "ffmpeg7");
function detectFfmpegMajorVersion(bin: string): number | null {
  try {
    const out = spawnSync(bin, ["-version"], { encoding: "utf8" });
    const text = (out.stdout || "") + (out.stderr || "");
    const m = text.match(/ffmpeg version\s+n?(\d+)/i);
    return m ? parseInt(m[1], 10) : null;
  } catch {
    return null;
  }
}
const FFMPEG_BIN = fs.existsSync(FFMPEG7_PATH) ? FFMPEG7_PATH : "ffmpeg";
const FFMPEG_VERSION = detectFfmpegMajorVersion(FFMPEG_BIN);
if (FFMPEG_BIN === "ffmpeg") {
  if (FFMPEG_VERSION === null) {
    console.warn("[FFmpeg] WARNING: ffmpeg binary not found. Video export will fail. Install ffmpeg (`brew install ffmpeg` on Mac).");
  } else if (FFMPEG_VERSION < 7) {
    console.warn(`[FFmpeg] WARNING: system ffmpeg is version ${FFMPEG_VERSION}.x. VP9 alpha encoding may produce all-opaque output (known FFmpeg 6.x bug). Upgrade to FFmpeg 7+ or place a custom build at bin/ffmpeg7.`);
  } else {
    console.log(`[FFmpeg] Using system ffmpeg version ${FFMPEG_VERSION}.x (VP9 alpha supported).`);
  }
} else {
  console.log(`[FFmpeg] Using bundled binary: ${FFMPEG7_PATH}`);
}
import { serverStorage, verifyPassword, upgradePasswordIfNeeded } from "./storage";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import { uploadToDropbox, downloadFromDropbox, listDropboxFiles, searchDropboxFiles, checkDropboxConnection, checkDropboxFileExists, deleteFromDropbox, renameInDropbox, getUncachableDropboxClient, getTeamDropboxClient, getDropboxAuthUrl, exchangeDropboxCode, disconnectDropboxCustom, getDropboxOAuthStatus, browseDropboxFolder, diagnoseDrpboxStructure } from "./dropbox";
import kuromoji from "kuromoji";

let kuromojiTokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures> | null = null;
const kuromojiReady = new Promise<void>((resolve) => {
  kuromoji.builder({ dicPath: "node_modules/kuromoji/dict/" }).build((err: Error | null, tokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures>) => {
    if (!err && tokenizer) {
      kuromojiTokenizer = tokenizer;
    }
    resolve();
  });
});

function getReadingForText(text: string): string {
  if (!kuromojiTokenizer || !text) return text;
  const tokens = kuromojiTokenizer.tokenize(text);
  if (tokens.length > 0 && tokens[0].reading) {
    return tokens[0].reading;
  }
  return text;
}

const editingStatus = new Map<string, Map<string, { displayName: string; lastHeartbeat: number }>>();
const HEARTBEAT_TIMEOUT = 30_000;

function cleanExpiredEditing() {
  const now = Date.now();
  for (const [projectId, users] of editingStatus) {
    for (const [userId, info] of users) {
      if (now - info.lastHeartbeat > HEARTBEAT_TIMEOUT) {
        users.delete(userId);
      }
    }
    if (users.size === 0) editingStatus.delete(projectId);
  }
}

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const frameUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

const audioUpload = multer({
  dest: path.join(uploadDir, "audio_tmp"),
  limits: { fileSize: 100 * 1024 * 1024 },
});

declare module "express-session" {
  interface SessionData {
    userId?: string;
    username?: string;
  }
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ message: "ログインが必要です" });
  }
  next();
}

// TEAM SHARING: any authenticated user can access any project.
// ownerId remains on each project as audit metadata but does NOT gate access.
async function requireProjectAccess(req: Request, res: Response, next: NextFunction) {
  const projectId = req.params.id;
  if (!projectId) return res.status(400).json({ message: "projectId が必要です" });
  const project = await serverStorage.getProject(projectId);
  if (!project) return res.status(404).json({ message: "プロジェクトが見つかりません" });
  // Attach so downstream handlers can skip re-fetching.
  (req as any).project = project;
  next();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === "telop-studio-secret")) {
    console.warn("[security] SESSION_SECRET is not set to a secure value in production. Please set a strong SESSION_SECRET env var.");
  }

  // Persist sessions in PostgreSQL so users stay logged in across server restarts / redeploys.
  // Falls back to in-memory (default) if DATABASE_URL is not set.
  let sessionStore: session.Store | undefined;
  if (process.env.DATABASE_URL) {
    const PgStore = connectPgSimple(session);
    const pgPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: isProduction ? { rejectUnauthorized: false } : undefined,
    });
    sessionStore = new PgStore({
      pool: pgPool,
      tableName: "session",
      createTableIfMissing: true,
    });
  } else {
    console.warn("[session] DATABASE_URL not set; falling back to in-memory session store (sessions lost on restart).");
  }

  // IMPORTANT: trust proxy must be set BEFORE session middleware so that
  // `secure: "auto"` correctly detects HTTPS via the X-Forwarded-Proto header
  // that Railway's edge proxy sets. Without this, secure cookies are never
  // issued in production and users silently lose their session.
  if (isProduction) {
    app.set("trust proxy", 1);
  }

  app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || "telop-studio-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      // "auto" = secure iff the connection is HTTPS (respects trust proxy).
      // This avoids the footgun where `secure: true` silently blocks cookies
      // on any accidental HTTP request during the proxy handshake.
      secure: isProduction ? "auto" : false,
      sameSite: "lax",
    },
  }));

  app.post("/api/auth/register", async (req: Request, res: Response) => {
    const { username, password, displayName } = req.body;
    if (!username || !password) return res.status(400).json({ message: "ユーザー名とパスワードが必要です" });
    const existing = await serverStorage.getUserByUsername(username);
    if (existing) return res.status(409).json({ message: "このユーザー名は既に使われています" });
    const user = await serverStorage.createUser(username, password, displayName);
    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ id: user.id, username: user.username, displayName: user.displayName });
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: "ユーザー名とパスワードが必要です" });
    const user = await serverStorage.getUserByUsername(username);
    if (!user || !(await verifyPassword(password, user.password))) {
      return res.status(401).json({ message: "ユーザー名またはパスワードが違います" });
    }
    // Transparent password upgrade: if the stored hash is the old SHA256 format, rehash with bcrypt now.
    try {
      const upgraded = await upgradePasswordIfNeeded(password, user.password);
      if (upgraded) {
        await serverStorage.updateUserPassword(user.id, upgraded);
      }
    } catch (err) {
      console.warn("[auth] password upgrade failed:", (err as any)?.message);
    }
    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ id: user.id, username: user.username, displayName: user.displayName });
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        console.error("[auth] session destroy failed:", err);
        return res.status(500).json({ message: "ログアウト処理に失敗しました" });
      }
      // Also clear the session cookie on the client side.
      res.clearCookie("connect.sid");
      res.json({ success: true });
    });
  });

  app.get("/api/auth/me", (req: Request, res: Response) => {
    if (!req.session?.userId) return res.json({ user: null });
    res.json({ user: { id: req.session.userId, username: req.session.username } });
  });

  app.post("/api/reading", async (req: Request, res: Response) => {
    await kuromojiReady;
    const { texts } = req.body;
    if (!Array.isArray(texts)) return res.status(400).json({ message: "texts array required" });
    const readings: Record<string, string> = {};
    for (const t of texts) {
      if (typeof t === "string" && t.length > 0) {
        readings[t] = getReadingForText(t);
      }
    }
    res.json({ readings });
  });

  // Auto-login removed for security. Previously this endpoint logged users in with a hardcoded
  // password, which is unsafe when source code is public. Use /api/auth/login or /api/auth/register.
  app.post("/api/auth/auto-login", (_req: Request, res: Response) => {
    res.status(410).json({
      message: "自動ログイン機能は廃止されました。ユーザー名とパスワードでログインしてください。",
    });
  });

  app.post("/api/editing/heartbeat", requireAuth, async (req: Request, res: Response) => {
    const { projectId } = req.body;
    if (!projectId) return res.status(400).json({ message: "projectId is required" });
    const userId = req.session.userId!;
    const user = await serverStorage.getUserById(userId);
    const displayName = user?.displayName || req.session.username || "Unknown";
    if (!editingStatus.has(projectId)) {
      editingStatus.set(projectId, new Map());
    }
    editingStatus.get(projectId)!.set(userId, { displayName, lastHeartbeat: Date.now() });
    res.json({ success: true });
  });

  app.post("/api/editing/leave", requireAuth, (req: Request, res: Response) => {
    const { projectId } = req.body;
    if (projectId) {
      const users = editingStatus.get(projectId);
      if (users) {
        users.delete(req.session.userId!);
        if (users.size === 0) editingStatus.delete(projectId);
      }
    }
    res.json({ success: true });
  });

  app.get("/api/editing/status", (_req: Request, res: Response) => {
    cleanExpiredEditing();
    const result: Record<string, { editors: string[] }> = {};
    for (const [projectId, users] of editingStatus) {
      result[projectId] = { editors: [...users.values()].map(u => u.displayName) };
    }
    res.json(result);
  });

  // TEAM SHARING: returns ALL projects to any authenticated user.
  app.get("/api/sync/projects", requireAuth, async (req: Request, res: Response) => {
    const userId = req.session.userId!;
    const all = await serverStorage.getProjectsForUser(userId);
    res.json(all);
  });

  app.get("/api/sync/projects/:id", requireAuth, requireProjectAccess, async (req: Request, res: Response) => {
    res.json((req as any).project);
  });

  app.put("/api/sync/projects/:id", requireAuth, requireProjectAccess, async (req: Request, res: Response) => {
    const data = req.body;
    data.id = req.params.id;
    // Preserve original creator ownerId as audit metadata; if legacy-null, tag current user.
    const existing = (req as any).project;
    data.ownerId = existing.ownerId ?? req.session.userId!;
    const result = await serverStorage.upsertProject(data);
    res.json(result);
  });

  app.delete("/api/sync/projects/:id", requireAuth, requireProjectAccess, async (req: Request, res: Response) => {
    await serverStorage.deleteProject(req.params.id);
    res.json({ success: true });
  });

  app.get("/api/sync/projects/:id/lyrics", requireAuth, requireProjectAccess, async (req: Request, res: Response) => {
    const lines = await serverStorage.getLyrics(req.params.id);
    res.json(lines);
  });

  app.put("/api/sync/projects/:id/lyrics", requireAuth, requireProjectAccess, async (req: Request, res: Response) => {
    const lines = req.body.lines || [];
    await serverStorage.syncLyrics(req.params.id, lines);
    res.json({ success: true });
  });

  app.get("/api/sync/projects/:id/audio-tracks", requireAuth, requireProjectAccess, async (req: Request, res: Response) => {
    const tracks = await serverStorage.getAudioTrackMeta(req.params.id);
    res.json(tracks);
  });

  app.put("/api/sync/projects/:id/audio-tracks", requireAuth, requireProjectAccess, async (req: Request, res: Response) => {
    const tracks = req.body.tracks || [];
    await serverStorage.syncAudioTrackMeta(req.params.id, tracks);
    res.json({ success: true });
  });

  app.post("/api/sync/push", requireAuth, async (req: Request, res: Response) => {
    const { project, lyrics: lyricsData, audioTracks: tracksData, markers: markersData } = req.body;
    if (!project || !project.id) return res.status(400).json({ message: "Project data required" });
    const userId = req.session.userId!;

    const serverProject = await serverStorage.getProject(project.id);
    // TEAM SHARING: any authenticated user can push. ownerId is preserved as audit metadata only.
    if (serverProject && serverProject.version > (project.version || 0)) {
      return res.status(409).json({
        message: "サーバーに新しいバージョンがあります",
        serverVersion: serverProject.version,
        serverUpdatedAt: serverProject.updatedAt,
      });
    }

    const newVersion = (project.version || 0) + 1;
    // Always tag the owner: preserve existing (for legacy, claim it) or assign the pusher.
    const ownerId = serverProject?.ownerId ?? userId;
    await serverStorage.upsertProject({ ...project, ownerId, version: newVersion });
    if (lyricsData) await serverStorage.syncLyrics(project.id, lyricsData);
    if (tracksData) await serverStorage.syncAudioTrackMeta(project.id, tracksData);
    if (markersData) await serverStorage.syncCheckMarkers(project.id, markersData);

    res.json({ success: true, version: newVersion });
  });

  app.post("/api/sync/pull", requireAuth, async (req: Request, res: Response) => {
    const { projectIds } = req.body;
    const userId = req.session.userId!;
    if (!projectIds || !Array.isArray(projectIds)) {
      const allProjects = await serverStorage.getProjectsForUser(userId);
      return res.json({ projects: allProjects, lyrics: {}, audioTracks: {} });
    }

    const result: { projects: any[]; lyrics: Record<string, any[]>; audioTracks: Record<string, any[]>; markers: Record<string, any[]> } = {
      projects: [],
      lyrics: {},
      audioTracks: {},
      markers: {},
    };

    for (const pid of projectIds) {
      const p = await serverStorage.getProject(pid);
      // TEAM SHARING: return any existing project to any authenticated user.
      if (p) {
        result.projects.push(p);
        result.lyrics[pid] = await serverStorage.getLyrics(pid);
        result.audioTracks[pid] = await serverStorage.getAudioTrackMeta(pid);
        result.markers[pid] = await serverStorage.getCheckMarkers(pid);
      }
    }

    res.json(result);
  });

  app.get("/api/sync/pull-all", requireAuth, async (req: Request, res: Response) => {
    const userId = req.session.userId!;
    const allProjects = await serverStorage.getProjectsForUser(userId);
    const result: { projects: any[]; lyrics: Record<string, any[]>; audioTracks: Record<string, any[]>; markers: Record<string, any[]> } = {
      projects: allProjects,
      lyrics: {},
      audioTracks: {},
      markers: {},
    };
    for (const p of allProjects) {
      result.lyrics[p.id] = await serverStorage.getLyrics(p.id);
      result.audioTracks[p.id] = await serverStorage.getAudioTrackMeta(p.id);
      result.markers[p.id] = await serverStorage.getCheckMarkers(p.id);
    }
    res.json(result);
  });

  const exportSessions = new Map<string, {
    dir: string;
    frameCount: number;
    createdAt: number;
    audioPath?: string;
    encodeStatus?: string;
    encodeError?: string | null;
    outputPath?: string;
    isProRes?: boolean;
    // Progress fields populated while ffmpeg is encoding
    encodeProgress?: {
      currentFrame: number;
      totalFrames: number;
      percent: number;
      fps: number;
      startedAt: number;
    };
  }>();

  setInterval(() => {
    const now = Date.now();
    for (const [sid, session] of exportSessions) {
      if (now - session.createdAt > 10 * 60 * 1000) {
        fs.rmSync(session.dir, { recursive: true, force: true });
        exportSessions.delete(sid);
      }
    }
  }, 60_000);

  app.post("/api/export/session", async (_req, res) => {
    const sessionId = `export_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const dir = path.join(uploadDir, "export_sessions", sessionId);
    fs.mkdirSync(dir, { recursive: true });
    exportSessions.set(sessionId, { dir, frameCount: 0, createdAt: Date.now() });
    res.json({ sessionId });
  });

  app.post(
    "/api/export/:sessionId/frames",
    frameUpload.array("frames", 500),
    async (req, res) => {
      const session = exportSessions.get(req.params.sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });

      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No frames" });
      }

      for (const file of files) {
        const origName = file.originalname || `frame_${String(session.frameCount).padStart(6, "0")}.png`;
        const safeName = path.basename(origName);
        const framePath = path.join(session.dir, safeName);
        fs.writeFileSync(framePath, file.buffer);
        session.frameCount++;
      }

      res.json({ uploadedTotal: session.frameCount });
    }
  );

  app.post(
    "/api/export/:sessionId/audio",
    audioUpload.single("audio"),
    async (req, res) => {
      const session = exportSessions.get(req.params.sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });
      if (!req.file) return res.status(400).json({ message: "No audio file" });
      session.audioPath = req.file.path;
      res.json({ success: true });
    }
  );

  app.post("/api/export/:sessionId/encode", async (req, res) => {
    const session = exportSessions.get(req.params.sessionId);
    if (!session) return res.status(404).json({ message: "Session not found" });

    const { fps = 30, audioBitrate = 64000, videoBitrate = "800K", segments, codec = "vp9", async: asyncMode } = req.body;
    const fpsNum = parseInt(String(fps));
    const isProRes = codec === "prores";

    const audioPath = session.audioPath || null;

    const firstFramePath = path.join(session.dir, "frame_000000.png");
    if (fs.existsSync(firstFramePath)) {
      const header = fs.readFileSync(firstFramePath).slice(0, 30);
      const ihdrColorType = header.length > 25 ? header[25] : -1;
      const hasAlpha = ihdrColorType === 6;
      console.log(`[FFmpeg] First frame alpha check: colorType=${ihdrColorType} (${hasAlpha ? "RGBA ✓" : "NO ALPHA ✗"})`);
      if (!hasAlpha && !isProRes) {
        console.warn("[FFmpeg] WARNING: PNG frames do not have alpha channel! WebM output will have no transparency.");
      }
    }

    const outputExt = isProRes ? "mov" : "webm";
    const outputPath = path.join(session.dir, `output.${outputExt}`);
    let ffmpegArgs: string[];

    const reqCropY = parseInt(String(req.body.cropY || "0")) || 0;
    const reqFullHeight = parseInt(String(req.body.fullHeight || "0")) || 0;

    if (segments && Array.isArray(segments) && segments.length > 0) {
      const concatFile = path.join(session.dir, "concat.txt");
      const lines: string[] = [];
      for (const seg of segments as { frame: number; duration: number }[]) {
        const framePng = `frame_${String(seg.frame).padStart(6, "0")}.png`;
        const frameTga = `frame_${String(seg.frame).padStart(6, "0")}.tga`;
        const useFile = fs.existsSync(path.join(session.dir, frameTga)) ? frameTga : framePng;
        lines.push(`file '${useFile}'`);
        lines.push(`duration ${seg.duration.toFixed(6)}`);
      }
      const lastSeg = segments[segments.length - 1] as { frame: number };
      const lastPng = `frame_${String(lastSeg.frame).padStart(6, "0")}.png`;
      const lastTga = `frame_${String(lastSeg.frame).padStart(6, "0")}.tga`;
      const lastFile = fs.existsSync(path.join(session.dir, lastTga)) ? lastTga : lastPng;
      lines.push(`file '${lastFile}'`);
      fs.writeFileSync(concatFile, lines.join("\n"));

      ffmpegArgs = [
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", concatFile,
      ];
    } else {
      ffmpegArgs = [
        "-y",
        "-framerate", String(fpsNum),
        "-i", path.join(session.dir, "frame_%06d.png"),
      ];
    }

    if (audioPath && fs.existsSync(audioPath)) {
      ffmpegArgs.push("-i", audioPath);
    }

    if (isProRes) {
      ffmpegArgs.push(
        "-c:v", "prores_ks",
        "-profile:v", "4",
        "-pix_fmt", "yuva444p10le",
        "-r", String(fpsNum),
        "-threads", "0",
      );
      if (reqCropY >= 0 && reqFullHeight > 0) {
        ffmpegArgs.push(
          "-metadata", `comment=TELOP_CROP: Y=${reqCropY} CANVAS=1920x${reqFullHeight}`,
        );
        console.log(`[ProRes] Embedding crop metadata: Y=${reqCropY}, canvas=1920x${reqFullHeight}`);
      }
      if (audioPath && fs.existsSync(audioPath)) {
        ffmpegArgs.push(
          "-c:a", "pcm_s16le",
          "-shortest",
        );
      }
    } else {
      ffmpegArgs.push(
        "-c:v", "libvpx-vp9",
        "-pix_fmt", "yuva420p",
        "-auto-alt-ref", "0",
        "-b:v", String(videoBitrate),
        "-r", String(fpsNum),
        "-deadline", "realtime",
        "-cpu-used", "8",
        "-row-mt", "1",
        "-tile-columns", "2",
        "-threads", "0",
      );
      if (audioPath && fs.existsSync(audioPath)) {
        ffmpegArgs.push(
          "-c:a", "libopus",
          "-b:a", String(audioBitrate),
          "-shortest",
        );
      }
    }

    ffmpegArgs.push(outputPath);

    console.log(`[FFmpeg] Starting encode (${FFMPEG_BIN}):`, ffmpegArgs.join(" "));

    const totalFrames = session.frameCount;
    session.encodeProgress = {
      currentFrame: 0,
      totalFrames,
      percent: 0,
      fps: 0,
      startedAt: Date.now(),
    };

    const runEncode = () => new Promise<void>((resolve, reject) => {
      const proc = spawn(FFMPEG_BIN, ffmpegArgs, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      proc.stderr.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        if (stderr.length > 10000) stderr = stderr.slice(-5000);
        // Parse FFmpeg progress: "frame= 1234 fps= 45 q=..."
        const frameMatch = chunk.match(/frame=\s*(\d+)/);
        const fpsMatch = chunk.match(/fps=\s*([\d.]+)/);
        if (frameMatch && session.encodeProgress) {
          const cur = parseInt(frameMatch[1], 10);
          session.encodeProgress.currentFrame = cur;
          session.encodeProgress.percent = totalFrames > 0
            ? Math.min(100, Math.round((cur / totalFrames) * 100))
            : 0;
          if (fpsMatch) session.encodeProgress.fps = parseFloat(fpsMatch[1]);
        }
      });
      proc.stdout.on("data", () => {});
      proc.on("close", (code) => {
        console.log(`[FFmpeg] Encode exit code: ${code}, output exists: ${fs.existsSync(outputPath)}`);
        if (code === 0) {
          resolve();
        } else {
          const lastLines = stderr.split("\n").slice(-10).join("\n");
          console.error("[FFmpeg] Error (code " + code + "):", lastLines);
          reject(new Error(`FFmpeg exited with code ${code}: ${lastLines}`));
        }
      });
      proc.on("error", (err) => {
        console.error("[FFmpeg] Spawn error:", err.message);
        reject(err);
      });
    });

    if (asyncMode) {
      session.encodeStatus = "encoding";
      session.encodeError = null;
      session.outputPath = outputPath;
      session.isProRes = isProRes;
      res.json({ status: "encoding", message: "エンコード開始" });

      runEncode().then(() => {
        if (fs.existsSync(outputPath)) {
          session.encodeStatus = "done";
          console.log("[FFmpeg] Async encode complete:", outputPath, "size:", fs.statSync(outputPath).size);
        } else {
          session.encodeStatus = "error";
          session.encodeError = "Output file not created";
        }
      }).catch((err) => {
        session.encodeStatus = "error";
        session.encodeError = err.message;
        console.error("[FFmpeg] Async encode error:", err.message);
      });
      return;
    }

    try {
      await runEncode();
    } catch (err: any) {
      return res.status(500).json({ message: `Encode failed: ${err.message}` });
    }

    if (!fs.existsSync(outputPath)) {
      return res.status(500).json({ message: "Output file not created" });
    }

    const stat = fs.statSync(outputPath);
    const contentType = isProRes ? "video/quicktime" : "video/webm";
    const filename = isProRes ? "telop_prores4444.mov" : "telop_vp9_alpha.webm";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    const stream = fs.createReadStream(outputPath);
    stream.pipe(res);

    stream.on("close", () => {
      fs.rmSync(session.dir, { recursive: true, force: true });
      exportSessions.delete(req.params.sessionId);
    });
  });

  app.get("/api/export/:sessionId/status", (req, res) => {
    const session = exportSessions.get(req.params.sessionId);
    if (!session) return res.status(404).json({ message: "Session not found" });
    const status = session.encodeStatus || "idle";
    const error = session.encodeError || null;
    let fileSize = 0;
    if (status === "done" && session.outputPath && fs.existsSync(session.outputPath)) {
      fileSize = fs.statSync(session.outputPath).size;
    }
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.json({ status, error, fileSize, progress: session.encodeProgress || null });
  });

  app.get("/api/export/:sessionId/download", (req, res) => {
    const session = exportSessions.get(req.params.sessionId);
    if (!session) return res.status(404).json({ message: "Session not found" });
    if (session.encodeStatus !== "done" || !session.outputPath || !fs.existsSync(session.outputPath)) {
      return res.status(400).json({ message: "File not ready" });
    }
    const stat = fs.statSync(session.outputPath);
    const contentType = session.isProRes ? "video/quicktime" : "video/webm";
    const filename = session.isProRes ? "telop_prores4444.mov" : "telop_vp9_alpha.webm";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    const stream = fs.createReadStream(session.outputPath);
    stream.pipe(res);
    stream.on("close", () => {
      fs.rmSync(session.dir, { recursive: true, force: true });
      exportSessions.delete(req.params.sessionId);
    });
  });

  app.post("/api/export/webm-to-prores",
    multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } }).fields([
      { name: "webm", maxCount: 1 },
      { name: "audio", maxCount: 1 },
    ]),
    async (req, res) => {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const webmFile = files?.webm?.[0];
      if (!webmFile) return res.status(400).json({ message: "WebMファイルが必要です" });

      const sessionId = `prores_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const dir = path.join("uploads", "export_sessions", sessionId);
      fs.mkdirSync(dir, { recursive: true });

      const webmPath = path.join(dir, "input.webm");
      fs.writeFileSync(webmPath, webmFile.buffer);

      const audioFile = files?.audio?.[0];
      let audioPath: string | null = null;
      if (audioFile) {
        audioPath = path.join(dir, "audio_input" + path.extname(audioFile.originalname || ".mp3"));
        fs.writeFileSync(audioPath, audioFile.buffer);
      }

      const cropY = parseInt(req.body?.cropY || "0") || 0;
      const fullHeight = parseInt(req.body?.fullHeight || "0") || 0;

      const outputPath = path.join(dir, "output.mov");
      const ffmpegArgs = [
        "-y",
        "-i", webmPath,
      ];
      if (audioPath) {
        ffmpegArgs.push("-i", audioPath);
      }
      ffmpegArgs.push(
        "-c:v", "prores_ks",
        "-profile:v", "4",
        "-pix_fmt", "yuva444p10le",
        "-r", "30",
        "-threads", "0",
      );
      if (cropY > 0 && fullHeight > 0) {
        ffmpegArgs.push("-metadata", `comment=TELOP_CROP: Y=${cropY} CANVAS=1920x${fullHeight}`);
      }
      if (audioPath) {
        ffmpegArgs.push("-c:a", "pcm_s16le", "-shortest");
      } else {
        ffmpegArgs.push("-an");
      }
      ffmpegArgs.push(outputPath);

      exportSessions.set(sessionId, {
        dir,
        frameCount: 0,
        createdAt: Date.now(),
        encodeStatus: "encoding",
        encodeError: null,
        outputPath,
        isProRes: true,
      });

      res.json({ sessionId, status: "encoding" });

      console.log("[FFmpeg] WebM→ProRes encode:", FFMPEG_BIN, ffmpegArgs.join(" "));
      try {
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(FFMPEG_BIN, ffmpegArgs, { stdio: ["ignore", "pipe", "pipe"] });
          let stderr = "";
          proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
          proc.on("close", (code) => {
            if (code === 0) resolve();
            else { console.error("[FFmpeg] ProRes error:", stderr.slice(-500)); reject(new Error(`FFmpeg exit ${code}`)); }
          });
          proc.on("error", reject);
        });

        const session = exportSessions.get(sessionId);
        if (session) {
          session.encodeStatus = "done";
          console.log("[FFmpeg] ProRes encode done:", outputPath, "size:", fs.statSync(outputPath).size);
        }
      } catch (err: any) {
        const session = exportSessions.get(sessionId);
        if (session) {
          session.encodeStatus = "error";
          session.encodeError = err.message;
        }
        console.error("[FFmpeg] ProRes encode error:", err.message);
      }
    }
  );

  app.post("/api/export/zip-frames", frameUpload.array("frames", 100000), async (req, res) => {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ message: "No frames" });
    }
    const projectName = (req.body.projectName as string) || "telop";

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${projectName}_telop.zip"`);

    const archive = archiver("zip", { zlib: { level: 1 } });
    archive.pipe(res);

    for (const file of files) {
      archive.append(file.buffer, { name: file.originalname });
    }

    await archive.finalize();
  });

  app.get("/api/dropbox/status", async (_req, res) => {
    try {
      const status = await checkDropboxConnection();
      if (status.connected) {
        try {
          const dbx = await getUncachableDropboxClient();
          const account = await dbx.usersGetCurrentAccount();
          res.json({
            connected: true,
            method: status.method,
            email: account.result.email,
            name: account.result.name?.display_name,
            rootInfo: account.result.root_info,
            accountType: account.result.account_type,
          });
          return;
        } catch {}
      }
      res.json({ connected: false, method: status.method });
    } catch {
      res.json({ connected: false, method: 'none' });
    }
  });

  app.get("/api/dropbox/files", async (req, res) => {
    try {
      const preset = req.query.preset as string | undefined;
      const files = await listDropboxFiles(preset || undefined);
      res.json({ files });
    } catch (err: any) {
      console.error("[Dropbox] List files error:", err.message);
      res.status(500).json({ message: "Dropboxファイル一覧の取得に失敗しました", error: err.message });
    }
  });

  app.get("/api/dropbox/browse", async (req, res) => {
    try {
      const folderPath = (req.query.path as string) || "";
      const entries = await browseDropboxFolder(folderPath);
      res.json({ entries, path: folderPath });
    } catch (err: any) {
      console.error("[Dropbox] Browse error:", err.message, err?.error || "");
      res.status(500).json({ message: "フォルダの取得に失敗しました", error: err.message });
    }
  });

  app.get("/api/dropbox/search", async (req, res) => {
    try {
      const query = (req.query.q as string) || "";
      if (!query.trim()) return res.json({ results: [] });
      const results = await searchDropboxFiles(query.trim());
      res.json({ results });
    } catch (err: any) {
      console.error("[Dropbox] Search error:", err.message);
      res.status(500).json({ message: "検索に失敗しました", error: err.message });
    }
  });

  app.get("/api/dropbox/download", async (req, res) => {
    try {
      const dropboxPath = req.query.path as string;
      const convertToMp3 = req.query.convert === "mp3";
      if (!dropboxPath) return res.status(400).json({ message: "path is required" });
      const buffer = await downloadFromDropbox(dropboxPath);
      const fileName = path.basename(dropboxPath);
      const fileExt = path.extname(fileName).toLowerCase();

      if (convertToMp3 && fileExt !== ".mp3") {
        const tmpDir = path.join(process.cwd(), "tmp_audio");
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        const inputPath = path.join(tmpDir, `input_${Date.now()}${fileExt}`);
        const outputPath = path.join(tmpDir, `output_${Date.now()}.mp3`);
        try {
          fs.writeFileSync(inputPath, buffer);
          await new Promise<void>((resolve, reject) => {
            const proc = spawn(FFMPEG_BIN, [
              "-y", "-i", inputPath,
              "-vn", "-ar", "44100", "-ac", "2", "-b:a", "192k",
              "-f", "mp3", outputPath
            ]);
            let stderr = "";
            proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
            proc.on("close", (code) => {
              if (code === 0) resolve();
              else reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
            });
            proc.on("error", reject);
          });
          const mp3Buffer = fs.readFileSync(outputPath);
          const mp3Name = fileName.replace(/\.[^.]+$/i, ".mp3");
          res.setHeader("Content-Type", "audio/mpeg");
          res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(mp3Name)}"`);
          res.setHeader("Content-Length", mp3Buffer.length);
          res.send(mp3Buffer);
        } finally {
          try { fs.unlinkSync(inputPath); } catch {}
          try { fs.unlinkSync(outputPath); } catch {}
        }
        return;
      }

      const extMap: Record<string, string> = {
        ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac",
        ".ogg": "audio/ogg", ".flac": "audio/flac", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xls": "application/vnd.ms-excel",
        ".pdf": "application/pdf", ".txt": "text/plain",
      };
      const contentType = extMap[fileExt] || "application/octet-stream";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (err: any) {
      console.error("[Dropbox] Download error:", err.message);
      const errMsg = err.message || "";
      const errSummary = err?.error?.error_summary || "";
      if (errMsg.includes("token") || errMsg.includes("auth") || errMsg.includes("expired") || errMsg.includes("invalid_access_token") || errSummary.includes("invalid_access_token")) {
        res.status(401).json({ message: "Dropbox認証エラー", error: errMsg });
      } else if (errSummary.includes("path/not_found") || errSummary.includes("path/restricted_content")) {
        res.status(404).json({ message: "Dropbox上にファイルが見つかりません", error: errMsg });
      } else {
        res.status(500).json({ message: "Dropboxからのダウンロードに失敗しました", error: errMsg });
      }
    }
  });

  app.post("/api/audio/convert-to-mp3", express.raw({ type: "*/*", limit: "200mb" }), async (req, res) => {
    try {
      const inputBuffer = req.body as Buffer;
      if (!inputBuffer || inputBuffer.length === 0) return res.status(400).json({ message: "No audio data" });
      const ext = (req.query.ext as string || ".wav").toLowerCase();
      const tmpDir = path.join(process.cwd(), "tmp_audio");
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const inputPath = path.join(tmpDir, `conv_in_${Date.now()}${ext}`);
      const outputPath = path.join(tmpDir, `conv_out_${Date.now()}.mp3`);
      try {
        fs.writeFileSync(inputPath, inputBuffer);
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(FFMPEG_BIN, [
            "-y", "-i", inputPath,
            "-vn", "-ar", "44100", "-ac", "2", "-b:a", "192k",
            "-f", "mp3", outputPath
          ]);
          let stderr = "";
          proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
          proc.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
          });
          proc.on("error", reject);
        });
        const mp3Buffer = fs.readFileSync(outputPath);
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Content-Length", mp3Buffer.length);
        res.send(mp3Buffer);
      } finally {
        try { fs.unlinkSync(inputPath); } catch {}
        try { fs.unlinkSync(outputPath); } catch {}
      }
    } catch (err: any) {
      console.error("[Audio Convert] Error:", err.message);
      res.status(500).json({ message: "音声変換に失敗しました", error: err.message });
    }
  });

  app.get("/api/dropbox/diagnostic", async (req, res) => {
    try {
      const result = await diagnoseDrpboxStructure();
      console.log('[Dropbox] Diagnostic result:', JSON.stringify(result, null, 2));
      res.json(result);
    } catch (err: any) {
      console.error("[Dropbox] Diagnostic error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/dropbox/find", async (req, res) => {
    try {
      const fileName = req.query.fileName as string;
      if (!fileName) return res.status(400).json({ message: "fileName is required" });
      const baseName = fileName.replace(/\.(mp3|wav|m4a|aac|ogg|flac|wma|aiff)$/i, "");
      const searchNameLower = baseName.toLowerCase();

      const allFiles = await listDropboxFiles();
      console.log(`[Dropbox] listDropboxFiles returned ${allFiles.length} files:`, allFiles.map(f => f.path));

      const exact = allFiles.find(f => {
        const fBase = f.name.replace(/\.(mp3|wav|m4a|aac|ogg|flac|wma|aiff)$/i, "").toLowerCase();
        return fBase === searchNameLower;
      });
      if (exact) return res.json({ found: true, path: exact.path });

      const partial = allFiles.find(f => {
        const fBase = f.name.replace(/\.(mp3|wav|m4a|aac|ogg|flac|wma|aiff)$/i, "").toLowerCase();
        return fBase.includes(searchNameLower);
      });
      if (partial) return res.json({ found: true, path: partial.path });

      console.log(`[Dropbox] "${baseName}" not found in Telop音源 list, running global search...`);
      const audioExts = ["mp3", "wav", "m4a", "aac", "ogg", "flac", "wma", "aiff"];
      const searchResults = await searchDropboxFiles(baseName, audioExts);
      if (searchResults.length > 0) {
        const exactSearch = searchResults.find(f => {
          const sBase = f.name.replace(/\.(mp3|wav|m4a|aac|ogg|flac|wma|aiff)$/i, "").toLowerCase();
          return sBase === baseName.toLowerCase() || sBase.includes(baseName.toLowerCase());
        });
        if (exactSearch) {
          console.log(`[Dropbox] Found via global search: ${exactSearch.path}`);
          return res.json({ found: true, path: exactSearch.path });
        }
      }

      console.log(`[Dropbox] "${baseName}" not found anywhere. Global search returned ${searchResults.length} results.`);

      // 見つからない場合、フォルダ構造を自動診断してログ出力
      try {
        const diag = await diagnoseDrpboxStructure();
        console.log('[Dropbox] Auto-diagnostic (file not found):', JSON.stringify(diag, null, 2));
      } catch (de: any) {
        console.error('[Dropbox] Auto-diagnostic failed:', de.message);
      }

      res.json({ found: false });
    } catch (err: any) {
      console.error("[Dropbox] Find error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/dropbox/check-exists", async (req, res) => {
    try {
      const preset = (req.query.preset as string) || "other";
      const fileName = req.query.fileName as string;
      if (!fileName) return res.status(400).json({ message: "fileName is required" });
      const result = await checkDropboxFileExists(preset, fileName);
      res.json(result);
    } catch (err: any) {
      console.error("[Dropbox] Check exists error:", err.message);
      res.status(500).json({ message: "Dropboxファイル確認に失敗しました", error: err.message });
    }
  });

  app.post("/api/dropbox/delete", async (req, res) => {
    try {
      const { dropboxPath } = req.body;
      console.log("[Dropbox] Delete request received, path:", dropboxPath);
      if (!dropboxPath || typeof dropboxPath !== "string") {
        return res.status(400).json({ message: "dropboxPath is required" });
      }
      await deleteFromDropbox(dropboxPath);
      res.json({ success: true });
    } catch (err: any) {
      if (err?.error?.error_summary?.includes("path_lookup/not_found")) {
        return res.json({ success: true, alreadyDeleted: true });
      }
      console.error("[Dropbox] Delete error:", err.message);
      res.status(500).json({ message: "Dropboxファイル削除に失敗しました", error: err.message });
    }
  });

  app.post("/api/dropbox/rename", async (req, res) => {
    try {
      const { fromPath, toPath } = req.body;
      if (!fromPath || !toPath || typeof fromPath !== "string" || typeof toPath !== "string") {
        return res.status(400).json({ message: "fromPath and toPath are required" });
      }
      const newPath = await renameInDropbox(fromPath, toPath);
      res.json({ success: true, newPath });
    } catch (err: any) {
      console.error("[Dropbox] Rename error:", err.message);
      res.status(500).json({ message: "Dropboxファイルのリネームに失敗しました", error: err.message });
    }
  });

  const dropboxAudioUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 200 * 1024 * 1024 },
  });

  app.post("/api/dropbox/upload", dropboxAudioUpload.single("audio"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "音声ファイルが必要です" });
      const preset = (req.body.preset as string) || "other";
      const originalName = (req.body.fileName as string) || req.file.originalname || "audio.mp3";

      const ext = originalName.split(".").pop()?.toLowerCase() || "";
      const isAlreadyMp3 = ext === "mp3" && req.file.mimetype === "audio/mpeg";

      let mp3Buffer: Buffer;
      let mp3FileName: string;

      if (isAlreadyMp3) {
        mp3Buffer = req.file.buffer;
        mp3FileName = originalName;
      } else {
        const tmpInput = path.join(uploadDir, `dbx_in_${Date.now()}.${ext || "bin"}`);
        const tmpOutput = path.join(uploadDir, `dbx_out_${Date.now()}.mp3`);
        fs.writeFileSync(tmpInput, req.file.buffer);

        try {
          await new Promise<void>((resolve, reject) => {
            const proc = spawn(FFMPEG_BIN, [
              "-y", "-i", tmpInput,
              "-codec:a", "libmp3lame",
              "-b:a", "192k",
              "-ar", "44100",
              "-ac", "2",
              tmpOutput,
            ], { stdio: ["ignore", "pipe", "pipe"] });
            let stderr = "";
            proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
            proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg error (code ${code}): ${stderr.slice(-500)}`)));
            proc.on("error", reject);
          });
          mp3Buffer = fs.readFileSync(tmpOutput);
          mp3FileName = originalName.replace(/\.[^.]+$/, "") + ".mp3";
        } finally {
          if (fs.existsSync(tmpInput)) fs.unlinkSync(tmpInput);
          if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput);
        }
      }

      const uploadMode = (req.body.mode as string) || "auto";
      const validModes = ["overwrite", "rename", "auto"];
      const dropboxPath = await uploadToDropbox(mp3Buffer, preset, mp3FileName, validModes.includes(uploadMode) ? uploadMode as any : "auto");
      res.json({
        dropboxPath,
        fileName: path.basename(dropboxPath),
        size: mp3Buffer.length,
      });
    } catch (err: any) {
      console.error("[Dropbox] Upload error:", err.message);
      res.status(500).json({ message: "Dropboxへのアップロードに失敗しました", error: err.message });
    }
  });

  app.post("/api/dropbox/upload-telop", express.json({ limit: "200mb" }), async (req, res) => {
    try {
      const { fileName, content, preset } = req.body;
      if (!fileName || !content) return res.status(400).json({ message: "fileName and content are required" });
      const dbx = await getTeamDropboxClient();
      const NEW_TELOP_ROOT = "/nrs チーム フォルダ/NEW TELOP";
      const presetFolder = preset === "sakurazaka" ? "SAKURAZAKA" : preset === "hinatazaka" ? "HINATAZAKA" : "OTHER";
      const telopFolder = `${NEW_TELOP_ROOT}/.telop/${presetFolder}`;
      try { await dbx.filesCreateFolderV2({ path: NEW_TELOP_ROOT, autorename: false }); } catch {}
      try { await dbx.filesCreateFolderV2({ path: `${NEW_TELOP_ROOT}/.telop`, autorename: false }); } catch {}
      try { await dbx.filesCreateFolderV2({ path: telopFolder, autorename: false }); } catch {}
      const dropboxPath = `${telopFolder}/${fileName}`;
      const buf = Buffer.from(content, "base64");
      await dbx.filesUpload({ path: dropboxPath, contents: buf, mode: { ".tag": "overwrite" } });
      res.json({ dropboxPath, size: buf.length });
    } catch (err: any) {
      console.error("[Dropbox] Telop upload error:", err.message);
      res.status(500).json({ message: "Dropboxへのアップロードに失敗しました", error: err.message });
    }
  });

  app.post("/api/export/:sessionId/upload-to-dropbox", async (req, res) => {
    try {
      const session = exportSessions.get(req.params.sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });
      if (session.encodeStatus !== "done" || !session.outputPath || !fs.existsSync(session.outputPath)) {
        return res.status(400).json({ message: "File not ready" });
      }

      const { preset = "other", fileName = "output.mov" } = req.body;
      const dbx = await getTeamDropboxClient();
      const NEW_TELOP_ROOT = "/nrs チーム フォルダ/NEW TELOP";
      const presetFolder = preset === "sakurazaka" ? "SAKURAZAKA" : preset === "hinatazaka" ? "HINATAZAKA" : "OTHER";
      const movieFolder = `${NEW_TELOP_ROOT}/movie/${presetFolder}`;
      try { await dbx.filesCreateFolderV2({ path: NEW_TELOP_ROOT, autorename: false }); } catch {}
      try { await dbx.filesCreateFolderV2({ path: `${NEW_TELOP_ROOT}/movie`, autorename: false }); } catch {}
      try { await dbx.filesCreateFolderV2({ path: movieFolder, autorename: false }); } catch {}

      const fileBuffer = fs.readFileSync(session.outputPath);
      const dropboxPath = `${movieFolder}/${fileName}`;

      const CHUNK_SIZE = 8 * 1024 * 1024;
      if (fileBuffer.length <= CHUNK_SIZE) {
        await dbx.filesUpload({ path: dropboxPath, contents: fileBuffer, mode: { ".tag": "overwrite" } });
      } else {
        const sessionStart = await dbx.filesUploadSessionStart({
          contents: fileBuffer.slice(0, CHUNK_SIZE),
        });
        const uploadSessionId = sessionStart.result.session_id;
        let offset = CHUNK_SIZE;
        while (offset + CHUNK_SIZE < fileBuffer.length) {
          await dbx.filesUploadSessionAppendV2({
            cursor: { session_id: uploadSessionId, offset },
            contents: fileBuffer.slice(offset, offset + CHUNK_SIZE),
          });
          offset += CHUNK_SIZE;
        }
        await dbx.filesUploadSessionFinish({
          cursor: { session_id: uploadSessionId, offset },
          commit: { path: dropboxPath, mode: { ".tag": "overwrite" } },
          contents: fileBuffer.slice(offset),
        });
      }

      let downloadUrl: string | null = null;
      try {
        const linkRes = await dbx.filesGetTemporaryLink({ path: dropboxPath });
        downloadUrl = linkRes.result.link;
      } catch (e: any) {
        console.warn("[Dropbox] Failed to get temporary link:", e.message);
      }

      fs.rmSync(session.dir, { recursive: true, force: true });
      exportSessions.delete(req.params.sessionId);

      console.log(`[Dropbox] ProRes uploaded: ${dropboxPath} (${fileBuffer.length} bytes)`);
      res.json({ dropboxPath, downloadUrl, size: fileBuffer.length });
    } catch (err: any) {
      console.error("[Dropbox] ProRes upload error:", err.message);
      res.status(500).json({ message: "Dropboxへのアップロードに失敗しました", error: err.message });
    }
  });

  // ── Dropbox custom OAuth flow ──────────────────────────────────────────────
  app.get("/api/dropbox/oauth/status", async (_req, res) => {
    try {
      const status = await getDropboxOAuthStatus();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/dropbox/oauth/start", (req, res) => {
    const appKey = process.env.DROPBOX_APP_KEY;
    if (!appKey) {
      return res.status(400).send("DROPBOX_APP_KEY is not set. Please add it to environment secrets.");
    }
    const siteUrl = process.env.SITE_URL;
    let redirectUri: string;
    if (siteUrl) {
      redirectUri = `${siteUrl.replace(/\/$/, '')}/api/dropbox/oauth/callback`;
    } else {
      const proto = req.headers["x-forwarded-proto"] || req.protocol;
      const host = req.headers["x-forwarded-host"] || req.headers.host;
      redirectUri = `${proto}://${host}/api/dropbox/oauth/callback`;
    }
    console.log('[Dropbox OAuth] start redirectUri:', redirectUri);
    const state = Math.random().toString(36).slice(2);
    const url = getDropboxAuthUrl(redirectUri, state);
    res.redirect(url);
  });

  app.get("/api/dropbox/oauth/callback", async (req, res) => {
    const { code, error } = req.query as Record<string, string>;
    if (error) {
      return res.status(400).send(`Dropbox OAuth error: ${error}`);
    }
    if (!code) {
      return res.status(400).send("Missing code parameter");
    }
    try {
      // Use SITE_URL env var if set, otherwise compute from headers
      const siteUrl = process.env.SITE_URL;
      let redirectUri: string;
      if (siteUrl) {
        redirectUri = `${siteUrl.replace(/\/$/, '')}/api/dropbox/oauth/callback`;
      } else {
        const proto = req.headers["x-forwarded-proto"] || req.protocol;
        const host = req.headers["x-forwarded-host"] || req.headers.host;
        redirectUri = `${proto}://${host}/api/dropbox/oauth/callback`;
      }
      console.log('[Dropbox OAuth] callback redirectUri:', redirectUri);
      await exchangeDropboxCode(code, redirectUri);
      res.send(`
        <!DOCTYPE html>
        <html>
          <head><title>Dropbox接続完了</title>
          <meta charset="utf-8">
          <style>body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#1a1a2e;color:#fff;margin:0;}
          h2{color:#4CAF50;}p{color:#aaa;}button{margin-top:20px;padding:10px 24px;background:#4CAF50;color:white;border:none;border-radius:6px;cursor:pointer;font-size:16px;}</style>
          </head>
          <body>
            <h2>✓ Dropbox接続完了</h2>
            <p>リフレッシュトークンが保存されました。このウィンドウを閉じてください。</p>
            <button onclick="window.close()">閉じる</button>
            <script>
              if (window.opener) { window.opener.postMessage('dropbox-connected', '*'); }
              setTimeout(() => window.close(), 3000);
            </script>
          </body>
        </html>
      `);
    } catch (err: any) {
      console.error('[Dropbox OAuth] callback error:', err.message);
      res.status(500).send(`Error: ${err.message}`);
    }
  });

  app.post("/api/dropbox/oauth/disconnect", async (_req, res) => {
    try {
      await disconnectDropboxCustom();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/dropbox/upload-movie", multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } }).single("movie"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "動画ファイルが必要です" });
      const preset = (req.body.preset as string) || "other";
      const fileName = (req.body.fileName as string) || "output.webm";
      const dbx = await getTeamDropboxClient();
      const NEW_TELOP_ROOT = "/nrs チーム フォルダ/NEW TELOP";
      const presetFolder = preset === "sakurazaka" ? "SAKURAZAKA" : preset === "hinatazaka" ? "HINATAZAKA" : "OTHER";
      const movieFolder = `${NEW_TELOP_ROOT}/movie/${presetFolder}`;
      try { await dbx.filesCreateFolderV2({ path: NEW_TELOP_ROOT, autorename: false }); } catch {}
      try { await dbx.filesCreateFolderV2({ path: `${NEW_TELOP_ROOT}/movie`, autorename: false }); } catch {}
      try { await dbx.filesCreateFolderV2({ path: movieFolder, autorename: false }); } catch {}
      const dropboxPath = `${movieFolder}/${fileName}`;
      await dbx.filesUpload({ path: dropboxPath, contents: req.file.buffer, mode: { ".tag": "overwrite" } });
      res.json({ dropboxPath, size: req.file.buffer.length });
    } catch (err: any) {
      console.error("[Dropbox] Movie upload error:", err.message);
      res.status(500).json({ message: "Dropboxへのアップロードに失敗しました", error: err.message });
    }
  });

  return httpServer;
}
