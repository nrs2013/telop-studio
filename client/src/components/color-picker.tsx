import { useState, useCallback, useEffect, useRef } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const PRESET_COLORS = [
  "#FFFFFF", "#000000", "#FF0000", "#00FF00", "#0000FF",
  "#FFFF00", "#FF00FF", "#00FFFF", "#FF8800", "#8800FF",
  "#FF4466", "#44FF66", "#4466FF", "#FFAA00", "#AA00FF",
  "#888888", "#CCCCCC", "#333333", "#664400", "#004466",
];

const HEX_REGEX = /^#[0-9A-Fa-f]{6}$/;

export function normalizeHex(val: string): string | null {
  let s = val.trim();
  if (!s.startsWith("#")) s = "#" + s;
  if (/^#[0-9A-Fa-f]{3}$/.test(s)) {
    s = "#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  }
  s = s.toUpperCase();
  if (HEX_REGEX.test(s)) return s;
  return null;
}

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  onClear?: () => void;
  disabled?: boolean;
  size?: number;
  testId?: string;
}

export function ColorPicker({ value, onChange, onClear, disabled, size = 28, testId }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) setDraft(value);
  }, [value, open]);

  const applyColor = useCallback((hex: string) => {
    const normalized = normalizeHex(hex);
    if (normalized) {
      setDraft(normalized);
      onChange(normalized.toLowerCase());
    }
  }, [onChange]);

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setDraft(raw);
    const normalized = normalizeHex(raw);
    if (normalized) {
      onChange(normalized.toLowerCase());
    }
  }, [onChange]);

  const handleTextBlur = useCallback(() => {
    const normalized = normalizeHex(draft);
    if (normalized) {
      setDraft(normalized);
      onChange(normalized.toLowerCase());
    } else {
      setDraft(value);
    }
  }, [draft, value, onChange]);

  const handleTextKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleTextBlur();
    }
    e.stopPropagation();
  }, [handleTextBlur]);

  const displayColor = normalizeHex(draft) ? draft : value;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          style={{
            width: size,
            height: size,
            backgroundColor: disabled ? "transparent" : displayColor,
            borderRadius: 4,
            border: "2px solid hsl(0 0% 35%)",
            cursor: "pointer",
            padding: 0,
            outline: "none",
            position: "relative",
            overflow: "hidden",
          }}
          data-testid={testId}
          onClick={() => setOpen(true)}
        >
          {disabled && (
            <svg viewBox="0 0 24 24" width={size - 4} height={size - 4} style={{ position: "absolute", top: 0, left: 0 }}>
              <line x1="4" y1="4" x2="20" y2="20" stroke="hsl(0 0% 45%)" strokeWidth="2" />
              <line x1="20" y1="4" x2="4" y2="20" stroke="hsl(0 0% 45%)" strokeWidth="2" />
            </svg>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-3"
        style={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 22%)" }}
        align="start"
        sideOffset={4}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 200 }}>
          <div
            style={{
              width: "100%",
              height: 32,
              backgroundColor: disabled ? "transparent" : displayColor,
              borderRadius: 4,
              border: "1px solid hsl(0 0% 30%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {disabled && <span style={{ color: "hsl(0 0% 50%)", fontSize: 11 }}>OFF</span>}
          </div>

          {onClear && (
            <button
              type="button"
              onClick={() => { onClear(); setOpen(false); }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                width: "100%",
                height: 30,
                backgroundColor: disabled ? "hsl(0 0% 20%)" : "transparent",
                border: disabled ? "2px solid hsl(0 0% 60%)" : "1px solid hsl(0 0% 30%)",
                borderRadius: 4,
                color: "hsl(0 0% 60%)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                outline: "none",
              }}
              data-testid={testId ? `${testId}-clear` : undefined}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="3" x2="13" y2="13" />
                <line x1="13" y1="3" x2="3" y2="13" />
              </svg>
              STROKE OFF
            </button>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4 }}>
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  applyColor(c);
                }}
                style={{
                  width: 32,
                  height: 32,
                  backgroundColor: c,
                  borderRadius: 4,
                  border: !disabled && c.toUpperCase() === (normalizeHex(draft) || "").toUpperCase()
                    ? "2px solid hsl(0 0% 60%)"
                    : "1px solid hsl(0 0% 30%)",
                  cursor: "pointer",
                  padding: 0,
                  outline: "none",
                }}
                data-testid={testId ? `${testId}-preset-${c.slice(1)}` : undefined}
              />
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "hsl(0 0% 50%)", fontSize: 11, fontWeight: 600 }}>HEX</span>
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={handleTextChange}
              onBlur={handleTextBlur}
              onKeyDown={handleTextKeyDown}
              maxLength={7}
              spellCheck={false}
              style={{
                flex: 1,
                backgroundColor: "hsl(0 0% 8%)",
                border: "1px solid hsl(0 0% 25%)",
                borderRadius: 4,
                color: "#fff",
                fontFamily: "monospace",
                fontSize: 13,
                padding: "4px 8px",
                outline: "none",
              }}
              data-testid={testId ? `${testId}-hex-input` : undefined}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
