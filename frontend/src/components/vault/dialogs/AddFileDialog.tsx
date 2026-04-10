import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Download, FilePlus } from "lucide-react";
import { useState } from "react";

type AddFileDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderPrefix: string;
  onSelectFile: () => void;
  onDownloadUrl: (url: string) => Promise<void>;
};

export function AddFileDialog({
  open,
  onOpenChange,
  folderPrefix,
  onSelectFile,
  onDownloadUrl,
}: AddFileDialogProps) {
  const [url, setUrl] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  function handleSelectFile() {
    onOpenChange(false);
    onSelectFile();
  }

  async function handleDownload() {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;

    setDownloading(true);
    setError("");

    try {
      await onDownloadUrl(trimmedUrl);
      setUrl("");
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      setUrl("");
      setError("");
      setDownloading(false);
    }
    onOpenChange(open);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showClose>
        <DialogHeader>
          <DialogTitle>Add file to vault</DialogTitle>
          <DialogDescription>
            Adding to <span className="font-mono text-xs break-all">{folderPrefix === "" ? "vault root" : folderPrefix}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4">
          <div className="flex gap-2">
            <Input
              placeholder="https://example.com/file.png"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleDownload();
              }}
              disabled={downloading}
            />
            <Button
              onClick={() => void handleDownload()}
              disabled={downloading || !url.trim()}
            >
              <Download className="size-4 mr-2" />
              {downloading ? "Downloading..." : "Download"}
            </Button>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <div className="flex items-center gap-4">
            <div className="flex-1 h-px bg-border"></div>
            <span className="text-xs text-muted-foreground uppercase font-medium tracking-wider">Or</span>
            <div className="flex-1 h-px bg-border"></div>
          </div>

          <Button variant="outline" onClick={handleSelectFile} className="w-full">
            <FilePlus className="size-4 mr-2" />
            Select Files
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
