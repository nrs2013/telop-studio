import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, Keyboard } from "lucide-react";

interface LyricsImportProps {
  projectId: string;
}

export function LyricsImport({ projectId }: LyricsImportProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [manualText, setManualText] = useState("");
  const [showManual, setShowManual] = useState(false);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/projects/${projectId}/lyrics/import`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "lyrics"] });
      toast({ title: `${data.count}行の歌詞を読み込みました` });
    },
    onError: (err: Error) => {
      toast({ title: "読み込みエラー", description: err.message, variant: "destructive" });
    },
  });

  const manualMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await fetch(`/api/projects/${projectId}/lyrics/import-text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "lyrics"] });
      toast({ title: `${data.count}行の歌詞を読み込みました` });
      setManualText("");
      setShowManual(false);
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate(file);
    e.target.value = "";
  };

  return (
    <Card className="p-4">
      <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
        <FileText className="w-4 h-4 text-primary" />
        歌詞を読み込み
      </h3>

      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,.xlsx,.xls,.pdf,.txt"
        className="hidden"
        onChange={handleFileSelect}
        data-testid="input-lyrics-file"
      />

      <div className="space-y-2">
        <Button
          variant="outline"
          className="w-full justify-start"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadMutation.isPending}
          data-testid="button-import-file"
        >
          <Upload className="w-4 h-4 mr-2" />
          {uploadMutation.isPending ? "読み込み中..." : "ファイルから読み込み"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Word (.docx)、Excel (.xlsx)、PDF、テキスト (.txt) に対応
        </p>

        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={() => setShowManual(!showManual)}
          data-testid="button-manual-input"
        >
          <Keyboard className="w-4 h-4 mr-2" />
          テキストを直接入力
        </Button>

        {showManual && (
          <div className="space-y-2">
            <Textarea
              placeholder="歌詞を1行ずつ入力してください..."
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              rows={8}
              className="text-sm"
              data-testid="textarea-manual-lyrics"
            />
            <Button
              size="sm"
              onClick={() => {
                if (manualText.trim()) manualMutation.mutate(manualText.trim());
              }}
              disabled={!manualText.trim() || manualMutation.isPending}
              data-testid="button-submit-manual"
            >
              読み込む
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
