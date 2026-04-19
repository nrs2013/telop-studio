import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Save } from "lucide-react";
import type { Project } from "@shared/schema";

interface MetadataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project | undefined;
  onSave: (data: {
    songTitle: string | null;
    lyricsCredit: string | null;
    musicCredit: string | null;
    arrangementCredit: string | null;
    motifColor?: string;
  }) => void;
  isPending?: boolean;
}

export function MetadataDialog({ open, onOpenChange, project, onSave, isPending }: MetadataDialogProps) {
  const [songTitle, setSongTitle] = useState("");
  const [lyricsCredit, setLyricsCredit] = useState("");
  const [musicCredit, setMusicCredit] = useState("");
  const [arrangementCredit, setArrangementCredit] = useState("");
  const [motifColor, setMotifColor] = useState("#4466FF");

  useEffect(() => {
    if (project && open) {
      setSongTitle(project.songTitle || "");
      setLyricsCredit(project.lyricsCredit || "");
      setMusicCredit(project.musicCredit || "");
      setArrangementCredit(project.arrangementCredit || "");
      setMotifColor(project.motifColor || "#4466FF");
    }
  }, [project, open]);

  const handleSave = () => {
    onSave({
      songTitle: songTitle.trim() || null,
      lyricsCredit: lyricsCredit.trim() || null,
      musicCredit: musicCredit.trim() || null,
      arrangementCredit: arrangementCredit.trim() || null,
      motifColor,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>クレジット情報</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">曲名</label>
            <Input
              value={songTitle}
              onChange={(e) => setSongTitle(e.target.value)}
              placeholder="曲名を入力"
              data-testid="input-song-title"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Lyrics</label>
            <Input
              value={lyricsCredit}
              onChange={(e) => setLyricsCredit(e.target.value)}
              placeholder="作詞者名"
              data-testid="input-lyrics-credit"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Music</label>
            <Input
              value={musicCredit}
              onChange={(e) => setMusicCredit(e.target.value)}
              placeholder="作曲者名"
              data-testid="input-music-credit"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Arrangement</label>
            <Input
              value={arrangementCredit}
              onChange={(e) => setArrangementCredit(e.target.value)}
              placeholder="編曲者名"
              data-testid="input-arrangement-credit"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">◢ モチーフ色</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={motifColor}
                onChange={(e) => setMotifColor(e.target.value)}
                className="w-8 h-8 rounded-md border cursor-pointer"
                data-testid="input-motif-color-dialog"
              />
              <span className="text-xs font-mono text-muted-foreground">{motifColor}</span>
            </div>
          </div>
          <Button
            className="w-full"
            onClick={handleSave}
            disabled={isPending}
            data-testid="button-save-metadata"
          >
            <Save className="w-4 h-4 mr-1.5" />
            {isPending ? "保存中..." : "保存"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
