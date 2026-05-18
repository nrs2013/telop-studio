import { db } from "./db";
import { users, projects, lyricLines, audioTrackMeta, checkMarkers, deletedProjects } from "@shared/schema";
import type { SelectUser, ServerProject, ServerLyric, ServerAudioTrackMeta, ServerCheckMarker, ServerDeletedProject } from "@shared/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import bcrypt from "bcryptjs";

// 新規ユーザーの bcrypt ラウンド数。12 ラウンドは 2025 年時点で OWASP 推奨水準（~250ms/hash）。
// 既存ユーザーの古いハッシュ（sha256 や bcrypt rounds<12）はログイン成功時に裏で再ハッシュして昇格。
const BCRYPT_ROUNDS = 12;

// Legacy SHA256 hashing — kept for backward compatibility with existing user records.
// All new passwords use bcrypt.
function legacySha256Hash(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash) return false;
  // bcrypt hashes start with $2a$/$2b$/$2y$ and are ~60 chars
  if (storedHash.startsWith("$2")) {
    return bcrypt.compare(password, storedHash);
  }
  // Legacy: 64-char hex SHA256 hash
  if (storedHash.length === 64 && /^[a-f0-9]+$/i.test(storedHash)) {
    return legacySha256Hash(password) === storedHash;
  }
  return false;
}

// 既存ハッシュが古い形式（sha256 もしくは bcrypt の低ラウンド）なら、新しい bcrypt ハッシュを返す。
// アップグレード不要なら null。呼び出し側はログイン成功直後に DB を更新する想定。
export async function upgradePasswordIfNeeded(password: string, storedHash: string): Promise<string | null> {
  // sha256 など bcrypt 以外は必ず昇格
  if (!storedHash || !storedHash.startsWith("$2")) {
    return hashPassword(password);
  }
  // bcrypt だがラウンド数が現行の推奨より低い場合も昇格
  try {
    const currentRounds = bcrypt.getRounds(storedHash);
    if (currentRounds < BCRYPT_ROUNDS) {
      return hashPassword(password);
    }
  } catch {
    // getRounds が失敗するような壊れたハッシュは念のため再ハッシュ
    return hashPassword(password);
  }
  return null;
}

