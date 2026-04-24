// Shared design tokens for the warm-gray + yellow rollout.
//
// PROMPTER STUDIO established the warm-gray palette for the post-concert
// tooling family. TELOP STUDIO adopts the same palette but swaps the
// accent hue from beige to TELOP's brand yellow (#e5bf3d). Keeping both
// values in the same object so future screens reach for the same colors
// and we can tune the whole rollout by editing this one file.
//
// Notes on hue choice: #e5bf3d has the same saturation/luminance band as
// PROMPTER's #d4a27a beige — it harmonizes with the warm-gray backdrop
// instead of clashing the way the old saturated hsl(48 100%) yellow did.
export const TS_DESIGN = {
  // --- Base surfaces (3-layer warm gray) ---
  bg: "#262624",            // page background
  bg2: "#1f1f1d",           // deeper / header strip
  surface: "#323230",       // cards, inputs, rows
  surface2: "#2e2e2b",      // table header strip, muted panel
  border: "#46463f",
  borderHi: "#5a5a53",

  // --- Text ---
  text: "#ece6d8",          // primary
  text2: "#a8a8a0",         // secondary / labels
  text3: "#76766f",         // tertiary / caption

  // --- TELOP accent (gold yellow) ---
  accent: "#e5bf3d",        // base brand yellow
  accent2: "#f2d468",       // hover / lighter
  accentGlow: "rgba(229,191,61,0.3)",

  // --- Semantic ---
  errorRed: "#e07a7a",
  okGreen: "#a6d17c",

  // --- Column-identity hues (kept as-is; functional not decorative) ---
  colSakurazaka: "hsl(340 65% 42%)",
  colHinatazaka: "hsl(200 65% 40%)",
  colOther: "hsl(260 55% 45%)",

  // --- Page backgrounds for the setlist-picker-style hero ---
  pageGradient: "linear-gradient(135deg, #1e1e1c 0%, #2e2e2b 50%, #1a1a18 100%)",
  heroRadial:
    "radial-gradient(circle at 20% 0%, rgba(229,191,61,0.06) 0%, transparent 40%)," +
    "radial-gradient(circle at 80% 100%, rgba(193,134,200,0.04) 0%, transparent 40%)," +
    "linear-gradient(180deg, #1a1a18 0%, #1e1e1c 50%, #161614 100%)",
} as const;

export type TsDesign = typeof TS_DESIGN;
