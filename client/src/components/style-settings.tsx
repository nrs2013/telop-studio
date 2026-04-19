import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import type { Project } from "@shared/schema";
import { storage } from "@/lib/storage";
import { ColorPicker, normalizeHex } from "@/components/color-picker";

interface StyleSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  onSaved: () => void;
}

const FONTS = [
  "Noto Sans JP",
  "Inter",
  "Roboto",
  "Poppins",
  "Montserrat",
  "Open Sans",
  "Source Serif 4",
];

export function StyleSettings({ open, onOpenChange, project, onSaved }: StyleSettingsProps) {
  const { toast } = useToast();
  const [fontSize, setFontSize] = useState(project.fontSize || 48);
  const [fontFamily, setFontFamily] = useState(project.fontFamily || "Noto Sans JP");
  const [fontColor, setFontColor] = useState(project.fontColor || "#FFFFFF");
  const [strokeColor, setStrokeColor] = useState(project.strokeColor || "#000000");
  const [strokeWidth, setStrokeWidth] = useState(project.strokeWidth || 3);
  const [strokeBlur, setStrokeBlur] = useState(project.strokeBlur ?? 0);
  const [textAlign, setTextAlign] = useState(project.textAlign || "center");
  const [saving, setSaving] = useState(false);
  const outputWidth = 1920;
  const outputHeight = 1080;

  useEffect(() => {
    setFontSize(project.fontSize || 48);
    setFontFamily(project.fontFamily || "Noto Sans JP");
    setFontColor(project.fontColor || "#FFFFFF");
    setStrokeColor(project.strokeColor || "#000000");
    setStrokeWidth(project.strokeWidth || 3);
    setStrokeBlur(project.strokeBlur ?? 0);
    setTextAlign(project.textAlign || "center");
  }, [project]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await storage.updateProject(project.id, {
        fontSize,
        fontFamily,
        fontColor,
        strokeColor,
        strokeWidth,
        strokeBlur,
        textAlign,
        outputWidth,
        outputHeight,
      });
      onSaved();
      onOpenChange(false);
      toast({ title: "設定を保存しました" });
    } catch {
      toast({ title: "保存に失敗しました", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>テロップ設定</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          <div>
            <Label className="text-xs">出力サイズ</Label>
            <p className="text-sm mt-1 text-muted-foreground">{outputWidth} x {outputHeight} px (固定)</p>
          </div>

          <div>
            <Label className="text-xs">フォント</Label>
            <Select value={fontFamily} onValueChange={setFontFamily}>
              <SelectTrigger className="mt-1" data-testid="select-font">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONTS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">フォントサイズ: {fontSize}px</Label>
            <Slider
              value={[fontSize]}
              onValueChange={([v]) => setFontSize(v)}
              min={16}
              max={200}
              step={1}
              className="mt-2"
              data-testid="slider-font-size"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">フォント色</Label>
              <div className="flex items-center gap-2 mt-1">
                <ColorPicker
                  value={fontColor}
                  onChange={setFontColor}
                  size={36}
                  testId="picker-font-color-settings"
                />
                <Input
                  value={fontColor}
                  onChange={(e) => setFontColor(e.target.value)}
                  onBlur={(e) => {
                    const n = normalizeHex(e.target.value);
                    setFontColor(n ? n.toLowerCase() : (project.fontColor || "#ffffff"));
                  }}
                  className="flex-1 font-mono text-sm"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">縁取り色</Label>
              <div className="flex items-center gap-2 mt-1">
                <ColorPicker
                  value={strokeColor}
                  onChange={setStrokeColor}
                  size={36}
                  testId="picker-stroke-color-settings"
                />
                <Input
                  value={strokeColor}
                  onChange={(e) => setStrokeColor(e.target.value)}
                  onBlur={(e) => {
                    const n = normalizeHex(e.target.value);
                    setStrokeColor(n ? n.toLowerCase() : (project.strokeColor || "#000000"));
                  }}
                  className="flex-1 font-mono text-sm"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">縁取り太さ: {strokeWidth}px</Label>
              <Slider
                value={[strokeWidth]}
                onValueChange={([v]) => setStrokeWidth(v)}
                min={0}
                max={20}
                step={1}
                className="mt-2"
                data-testid="slider-stroke-width"
              />
            </div>
            <div>
              <Label className="text-xs">縁取りぼかし: {strokeBlur}px</Label>
              <Slider
                value={[strokeBlur]}
                onValueChange={([v]) => setStrokeBlur(v)}
                min={0}
                max={20}
                step={1}
                className="mt-2"
                data-testid="slider-stroke-blur"
              />
            </div>
          </div>

          <Button
            className="w-full"
            onClick={handleSave}
            disabled={saving}
            data-testid="button-save-settings"
          >
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
