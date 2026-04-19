import { db } from "./db";
import { users, projects, lyricLines, audioTrackMeta, checkMarkers } from "@shared/schema";
import type { SelectUser, ServerProject, ServerLyric, ServerAudioTrackMeta, ServerCheckMarker } from "@shared/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

export const serverStorage = {
  async createUser(username: string, password: string, displayName?: string): Promise<SelectUser> {
    const id = crypto.randomUUID();
    const [user] = await db.insert(users).values({
      id,
      username,
      password: hashPassword(password),
      displayName: displayName || username,
    }).returning();
    return user;
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
