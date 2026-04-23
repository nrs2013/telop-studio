# Telop Studio - Lyric Subtitle Creator

## Overview
Telop Studio is a web application designed for creating lyric subtitles (telop) for video and concert productions. It allows users to import lyrics, sync them to music, fine-tune timing on a visual timeline, preview results with inline style controls, and export transparent WebM (VP9 + Opus) videos. The project prioritizes an offline-first approach, utilizing IndexedDB for all local data storage, and includes team synchronization capabilities for collaborative workflows.

## User Preferences
- Dark mode by default
- Japanese UI labels
- Concert production workflow (BPM-aware, offset/insert for interludes)
- Offline-capable features preferred
- Output default: 1920x1080
- The `demoLineYRef` value (80) for credit display line / LINE DEMO animation vertical position is user-confirmed and must NOT be changed unless explicitly requested.

## System Architecture
The application is built with a React, Vite, and Tailwind CSS frontend, incorporating shadcn/ui. It operates primarily offline using IndexedDB for all project data, lyrics, timing, and audio files. For team synchronization and backup, it integrates with a PostgreSQL backend (Drizzle ORM) via an Express.js server, which also handles FFmpeg video encoding and authentication.

Core features include:
- **UI/UX**: Single-page application layout with a draggable vertical divider, a header for project controls, an audio bar, a left panel for inline style tools, a large preview canvas, and a timeline editor. The right panel is dedicated to credit information and lyric editing.
- **Data Storage**: IndexedDB is the primary client-side storage for all project data. PostgreSQL (Supabase, Tokyo region) serves as the server-side storage for team sync, storing project metadata, lyrics, and audio track metadata.
- **Audio Processing**: Leverages Web Audio API for waveform generation and BPM detection, with a Web Worker for off-thread analysis.
- **File Parsing**: Client-side parsing for Word (.docx), Excel (.xlsx), and PDF lyric imports using `mammoth`, `xlsx`, and `pdfjs-dist`.
- **Video Export**: Server-side FFmpeg (version 7.0.2 static build) handles video encoding, supporting WebM VP9 Alpha, ProRes 4444 MOV, and ZIP frame pack exports. PNG lossless frames are generated client-side and uploaded to the server for encoding. ProRes 4444 MOV ensures alpha compatibility with Resolume Arena.
- **Synchronization**: An offline-first design with auto-sync (pull on app open, push after edits with debounce, periodic pull) and version-based conflict detection for up to 10 team members (no simultaneous editing).
- **Lyric Features**: Supports Ruby (furigana) with `漢字{ルビ}` and `[任意文字]{ルビ}` syntax, blank line linking, and check markers.
- **Timeline Editor**: Visual timeline with zoom, multi-lane block layout, BPM grid with offset, and quantize controls (8th or 16th note). Timing values are stored at full float64 precision (no millisecond rounding) to ensure exact alignment with BPM grid lines.
- **Credit System**: Advanced credit display with motif triangle and decorative burst animations, offering two distinct layouts and customizable timing phases.

## Deployment & Infrastructure
- **Hosting**: Railway (Node.js server + FFmpeg runtime). Production URL: `https://telop-studio-production.up.railway.app/`
- **Database**: Supabase PostgreSQL (Tokyo region `ap-northeast-1`, free tier). Schema auto-pushed on startup via `drizzle-kit push --force`.
- **Source**: GitHub `nrs2013/telop-studio`. Auto-deploy on push to `main`.
- **Environment variables** (set in Railway and local `.env`):
  - `DATABASE_URL`: Supabase pooler connection string (port 5432, `sslmode=require` handled by code)
  - `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`: Dropbox OAuth2 app credentials
  - `SITE_URL`: Production base URL for OAuth redirect
  - `SESSION_SECRET`: Express session signing key
- **Local dev**: `npm run dev` (serves on 127.0.0.1 via macOS; 0.0.0.0 + SO_REUSEPORT on Linux/Railway).
- **Working folder on Mac**: `~/Projects/telop-studio/` (NOT `~/Downloads/` — iCloud Drive sync corrupts git repos with its " 2" suffix behavior).

## External Dependencies
- **PostgreSQL (Supabase)**: Server-side project, lyric, audio track metadata, and user authentication storage.
- **Drizzle ORM (`drizzle-orm/node-postgres`)**: Facilitates interaction with PostgreSQL. Standard `pg.Pool`, no special driver.
- **Express.js**: Backend framework for API endpoints, authentication, and orchestrating FFmpeg video encoding.
- **FFmpeg**: Server-side video encoding for WebM (VP9 + Opus) and ProRes 4444 MOV. Static FFmpeg 7.0.2 for correct VP9 alpha channel handling.
- **IndexedDB (via `idb` library)**: Client-side storage for all project data, supporting offline functionality.
- **Dropbox (custom OAuth2 offline access)**: Integrated for storing audio files, `.telop` project files, and exported WebM movies. Uses a refresh token (permanent, stored in `dropbox_tokens` table) to auto-refresh short-lived access tokens. Client-side auto-reconnect helper `fetchDropbox` (`client/src/lib/dropbox-auto-reconnect.ts`) transparently re-opens the OAuth popup if a session dies, so users rarely see connection errors.
- **mammoth**: Client-side parsing of Word (.docx) files.
- **xlsx**: Client-side parsing of Excel (.xlsx) files.
- **pdfjs-dist**: Client-side parsing of PDF files.
- **Web Audio API**: Browser API for audio processing, waveform generation, and BPM detection.
- **Vite**: Frontend build tool.
- **React**: Frontend JavaScript library.
- **Tailwind CSS**: Utility-first CSS framework.
- **shadcn/ui**: UI component library.

## Dropbox Folder Structure (NRS Team)
The picker defaults to `/nrs チーム フォルダ` (the current working team folder). From there, common sub-locations:
- `/nrs チーム フォルダ/NEW TELOP/Telop音源/SAKURAZAKA/` (櫻坂46 audio)
- `/nrs チーム フォルダ/NEW TELOP/Telop音源/HINATAZAKA/` (日向坂46 audio)
- `/nrs チーム フォルダ/NEW TELOP/Telop音源/OTHER/` (その他)
- `/nrs チーム フォルダ/NEW TELOP/movie/` (exported videos)

Archive team folders (`/A.B.C-Z`, `/AARON`, etc.) are available via the "全体(アーカイブ含)" shortcut in the picker.
