import type { DragEvent } from "react";
import { Folder } from "lucide-react";
import { cn } from "@/lib/utils";
import { backend } from "../../../wailsjs/go/models";
import { basename, QRYPT_DND, type ChildRow } from "@/lib/vault-utils";

export type FolderDropHandlers = {
  onDragOver: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
};

type VaultSidebarProps = {
  isMediaLoading: boolean;
  folderPrefix: string;
  files: backend.VaultFileEntry[];
  childRows: ChildRow[];
  selected: backend.VaultFileEntry | null;
  dragOverTarget: string | null;
  bindFolderDrop: (dropId: string, destFolder: string) => FolderDropHandlers;
  onNavigateFolder: (prefix: string) => void;
  onSelectFile: (entry: backend.VaultFileEntry) => void;
  onClearDragOver: () => void;
};

export function VaultSidebar({
  isMediaLoading,
  folderPrefix,
  files,
  childRows,
  selected,
  dragOverTarget,
  bindFolderDrop,
  onNavigateFolder,
  onSelectFile,
  onClearDragOver,
}: VaultSidebarProps) {
  return (
    <aside
      className={cn("w-64 shrink-0 border-r flex flex-col min-h-0", isMediaLoading && "pointer-events-none opacity-60")}
    >
      <div className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide border-b">Vault</div>
      <div className="px-2 py-2 flex flex-wrap items-center gap-1 text-xs border-b bg-muted/20">
        <button
          type="button"
          {...bindFolderDrop("drop-root", "")}
          className={cn(
            "rounded px-1.5 py-0.5 hover:bg-accent text-muted-foreground hover:text-foreground",
            dragOverTarget === "drop-root" && "ring-2 ring-primary ring-offset-2 ring-offset-background",
          )}
          onClick={() => onNavigateFolder("")}
        >
          Root
        </button>
        {folderPrefix.split("/").filter(Boolean).map((seg, i, arr) => {
          const prefixUpTo = arr.slice(0, i + 1).join("/");
          const crumbId = `drop-crumb:${prefixUpTo}`;
          return (
            <span key={prefixUpTo} className="flex items-center gap-1 text-muted-foreground">
              <span>/</span>
              <button
                type="button"
                {...bindFolderDrop(crumbId, prefixUpTo)}
                className={cn(
                  "rounded px-1 py-0.5 hover:bg-accent hover:text-foreground max-w-[7rem] truncate",
                  dragOverTarget === crumbId && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                )}
                title={prefixUpTo}
                onClick={() => onNavigateFolder(prefixUpTo)}
              >
                {seg}
              </button>
            </span>
          );
        })}
      </div>
      <ul className="flex-1 overflow-auto px-1 pb-2 min-h-0 py-1">
        {files.length === 0 ? (
          <li className="px-2 py-3 text-sm text-muted-foreground">No files yet</li>
        ) : childRows.length === 0 ? (
          <li className="px-2 py-3 text-sm text-muted-foreground">Empty folder</li>
        ) : (
          childRows.map((row) =>
            row.kind === "folder" ? (
              <li key={`dir:${row.path}`} className="py-1">
                <button
                  type="button"
                  {...bindFolderDrop(`drop-folder:${row.path}`, row.path)}
                  onClick={() => onNavigateFolder(row.path)}
                  className={cn(
                    "w-full text-left rounded-md px-2 py-1 text-sm truncate hover:bg-accent flex items-center gap-2",
                    dragOverTarget === `drop-folder:${row.path}` && "ring-2 ring-inset ring-primary",
                  )}
                >
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{row.name}</span>
                </button>
              </li>
            ) : row.entry.isDir ? (
              <li key={`e:${row.entry.path}`} className="py-1">
                <button
                  type="button"
                  {...bindFolderDrop(`drop-folder:${row.entry.path}`, row.entry.path)}
                  onClick={() => onNavigateFolder(row.entry.path)}
                  className={cn(
                    "w-full text-left rounded-md px-2 py-1 text-sm truncate hover:bg-accent flex items-center gap-2",
                    dragOverTarget === `drop-folder:${row.entry.path}` && "ring-2 ring-inset ring-primary",
                  )}
                >
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{basename(row.entry.path)}</span>
                </button>
              </li>
            ) : (
              <li
                key={`f:${row.entry.path}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(QRYPT_DND, row.entry.path);
                  e.dataTransfer.setData("text/plain", row.entry.path);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={onClearDragOver}
                className="py-1"
              >
                <button
                  type="button"
                  onClick={() => onSelectFile(row.entry)}
                  className={cn(
                    "w-full text-left rounded-md px-2 py-1 text-sm truncate hover:bg-accent cursor-grab active:cursor-grabbing",
                    selected?.path === row.entry.path ? "bg-accent" : "",
                  )}
                >
                  {basename(row.entry.path)}
                </button>
              </li>
            ),
          )
        )}
      </ul>
    </aside>
  );
}
