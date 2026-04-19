import { pgTable, varchar, text, integer, real, timestamp, doublePrecision } from "drizzle-orm/pg-core";
  import { createInsertSchema } from "drizzle-zod";
  import { z } from "zod";

  export const users = pgTable("users", {
    id: varchar("id", { length: 64 }).primaryKey(),
    username: text("username").notNull().unique(),
    password: text("password").notNull(),
    displayName: varchar("display_name", { length: 200 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  });

  export const projects = pgTable("projects", {
    id: varchar("id", { length: 64 }).primaryKey(),
    name: text("name").notNull(),
    audioFileName: text("audio_file_name"),
    audioFilePath: text("audio_file_path"),
    audioDuration: real("audio_duration"),
    activeAudioTrackId: varchar("active_audio_track_id", { length: 64 }),
    fontSize: integer("font_size").notNull().default(72),
    fontFamily: text("font_family").notNull().default("Noto Sans JP"),
    fontColor: text("font_color").notNull().default("#FFFFFF"),
    strokeColor: text("stroke_color").notNull().default("#000000"),
    strokeWidth: integer("stroke_width").notNull().default(3),
    strokeBlur: integer("stroke_blur").notNull().default(8),
    textAlign: text("text_align").notNull().default("center"),
    textX: real("text_x"),
    textY: real("text_y"),
    outputWidth: integer("output_width").notNull().default(1920),
    outputHeight: integer("output_height").notNull().default(1080),
    songTitle: text("song_title"),
    lyricsCredit: text("lyrics_credit"),
    musicCredit: text("music_credit"),
    arrangementCredit: text("arrangement_credit"),
    membersCredit: text("members_credit"),
    preset: text("preset").notNull().default("other"),
    motifColor: text("motif_color").notNull().default("#4466FF"),
    audioTrimStart: real("audio_trim_start").notNull().default(0),
    detectedBpm: real("detected_bpm"),
    creditLineY: real("credit_line_y").notNull().default(80),
    creditInTime: real("credit_in_time"),
    creditOutTime: real("credit_out_time"),
    creditAnimDuration: real("credit_anim_duration"),
    bpmGridOffset: doublePrecision("bpm_grid_offset").notNull().default(0),
    creditTitleFontSize: integer("credit_title_font_size").notNull().default(64),
    creditLyricsFontSize: integer("credit_lyrics_font_size").notNull().default(36),
    creditMusicFontSize: integer("credit_music_font_size").notNull().default(36),
    creditArrangementFontSize: integer("credit_arrangement_font_size").notNull().default(36),
    creditMembersFontSize: integer("credit_members_font_size").notNull().default(36),
    creditRightTitleFontSize: integer("credit_right_title_font_size").notNull().default(38),
    creditHoldStartMs: real("credit_hold_start_ms"),
    creditWipeStartMs: real("credit_wipe_start_ms"),
    creditRightTitle: text("credit_right_title"),
    creditRightTitleAnimDuration: real("credit_right_title_anim_duration"),
    creditTitleLayout: integer("credit_title_layout").notNull().default(1),
    ownerId: varchar("owner_id", { length: 64 }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  });

  export const lyricLines = pgTable("lyric_lines", {
    id: varchar("id", { length: 64 }).primaryKey(),
    projectId: varchar("project_id", { length: 64 }).notNull(),
    lineIndex: integer("line_index").notNull(),
    text: text("text").notNull().default(""),
    startTime: real("start_time"),
    endTime: real("end_time"),
    fadeIn: real("fade_in").notNull().default(0),
    fadeOut: real("fade_out").notNull().default(0),
    fontSize: integer("font_size"),
    blankBefore: integer("blank_before").notNull().default(0),
  });

  export const audioTrackMeta = pgTable("audio_track_meta", {
    id: varchar("id", { length: 64 }).primaryKey(),
    projectId: varchar("project_id", { length: 64 }).notNull(),
    label: varchar("label", { length: 500 }).notNull(),
    fileName: varchar("file_name", { length: 500 }).notNull(),
    mimeType: varchar("mime_type", { length: 100 }).notNull().default("audio/mpeg"),
    dropboxPath: varchar("dropbox_path", { length: 1000 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  });

  export const insertUserSchema = createInsertSchema(users).omit({ createdAt: true });
  export type InsertUser = z.infer<typeof insertUserSchema>;
  export type SelectUser = typeof users.$inferSelect;

  export const insertProjectSchema = createInsertSchema(projects).omit({ createdAt: true, updatedAt: true });
  export type InsertProject = z.infer<typeof insertProjectSchema>;
  export type ServerProject = typeof projects.$inferSelect;

  export const insertLyricSchema = createInsertSchema(lyricLines);
  export type InsertLyric = z.infer<typeof insertLyricSchema>;
  export type ServerLyric = typeof lyricLines.$inferSelect;

  export const checkMarkers = pgTable("check_markers", {
    id: varchar("id", { length: 64 }).primaryKey(),
    projectId: varchar("project_id", { length: 64 }).notNull(),
    time: real("time").notNull(),
  });

  export const insertAudioTrackMetaSchema = createInsertSchema(audioTrackMeta).omit({ createdAt: true });
  export type InsertAudioTrackMeta = z.infer<typeof insertAudioTrackMetaSchema>;
  export type ServerAudioTrackMeta = typeof audioTrackMeta.$inferSelect;

  export const insertCheckMarkerSchema = createInsertSchema(checkMarkers);
  export type InsertCheckMarker = z.infer<typeof insertCheckMarkerSchema>;
  export type ServerCheckMarker = typeof checkMarkers.$inferSelect;

  export const dropboxTokens = pgTable("dropbox_tokens", {
    id: varchar("id", { length: 16 }).primaryKey(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    expiresAt: timestamp("expires_at"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  });

  export interface AudioTrack {
    id: string;
    projectId: string;
    label: string;
    fileName: string;
    mimeType: string;
    createdAt: string;
  }

  export interface Project {
    id: string;
    name: string;
    audioFileName: string | null;
    audioDuration: number | null;
    activeAudioTrackId: string | null;
    fontSize: number;
    fontFamily: string;
    fontColor: string;
    strokeColor: string;
    strokeWidth: number;
    strokeBlur: number;
    textAlign: string;
    textX: number | null;
    textY: number | null;
    outputWidth: number;
    outputHeight: number;
    songTitle: string | null;
    lyricsCredit: string | null;
    musicCredit: string | null;
    arrangementCredit: string | null;
    membersCredit: string | null;
    preset: string;
    motifColor: string;
    audioTrimStart: number;
    detectedBpm: number | null;
    creditLineY: number;
    creditInTime: number | null;
    creditOutTime: number | null;
    creditAnimDuration: number | null;
    bpmGridOffset: number;
    creditTitleFontSize: number;
    creditLyricsFontSize: number;
    creditMusicFontSize: number;
    creditArrangementFontSize: number;
    creditMembersFontSize: number;
    creditRightTitleFontSize: number;
    creditHoldStartMs: number | null;
    creditWipeStartMs: number | null;
    creditRightTitle: string | null;
    creditRightTitleAnimDuration: number | null;
    creditTitleLayout: number;
    createdAt: string;
    updatedAt: string;
  }

  export interface LyricLine {
    id: string;
    projectId: string;
    lineIndex: number;
    text: string;
    startTime: number | null;
    endTime: number | null;
    fadeIn: number;
    fadeOut: number;
    fontSize: number | null;
    blankBefore: boolean;
  }
  