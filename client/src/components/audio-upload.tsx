import { useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Music, Upload } from "lucide-react";

interface AudioUploadProps {
  projectId: string;
  onUploaded: () => void;
}

export function AudioUpload({ projectId, onUploaded }: AudioUploadProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("audio", file);
      const res = await fetch(`/api/projects/${projectId}/audio`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      onUploaded();
      toast({ title: "音楽ファイルをアップロードしました" });
    },
    onError: (err: Error) => {
      toast({ title: "アップロードエラー", description: err.message, variant: "destructive" });
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
        <Music className="w-4 h-4 text-primary" />
        音楽ファイル
      </h3>

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={handleFileSelect}
        data-testid="input-audio-file"
      />

      <Button
        variant="outline"
        className="w-full justify-start"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploadMutation.isPending}
        data-testid="button-upload-audio"
      >
        <Upload className="w-4 h-4 mr-2" />
        {uploadMutation.isPending ? "アップロード中..." : "音楽ファイルをアップロード"}
      </Button>
      <p className="text-xs text-muted-foreground mt-2">
        MP3、WAV、AAC、OGG などに対応
      </p>
    </Card>
  );
}
