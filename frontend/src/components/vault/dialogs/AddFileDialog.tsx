import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useState } from "react";
import { UploadCloud, Link as LinkIcon, FilePlus } from "lucide-react";

type AddFileDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderPrefix: string;
  onSelectFile: () => void;
  onAddUrl: (url: string) => Promise<void>;
};

export function AddFileDialog({
  open,
  onOpenChange,
  folderPrefix,
  onSelectFile,
  onAddUrl,
}: AddFileDialogProps) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleAddUrl() {
    if (!url.trim()) return;
    setLoading(true);
    try {
      await onAddUrl(url.trim());
      setUrl("");
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showClose>
        <DialogHeader>
          <DialogTitle>Add file to vault</DialogTitle>
          <DialogDescription>
            Adding to <span className="font-mono text-xs break-all">{folderPrefix === "" ? "vault root" : folderPrefix}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6 py-4">
          <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-lg border-muted-foreground/25 bg-muted/10 text-center">
            <UploadCloud className="size-10 text-muted-foreground mb-4" />
            <h3 className="font-medium mb-1">Drag and drop files here</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Or use the file picker to select a file from your computer
            </p>
            <Button onClick={() => {
              onOpenChange(false);
              onSelectFile();
            }}>
              <FilePlus className="size-4 mr-2" />
              Select File
            </Button>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex-1 h-px bg-border"></div>
            <span className="text-xs text-muted-foreground uppercase font-medium tracking-wider">Or</span>
            <div className="flex-1 h-px bg-border"></div>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="font-medium text-sm">Add from URL</h3>
            <div className="flex gap-2">
              <Input
                placeholder="https://example.com/image.png"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleAddUrl();
                }}
                disabled={loading}
              />
              <Button onClick={() => void handleAddUrl()} disabled={loading || !url.trim()}>
                <LinkIcon className="size-4 mr-2" />
                {loading ? "Adding..." : "Add URL"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
