// Supabase 直接アクセスによる sync 層（Express を介さない serverless 化）。
//
// 既存の syncService.ts と同じインターフェースを提供しつつ、内部は @supabase/supabase-js
// で直接 Postgres に接続する。
//
// マイグレーション計画：
//   Phase 2a (現在): スケルトンと pull の最小実装
//   Phase 2b       : push, markDirty, schedulePush, immediatePush
//   Phase 2c       : autoSync interval、LIVE モード連動、touch protection
//   Phase 2d       : 既存 syncService と入れ替え、Express 廃止
//
// RLS 前提：
//   - 全テーブルで「authenticated は read/write 可能」のシンプルなポリシー
//   - anon は read のみ（または完全に拒否）
//   - 詳細ポリシーは Supabase Dashboard → Authentication → Policies で設定

import { getSupabase, isSupabaseConfigured } from "./supabaseClient";
import { storage } from "./storage";

export interface SupabasePullResult {
  added: number;
  updated: number;
}

/**
 * Supabase から全データを pull してローカル IndexedDB にマージ。
 * 既存の syncService.pullAndMergeToLocal の Supabase 版。
 */
export async function supabasePullAndMergeToLocal(): Promise<SupabasePullResult> {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase not configured");
  }
  const supabase = getSupabase();

  // 並列で全テーブル取得
  const [projectsRes, lyricsRes, audioTracksRes, markersRes, deletedRes] = await Promise.all([
    supabase.from("projects").select("*"),
    supabase.from("lyric_lines").select("*"),
    supabase.from("audio_track_meta").select("*"),
    supabase.from("check_markers").select("*"),
    supabase.from("deleted_projects").select("id"),
  ]);

  if (projectsRes.error) throw projectsRes.error;
  if (lyricsRes.error) throw lyricsRes.error;
  if (audioTracksRes.error) throw audioTracksRes.error;
  if (markersRes.error) throw markersRes.error;
  if (deletedRes.error) throw deletedRes.error;

  const serverProjects = projectsRes.data || [];
  const serverLyrics = lyricsRes.data || [];
  const serverAudioTracks = audioTracksRes.data || [];
  const serverMarkers = markersRes.data || [];
  const serverDeletedIds = (deletedRes.data || []).map((d: any) => d.id);

  let added = 0;
  let updated = 0;

  // deleted projects を最優先で処理（ローカルから消す）
  for (const id of serverDeletedIds) {
    const local = await storage.getProject(id);
    if (local) {
      await storage.deleteProject(id);
      await storage.recordDeletion(id);
    }
  }

  // projects upsert（snake_case → camelCase 変換が必要）
  for (const sp of serverProjects) {
    if (serverDeletedIds.includes(sp.id)) continue;
    const local = await storage.getProject(sp.id);
    const projectData = snakeToCamelProject(sp);
    if (local) {
      await storage.updateProject(sp.id, projectData);
      updated++;
    } else {
      await storage.createProject(projectData);
      added++;
    }
  }

  // lyric_lines を project ごとにグループ化して setLyricLines で一括投入
  const lyricsByProject = new Map<string, any[]>();
  for (const l of serverLyrics) {
    if (!lyricsByProject.has(l.project_id)) lyricsByProject.set(l.project_id, []);
    lyricsByProject.get(l.project_id)!.push({
      id: l.id,
      lineIndex: l.line_index,
      text: l.text,
      startTime: l.start_time,
      endTime: l.end_time,
      fadeIn: l.fade_in,
      fadeOut: l.fade_out,
      fontSize: l.font_size,
      blankBefore: !!l.blank_before,
    });
  }
  for (const [projectId, lines] of lyricsByProject) {
    await storage.setLyricLines(projectId, lines);
  }

  // audio_track_meta（既存の upsertAudioTrackMeta が touch protection を持ってる）
  for (const sat of serverAudioTracks) {
    await storage.upsertAudioTrackMeta({
      id: sat.id,
      projectId: sat.project_id,
      label: sat.label,
      fileName: sat.file_name,
      mimeType: sat.mime_type || "audio/mpeg",
      createdAt: sat.created_at || new Date().toISOString(),
      dropboxPath: sat.dropbox_path || undefined,
    });
  }

  // check_markers は project ごとに setCheckMarkers で一括
  const markersByProject = new Map<string, any[]>();
  for (const m of serverMarkers) {
    if (!markersByProject.has(m.project_id)) markersByProject.set(m.project_id, []);
    markersByProject.get(m.project_id)!.push({ id: m.id, time: m.time });
  }
  for (const [projectId, markers] of markersByProject) {
    await storage.setCheckMarkers(projectId, markers);
  }

  return { added, updated };
}

// ─── snake_case ↔ camelCase 変換 ──────────────────────────
// Drizzle / Postgres は snake_case、クライアント Project 型は camelCase。
// 一括変換するヘルパ。

function snakeToCamelProject(sp: any): any {
  return {
    name: sp.name,
    audioFileName: sp.audio_file_name,
    audioDuration: sp.audio_duration,
    activeAudioTrackId: sp.active_audio_track_id,
    fontSize: sp.font_size,
    fontFamily: sp.font_family,
    fontColor: sp.font_color,
    strokeColor: sp.stroke_color,
    strokeWidth: sp.stroke_width,
    strokeBlur: sp.stroke_blur,
    textAlign: sp.text_align,
    textX: sp.text_x,
    textY: sp.text_y,
    outputWidth: sp.output_width,
    outputHeight: sp.output_height,
    songTitle: sp.song_title,
    lyricsCredit: sp.lyrics_credit,
    musicCredit: sp.music_credit,
    arrangementCredit: sp.arrangement_credit,
    membersCredit: sp.members_credit,
    preset: sp.preset || "other",
    motifColor: sp.motif_color,
    audioTrimStart: sp.audio_trim_start ?? 0,
    detectedBpm: sp.detected_bpm,
    creditLineY: sp.credit_line_y ?? 80,
    creditInTime: sp.credit_in_time,
    creditOutTime: sp.credit_out_time,
    creditAnimDuration: sp.credit_anim_duration,
    bpmGridOffset: sp.bpm_grid_offset ?? 0,
    creditTitleFontSize: sp.credit_title_font_size ?? 64,
    creditLyricsFontSize: sp.credit_lyrics_font_size ?? 36,
    creditMusicFontSize: sp.credit_music_font_size ?? 36,
    creditArrangementFontSize: sp.credit_arrangement_font_size ?? 36,
    creditMembersFontSize: sp.credit_members_font_size ?? 36,
    creditRightTitleFontSize: sp.credit_right_title_font_size ?? 38,
    creditHoldStartMs: sp.credit_hold_start_ms,
    creditWipeStartMs: sp.credit_wipe_start_ms,
    creditRightTitle: sp.credit_right_title,
    creditRightTitleAnimDuration: sp.credit_right_title_anim_duration,
    creditTitleLayout: sp.credit_title_layout ?? 1,
  };
}
