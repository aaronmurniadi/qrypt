import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { basename, isImage, isTextLike, isVideo } from "@/lib/vault-utils";
import { backend } from "../../../wailsjs/go/models";
import { Check, Link, Loader2, Pencil, Trash2 } from "lucide-react";
import { PreviewEmptyState } from "./PreviewEmptyState";
import { VaultVideoPreview } from "./VaultVideoPreview";

type CopyLinkState = "idle" | "copying" | "copied";

type FilePreviewPanelProps = {
  selected: backend.VaultFileEntry | null;
  detectedMime: string;
  previewSrc: string;
  textPreview: string | null;
  isMediaLoading: boolean;
  copyLinkState: CopyLinkState;
  onClearSelection: () => void;
  onRename: (path: string, currentName: string) => void;
  onDelete: (path: string) => void;
  onCopyLink: () => void;
  onMediaLoaded: () => void;
};

export function FilePreviewPanel({
  selected,
  detectedMime,
  previewSrc,
  textPreview,
  isMediaLoading,
  copyLinkState,
  onClearSelection,
  onRename,
  onDelete,
  onCopyLink,
  onMediaLoaded,
}: FilePreviewPanelProps) {
  if (!selected) {
    return (
      <main className="flex-1 min-w-0 min-h-0 flex flex-col p-4">
        <PreviewEmptyState>
          <p className="text-sm text-muted-foreground max-w-md">
            Select a file to preview decrypted content. Decrypted bytes stay in memory only and are streamed from the
            local decrypt server. Press Escape or click the empty area around a preview to clear it.
          </p>
        </PreviewEmptyState>
      </main>
    );
  }

  if (selected.isDir) {
    return (
      <main className="flex-1 min-w-0 min-h-0 flex flex-col p-4">
        <PreviewEmptyState>
          <p className="text-sm text-muted-foreground max-w-md">
            <span className="font-medium text-foreground">{selected.path}</span> is a folder. Open it from the sidebar to
            browse.
          </p>
        </PreviewEmptyState>
      </main>
    );
  }

  const mime = detectedMime || selected.mime;

  return (
    <main className="flex-1 min-w-0 min-h-0 flex flex-col p-4">
      <div
        className="flex-1 min-h-0 overflow-auto rounded-lg bg-muted/15 p-3 ring-1 ring-border/60"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClearSelection();
        }}
      >
        <div className="max-w-full" onMouseDown={(e) => e.stopPropagation()}>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onRename(selected.path, basename(selected.path))}
            >
              <Pencil className="size-4" aria-hidden />
              Rename
            </Button>
            <Button type="button" size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => onDelete(selected.path)}>
              <Trash2 className="size-4" aria-hidden />
              Delete
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={copyLinkState === "copying"}
              onClick={() => void onCopyLink()}
              title="Copy a one-time download link for the decrypted file"
            >
              {copyLinkState === "copied" ? (
                <Check className="size-4 text-green-500" aria-hidden />
              ) : copyLinkState === "copying" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Link className="size-4" aria-hidden />
              )}
              {copyLinkState === "copied" ? "Copied!" : "Copy link"}
            </Button>
          </div>
          <div className="relative w-full overflow-hidden min-h-[50vh]">
            {isMediaLoading && (
              <div className="absolute inset-0 z-20 flex items-center justify-center">
                <Loader2 className="size-8 animate-spin text-muted-foreground" />
              </div>
            )}
            <div
              className={cn(
                "transition-opacity duration-300 w-full",
                isMediaLoading ? "opacity-0 absolute inset-0 pointer-events-none" : "opacity-100 relative",
              )}
            >
              {isImage(mime) ? (
                <img
                  key={selected.path}
                  src={previewSrc}
                  alt={basename(selected.path)}
                  className="max-h-[calc(100vh-8rem)] max-w-full rounded-md border object-contain inline-block"
                  onLoad={onMediaLoaded}
                  onError={onMediaLoaded}
                />
              ) : isVideo(mime) ? (
                <VaultVideoPreview
                  key={selected.path}
                  src={previewSrc}
                  onLoadedData={onMediaLoaded}
                  onError={onMediaLoaded}
                />
              ) : isTextLike(mime) ? (
                <div className="rounded-md border bg-muted/30 p-3 font-mono text-sm whitespace-pre-wrap break-words max-w-full">
                  {textPreview ?? ""}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground space-y-2">
                  <p>No built-in preview for this type ({selected.mime}).</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