export const serverStorage = {
  async createUser(username: string, password: string, displayName?: string): Promise<SelectUser> {
    const id = crypto.randomUUID();
    const hashed = await hashPassword(password);
    const [user] = await db.insert(users).values({
      id,
      username,
      password: hashed,
      displayName: displayName || username,
    }).returning();
    return user;
  },

  async updateUserPassword(userId: string, newHash: string): Promise<void> {
    await db.update(users).set({ password: newHash }).where(eq(users.id, userId));
  },

  async getUserByUsername(username: string): Promise<SelectUser | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  },

  async getUserById(id: string): Promise<SelectUser | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  },

  async getAllProjects(): Promise<ServerProject[]> {
    return db.select().from(projects);
  },

  // TEAM SHARING: Returns ALL projects so every logged-in user sees the same list.
  // ownerId is retained on each row as audit metadata but no longer filters access.
  async getProjectsForUser(_userId: string): Promise<ServerProject[]> {
    return db.select().from(projects);
  },

  async getProject(id: string): Promise<ServerProject | undefined> {
    const [p] = await db.select().from(projects).where(eq(projects.id, id));
    return p;
  },

  async upsertProject(data: Partial<ServerProject> & { id: string }): Promise<ServerProject> {
    const sanitized = { ...data };
    if (sanitized.createdAt && !(sanitized.createdAt instanceof Date)) {
      sanitized.createdAt = new Date(sanitized.createdAt as any);
    }
    if (sanitized.updatedAt && !(sanitized.updatedAt instanceof Date)) {
      sanitized.updatedAt = new Date(sanitized.updatedAt as any);
    }
    const existing = await this.getProject(data.id);
    if (existing) {
      const [updated] = await db.update(projects)
        .set({ ...sanitized, updatedAt: new Date() })
        .where(eq(projects.id, data.id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(projects).values({
        ...sanitized,
        name: sanitized.name || "Untitled",
        createdAt: sanitized.createdAt || new Date(),
        updatedAt: new Date(),
      } as any).returning();
      return created;
    }
  },

  async deleteProject(id: string): Promise<void> {
    await db.delete(lyricLines).where(eq(lyricLines.projectId, id));
    await db.delete(audioTrackMeta).where(eq(audioTrackMeta.projectId, id));
    await db.delete(checkMarkers).where(eq(checkMarkers.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
    // 墓標を残す。これがあれば、別 PC のローカルがまだ「自分は曲Pを持ってる」
    // と思ってサーバーに push し直そうとしても拒否でき、また pull 経路でも
    // 別 PC のローカル側を強制削除させられる（復活ループの根本治癒）。
    await db
      .insert(deletedProjects)
      .values({ id, deletedAt: new Date() })
      .onConflictDoUpdate({
        target: deletedProjects.id,
        set: { deletedAt: new Date() },
      });
  },

  async getDeletedProjectIds(): Promise<string[]> {
    const rows = await db.select().from(deletedProjects);
    return rows.map((r: ServerDeletedProject) => r.id);
  },

  async isProjectTombstoned(id: string): Promise<boolean> {
    const [row] = await db.select().from(deletedProjects).where(eq(deletedProjects.id, id));
    return !!row;
  },

  // Undo（プロジェクト復活）など、明示的に「やっぱり削除取り消し」する場合に
  // 使うヘルパ。墓標を消さないと push しても 410 Gone で拒否されるので必須。
  async clearTombstone(id: string): Promise<void> {
    await db.delete(deletedProjects).where(eq(deletedProjects.id, id));
  },

  async getLyrics(projectId: string): Promise<ServerLyric[]> {
    return db.select().from(lyricLines).where(eq(lyricLines.projectId, projectId));
  },

  async syncLyrics(projectId: string, lines: ServerLyric[]): Promise<void> {
    await db.delete(lyricLines).where(eq(lyricLines.projectId, projectId));
    if (lines.length > 0) {
      await db.insert(lyricLines).values(lines.map(l => ({
        id: l.id,
        projectId: l.projectId,
        lineIndex: l.lineIndex,
        text: l.text,
        startTime: l.startTime,
        endTime: l.endTime,
        fadeIn: l.fadeIn,
        fadeOut: l.fadeOut,
        fontSize: l.fontSize ?? null,
        blankBefore: (l as any).blankBefore ? 1 : 0,
      })));
    }
  },

  async getAudioTrackMeta(projectId: string): Promise<ServerAudioTrackMeta[]> {
    return db.select().from(audioTrackMeta).where(eq(audioTrackMeta.projectId, projectId));
  },

  async syncAudioTrackMeta(projectId: string, tracks: { id: string; label: string; fileName: string; mimeType: string; createdAt?: string; dropboxPath?: string }[]): Promise<void> {
    await db.delete(audioTrackMeta).where(eq(audioTrackMeta.projectId, projectId));
    if (tracks.length > 0) {
      await db.insert(audioTrackMeta).values(tracks.map(t => ({
        id: t.id,
        projectId,
        label: t.label,
        fileName: t.fileName,
        mimeType: t.mimeType,
        dropboxPath: t.dropboxPath || null,
        createdAt: t.createdAt ? new Date(t.createdAt) : new Date(),
      })));
    }
  },

  async getCheckMarkers(projectId: string): Promise<ServerCheckMarker[]> {
    return db.select().from(checkMarkers).where(eq(checkMarkers.projectId, projectId));
  },

  async syncCheckMarkers(projectId: string, markers: { id: string; time: number }[]): Promise<void> {
    await db.delete(checkMarkers).where(eq(checkMarkers.projectId, projectId));
    if (markers.length > 0) {
      await db.insert(checkMarkers).values(markers.map(m => ({
        id: m.id,
        projectId,
        time: m.time,
      })));
    }
  },
};
