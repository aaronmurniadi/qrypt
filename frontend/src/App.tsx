import type { DragEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import * as Backend from "../wailsjs/go/backend/App";
import { backend } from "../wailsjs/go/models";
import { OnFileDrop, OnFileDropOff } from "../wailsjs/runtime/runtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  Lock,
  Pencil,
  PlusCircle,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

function formatErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function isTextLike(mime: string) {
  return mime.startsWith("text/") || mime === "application/json";
}

function isImage(mime: string) {
  return mime.startsWith("image/");
}

function isVideo(mime: string) {
  return mime.startsWith("video/");
}

function basename(path: string) {
  const n = path.replace(/\\/g, "/");
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(i + 1) : n;
}

const QRYPT_DND = "application/x-qrypt-path";

function parentVaultPath(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

function vaultPathFromDrag(dt: DataTransfer): string | null {
  const v = (dt.getData(QRYPT_DND) || dt.getData("text/plain")).trim();
  return v || null;
}

function canAcceptVaultPathDrop(dt: DataTransfer): boolean {
  return dt.types.includes(QRYPT_DND) || dt.types.includes("text/plain");
}

type ChildRow =
  | { kind: "folder"; name: string; path: string }
  | { kind: "entry"; entry: backend.VaultFileEntry };

function listChildRows(folderPrefix: string, entries: backend.VaultFileEntry[]): ChildRow[] {
  const p = folderPrefix === "" ? "" : folderPrefix + "/";
  const map = new Map<string, backend.VaultFileEntry | "implicit">();

  for (const e of entries) {
    if (folderPrefix !== "" && !e.path.startsWith(p)) continue;
    if (e.path === folderPrefix) continue;
    const rel = folderPrefix === "" ? e.path : e.path.slice(p.length);
    if (!rel) continue;
    if (rel.indexOf("/") === -1) {
      map.set(rel, e);
    }
  }

  for (const e of entries) {
    if (folderPrefix !== "" && !e.path.startsWith(p)) continue;
    if (e.path === folderPrefix) continue;
    const rel = folderPrefix === "" ? e.path : e.path.slice(p.length);
    if (!rel) continue;
    const slash = rel.indexOf("/");
    if (slash !== -1) {
      const dirName = rel.slice(0, slash);
      if (!map.has(dirName)) {
        map.set(dirName, "implicit");
      }
    }
  }

  const rows: ChildRow[] = [];
  for (const name of [...map.keys()].sort((a, b) => a.localeCompare(b))) {
    const v = map.get(name)!;
    const fullPath = folderPrefix === "" ? name : `${folderPrefix}/${name}`;
    if (v === "implicit") {
      rows.push({ kind: "folder", name, path: fullPath });
    } else {
      rows.push({ kind: "entry", entry: v });
    }
  }
  return rows;
}

function PreviewEmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 min-h-0 flex flex-col rounded-lg ring-1 ring-border/60 relative overflow-hidden bg-muted/10">
      <div
        className="pointer-events-none absolute inset-0 bg-contain bg-center bg-no-repeat opacity-[0.14] dark:opacity-[0.09]"
        style={{ backgroundImage: "url(/qrypt.png)" }}
        aria-hidden
      />
      <div className="relative z-10 flex flex-1 min-h-0 flex-col items-center justify-center p-6 text-center">
        {children}
      </div>
    </div>
  );
}

function VaultVideoPreview({ src, className }: { src: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    return () => {
      const v = ref.current;
      if (!v) return;
      v.pause();
      v.removeAttribute("src");
      v.load();
    };
  }, []);
  return (
    <video
      ref={ref}
      src={src}
      controls
      className={
        className ??
        "max-h-[calc(100vh-8rem)] max-w-full rounded-md border bg-black"
      }
    />
  );
}

export default function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [files, setFiles] = useState<backend.VaultFileEntry[]>([]);
  const [selected, setSelected] = useState<backend.VaultFileEntry | null>(null);
  const [detectedMime, setDetectedMime] = useState<string>("");
  const [decryptSrc, setDecryptSrc] = useState("");
  const [banner, setBanner] = useState<string | null>(null);

  const [createPwdOpen, setCreatePwdOpen] = useState(false);
  const [openPwdOpen, setOpenPwdOpen] = useState(false);
  const [pendingPath, setPendingPath] = useState("");
  const [password, setPassword] = useState("");
  const [createVaultSubmitting, setCreateVaultSubmitting] = useState(false);

  const [textPreview, setTextPreview] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(false);

  const [folderPrefix, setFolderPrefix] = useState("");
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTargetPath, setRenameTargetPath] = useState<string | null>(null);
  const [renameFileName, setRenameFileName] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTargetPath, setDeleteTargetPath] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<backend.VaultFileEntry[]> => {
    const ok = await Backend.VaultUnlocked();
    setUnlocked(ok);
    if (!ok) {
      setFiles([]);
      setSelected(null);
      setFolderPrefix("");
      setDecryptSrc("");
      setTextPreview(null);
      return [];
    }
    try {
      const list = await Backend.ListVaultFiles();
      const rows = list ?? [];
      setFiles(rows);
      return rows;
    } catch {
      setFiles([]);
      return [];
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const folderPrefixRef = useRef(folderPrefix);
  useEffect(() => {
    folderPrefixRef.current = folderPrefix;
  }, [folderPrefix]);

  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!unlocked) {
      try {
        OnFileDropOff();
      } catch {
        /* wails runtime unavailable (e.g. plain browser) */
      }
      return;
    }
    OnFileDrop(async (_x, _y, paths: string[]) => {
      if (!paths?.length) return;
      setBanner(null);
      const folder = folderPrefixRef.current;
      const errs: string[] = [];
      for (const p of paths) {
        if (!p) continue;
        try {
          await Backend.AddFileFromPathToVault(p, folder);
        } catch (e) {
          errs.push(`${basename(p)}: ${formatErr(e)}`);
        }
      }
      await refreshRef.current();
      if (errs.length > 0) {
        const head = errs.slice(0, 5).join("\n");
        const more = errs.length > 5 ? `\n… and ${errs.length - 5} more` : "";
        setBanner(head + more);
      }
    }, false);
    return () => {
      try {
        OnFileDropOff();
      } catch {
        /* */
      }
    };
  }, [unlocked]);

  useEffect(() => {
    if (!unlocked || !selected || selected.isDir) {
      setDecryptSrc("");
      setDetectedMime("");
      return;
    }
    let cancelled = false;
    setDecryptSrc("");
    setDetectedMime("");
    Backend.DecryptURLForVaultPath(selected.path)
      .then((url) => {
        if (!cancelled) {
          setDecryptSrc(url);
          // Detect MIME type from actual content
          fetch(url, { method: 'HEAD' })
            .then(response => {
              if (!cancelled && response.ok) {
                const contentType = response.headers.get('Content-Type');
                if (contentType) {
                  setDetectedMime(contentType.split(';')[0]); // Remove charset if present
                }
              }
            })
            .catch(() => {
              // Fallback to stored MIME type
              if (!cancelled) setDetectedMime(selected.mime);
            });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDecryptSrc("");
          setDetectedMime("");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [unlocked, selected?.path, selected?.isDir, selected?.mime]);

  useEffect(() => {
    if (!selected || !decryptSrc || !unlocked) {
      setTextPreview(null);
      setTextLoading(false);
      return;
    }
    const mimeToCheck = detectedMime || selected.mime;
    if (!isTextLike(mimeToCheck)) {
      setTextPreview(null);
      setTextLoading(false);
      return;
    }
    const ac = new AbortController();
    const u = decryptSrc;
    setTextLoading(true);
    setTextPreview(null);
    fetch(u, { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((t) => {
        if (!ac.signal.aborted) setTextPreview(t);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!ac.signal.aborted) setTextPreview("Could not load text preview.");
      })
      .finally(() => {
        if (!ac.signal.aborted) setTextLoading(false);
      });

    return () => {
      ac.abort();
      setTextPreview(null);
      setTextLoading(false);
    };
  }, [selected, decryptSrc, unlocked, detectedMime]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (createPwdOpen || openPwdOpen || renameOpen || newFolderOpen || deleteOpen) return;
      setSelected(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createPwdOpen, openPwdOpen, renameOpen, newFolderOpen, deleteOpen]);

  async function onCreateNew() {
    setBanner(null);
    try {
      const path = await Backend.PickNewVaultPath();
      if (!path) return;
      setPendingPath(path);
      setPassword("");
      setCreatePwdOpen(true);
    } catch (e) {
      setBanner(formatErr(e));
    }
  }

  async function onOpenExisting() {
    setBanner(null);
    try {
      const path = await Backend.PickExistingVaultPath();
      if (!path) return;
      setPendingPath(path);
      setPassword("");
      setOpenPwdOpen(true);
    } catch (e) {
      setBanner(formatErr(e));
    }
  }

  async function submitCreateVault() {
    if (createVaultSubmitting) return;
    setBanner(null);
    setCreateVaultSubmitting(true);
    try {
      await Backend.FinalizeNewVault(pendingPath, password);
      setCreatePwdOpen(false);
      setPassword("");
      setPendingPath("");
      setFolderPrefix("");
      await refresh();
    } catch (e) {
      setBanner(formatErr(e));
    } finally {
      setCreateVaultSubmitting(false);
    }
  }

  async function submitOpenVault() {
    setBanner(null);
    try {
      await Backend.UnlockVaultAtPath(pendingPath, password);
      setOpenPwdOpen(false);
      setPassword("");
      setPendingPath("");
      setFolderPrefix("");
      await refresh();
    } catch (e) {
      setBanner(formatErr(e));
    }
  }

  async function onLock() {
    setBanner(null);
    await Backend.LockVault();
    await refresh();
  }

  async function onAddFile() {
    setBanner(null);
    try {
      await Backend.AddFileToVault(folderPrefix);
      await refresh();
    } catch (e) {
      const msg = formatErr(e);
      if (msg !== "cancelled") setBanner(msg);
    }
  }

  async function submitNewFolder() {
    setBanner(null);
    const name = newFolderName.trim();
    if (!name || name.includes("/") || name.includes("\\")) {
      setBanner("Enter a single folder name without slashes.");
      return;
    }
    const full = folderPrefix === "" ? name : `${folderPrefix}/${name}`;
    try {
      await Backend.CreateVaultFolder(full);
      setNewFolderOpen(false);
      setNewFolderName("");
      await refresh();
    } catch (e) {
      setBanner(formatErr(e));
    }
  }

  async function submitRenameFile() {
    setBanner(null);
    if (!renameTargetPath) return;
    const name = renameFileName.trim();
    if (!name || name.includes("/") || name.includes("\\")) {
      setBanner("Enter a single file name without slashes.");
      return;
    }
    const newPath =
      renameTargetPath.lastIndexOf("/") >= 0
        ? `${renameTargetPath.slice(0, renameTargetPath.lastIndexOf("/"))}/${name}`
        : name;
    try {
      await Backend.RenameVaultFile(renameTargetPath, name);
      setRenameOpen(false);
      setRenameTargetPath(null);
      const rows = await refresh();
      setSelected(rows.find((e) => e.path === newPath) ?? null);
    } catch (e) {
      setBanner(formatErr(e));
    }
  }

  async function confirmDeleteFile() {
    setBanner(null);
    if (!deleteTargetPath) return;
    try {
      await Backend.DeleteVaultPath(deleteTargetPath);
      setDeleteOpen(false);
      if (selected?.path === deleteTargetPath) setSelected(null);
      setDeleteTargetPath(null);
      await refresh();
    } catch (e) {
      setBanner(formatErr(e));
    }
  }

  const moveVaultFileToFolder = useCallback(
    async (srcPath: string, destFolder: string) => {
      setBanner(null);
      const rec = files.find((f) => f.path === srcPath);
      if (!rec || rec.isDir) return;
      if (parentVaultPath(srcPath) === destFolder) return;
      const base = basename(srcPath);
      const newPath = destFolder === "" ? base : `${destFolder}/${base}`;
      try {
        await Backend.MoveVaultEntry(srcPath, destFolder);
        const rows = await refresh();
        setSelected((prev) => {
          if (prev?.path !== srcPath) return prev;
          return rows.find((r) => r.path === newPath) ?? null;
        });
      } catch (e) {
        setBanner(formatErr(e));
      }
    },
    [files, refresh],
  );

  const bindFolderDrop = useCallback(
    (dropId: string, destFolder: string) => ({
      onDragOver: (e: DragEvent) => {
        if (!canAcceptVaultPathDrop(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOverTarget(dropId);
      },
      onDragLeave: (e: DragEvent) => {
        const rel = e.relatedTarget;
        if (rel instanceof Node && e.currentTarget.contains(rel)) return;
        setDragOverTarget((cur) => (cur === dropId ? null : cur));
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        setDragOverTarget(null);
        const src = vaultPathFromDrag(e.dataTransfer);
        if (!src) return;
        void moveVaultFileToFolder(src, destFolder);
      },
    }),
    [moveVaultFileToFolder],
  );

  const childRows = unlocked ? listChildRows(folderPrefix, files) : [];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b px-4 py-3 flex flex-wrap items-center gap-2">
        <button
          className="text-lg font-semibold tracking-tight hover:opacity-80 transition-opacity flex items-center gap-2"
          onClick={() => setAboutOpen(true)}
        >
          <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm outline outline-1 outline-border">
            i
          </div>
        </button>
        <Button type="button" variant="outline" size="sm" onClick={() => void onCreateNew()}>
          <PlusCircle className="size-4" aria-hidden />
          Create vault
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => void onOpenExisting()}>
          <FolderOpen className="size-4" aria-hidden />
          Open vault
        </Button>
        {unlocked ? (
          <>
            <Button type="button" size="sm" onClick={() => void onAddFile()}>
              <FilePlus className="size-4" aria-hidden />
              Add file here
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setNewFolderName("");
                setNewFolderOpen(true);
              }}
            >
              <FolderPlus className="size-4" />
              New folder
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => void onLock()}
            >
              <Lock className="size-4" aria-hidden />
              Lock vault
            </Button>
            <span className="text-sm text-muted-foreground ml-auto">Unlocked</span>
          </>
        ) : (
          <span className="text-sm text-muted-foreground ml-auto">Locked</span>
        )}
      </header>

      {unlocked ? (
        <div className="border-b bg-muted/30 px-4 py-2 flex items-center gap-3 min-h-11">
          <span className="text-xs font-medium text-muted-foreground whitespace-nowrap shrink-0">
            Selected URL
          </span>
          <Input
            readOnly
            aria-label="Decrypt URL for the selected vault file"
            className="font-mono text-xs h-8 flex-1 min-w-0"
            value={decryptSrc}
            placeholder="http://127.0.0.1:PORT/decrypt?token=…"
            title={decryptSrc || undefined}
          />
        </div>
      ) : null}

      {banner ? (
        <div className="mx-4 mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {banner}
        </div>
      ) : null}

      <div className="flex flex-1 min-h-0">
        <aside className="w-64 shrink-0 border-r flex flex-col min-h-0">
          <div className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide border-b">
            Vault
          </div>
          <div className="px-2 py-2 flex flex-wrap items-center gap-1 text-xs border-b bg-muted/20">
            <button
              type="button"
              {...bindFolderDrop("drop-root", "")}
              className={cn(
                "rounded px-1.5 py-0.5 hover:bg-accent text-muted-foreground hover:text-foreground",
                dragOverTarget === "drop-root" &&
                "ring-2 ring-primary ring-offset-2 ring-offset-background",
              )}
              onClick={() => {
                setFolderPrefix("");
                setSelected(null);
              }}
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
                      dragOverTarget === crumbId &&
                      "ring-2 ring-primary ring-offset-2 ring-offset-background",
                    )}
                    title={prefixUpTo}
                    onClick={() => {
                      setFolderPrefix(prefixUpTo);
                      setSelected(null);
                    }}
                  >
                    {seg}
                  </button>
                </span>
              );
            })}
          </div>
          <ul className="flex-1 overflow-auto px-1 pb-2 min-h-0">
            {files.length === 0 ? (
              <li className="px-2 py-3 text-sm text-muted-foreground">No files yet</li>
            ) : childRows.length === 0 ? (
              <li className="px-2 py-3 text-sm text-muted-foreground">Empty folder</li>
            ) : (
              childRows.map((row) =>
                row.kind === "folder" ? (
                  <li key={`dir:${row.path}`}>
                    <button
                      type="button"
                      {...bindFolderDrop(`drop-folder:${row.path}`, row.path)}
                      onClick={() => {
                        setFolderPrefix(row.path);
                        setSelected(null);
                      }}
                      className={cn(
                        "w-full text-left rounded-md px-2 py-1.5 text-sm truncate hover:bg-accent flex items-center gap-2",
                        dragOverTarget === `drop-folder:${row.path}` &&
                        "ring-2 ring-inset ring-primary",
                      )}
                    >
                      <Folder className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{row.name}</span>
                    </button>
                  </li>
                ) : row.entry.isDir ? (
                  <li key={`e:${row.entry.path}`}>
                    <button
                      type="button"
                      {...bindFolderDrop(`drop-folder:${row.entry.path}`, row.entry.path)}
                      onClick={() => {
                        setFolderPrefix(row.entry.path);
                        setSelected(null);
                      }}
                      className={cn(
                        "w-full text-left rounded-md px-2 py-1.5 text-sm truncate hover:bg-accent flex items-center gap-2",
                        dragOverTarget === `drop-folder:${row.entry.path}` &&
                        "ring-2 ring-inset ring-primary",
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
                    onDragEnd={() => setDragOverTarget(null)}
                  >
                    <button
                      type="button"
                      onClick={() => setSelected(row.entry)}
                      className={cn(
                        "w-full text-left rounded-md px-2 py-1.5 text-sm truncate hover:bg-accent cursor-grab active:cursor-grabbing",
                        selected?.path === row.entry.path ? "bg-accent" : "",
                      )}
                    >
                      {basename(row.entry.path)}
                    </button>
                  </li>
                )
              )
            )}
          </ul>
        </aside>

        <main className="flex-1 min-w-0 min-h-0 flex flex-col p-4">
          {!selected ? (
            <PreviewEmptyState>
              <p className="text-sm text-muted-foreground max-w-md">
                Select a file to preview decrypted content. Decrypted bytes stay in memory only and are
                streamed from the local decrypt server. Press Escape or click the empty area around a
                preview to clear it.
              </p>
            </PreviewEmptyState>
          ) : selected.isDir ? (
            <PreviewEmptyState>
              <p className="text-sm text-muted-foreground max-w-md">
                <span className="font-medium text-foreground">{selected.path}</span> is a folder. Open it
                from the sidebar to browse.
              </p>
            </PreviewEmptyState>
          ) : (
            <div
              className="flex-1 min-h-0 overflow-auto rounded-lg bg-muted/15 p-3 ring-1 ring-border/60"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setSelected(null);
              }}
            >
              <div className="max-w-full" onMouseDown={(e) => e.stopPropagation()}>
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setRenameTargetPath(selected.path);
                      setRenameFileName(basename(selected.path));
                      setRenameOpen(true);
                    }}
                  >
                    <Pencil className="size-4" aria-hidden />
                    Rename
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      setDeleteTargetPath(selected.path);
                      setDeleteOpen(true);
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden />
                    Delete
                  </Button>
                </div>
                {isImage(detectedMime || selected.mime) ? (
                  <img
                    key={selected.path}
                    src={decryptSrc}
                    alt={basename(selected.path)}
                    className="max-h-[calc(100vh-8rem)] max-w-full rounded-md border object-contain"
                  />
                ) : isVideo(detectedMime || selected.mime) ? (
                  <VaultVideoPreview key={selected.path} src={decryptSrc} />
                ) : isTextLike(detectedMime || selected.mime) ? (
                  <div className="rounded-md border bg-muted/30 p-3 font-mono text-sm whitespace-pre-wrap break-words max-w-full">
                    {textLoading ? "Loading…" : (textPreview ?? "")}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground space-y-2">
                    <p>No built-in preview for this type ({selected.mime}).</p>
                    <p className="font-mono text-xs break-all">{decryptSrc}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      <Dialog
        open={createPwdOpen}
        onOpenChange={(open: boolean) => {
          if (!open && createVaultSubmitting) return;
          setCreatePwdOpen(open);
          if (!open) setCreateVaultSubmitting(false);
        }}
      >
        <DialogContent
          showClose={!createVaultSubmitting}
          onPointerDownOutside={(ev: { preventDefault: () => void }) => {
            if (createVaultSubmitting) ev.preventDefault();
          }}
          onEscapeKeyDown={(ev) => {
            if (createVaultSubmitting) ev.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>New vault password</DialogTitle>
            <DialogDescription>
              Argon2id derives a key for your vault. Choose a strong password. Path:{" "}
              <span className="font-mono text-xs break-all">{pendingPath}</span>
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            autoComplete="new-password"
            placeholder="Password"
            value={password}
            disabled={createVaultSubmitting}
            onChange={(ev) => setPassword(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" && !createVaultSubmitting) void submitCreateVault();
            }}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={createVaultSubmitting}
              onClick={() => setCreatePwdOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={createVaultSubmitting}
              aria-busy={createVaultSubmitting}
              onClick={() => void submitCreateVault()}
            >
              {createVaultSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Creating…
                </>
              ) : (
                "Create vault"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open: boolean) => {
          setDeleteOpen(open);
          if (!open) setDeleteTargetPath(null);
        }}
      >
        <DialogContent showClose>
          <DialogHeader>
            <DialogTitle>Delete file</DialogTitle>
            <DialogDescription>
              This removes the file from the vault and reclaims space. This cannot be undone. Path:{" "}
              <span className="font-mono text-xs break-all">{deleteTargetPath ?? "—"}</span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeleteOpen(false);
                setDeleteTargetPath(null);
              }}
            >
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void confirmDeleteFile()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameOpen}
        onOpenChange={(open: boolean) => {
          setRenameOpen(open);
          if (!open) setRenameTargetPath(null);
        }}
      >
        <DialogContent showClose>
          <DialogHeader>
            <DialogTitle>Rename file</DialogTitle>
            <DialogDescription>
              New name in the same folder only (no slashes). Full path:{" "}
              <span className="font-mono text-xs break-all">{renameTargetPath ?? "—"}</span>
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameFileName}
            placeholder="File name"
            onChange={(ev) => setRenameFileName(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") void submitRenameFile();
            }}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setRenameOpen(false);
                setRenameTargetPath(null);
              }}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void submitRenameFile()}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent showClose>
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>
              Create an empty folder under{" "}
              <span className="font-mono text-xs break-all">
                {folderPrefix === "" ? "vault root" : folderPrefix}
              </span>
              . Use letters, numbers, spaces, or dashes (no slashes).
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newFolderName}
            placeholder="Folder name"
            onChange={(ev) => setNewFolderName(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") void submitNewFolder();
            }}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setNewFolderOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void submitNewFolder()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openPwdOpen} onOpenChange={setOpenPwdOpen}>
        <DialogContent showClose>
          <DialogHeader>
            <DialogTitle>Unlock vault</DialogTitle>
            <DialogDescription>
              Enter the password for{" "}
              <span className="font-mono text-xs break-all">{pendingPath}</span>
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") void submitOpenVault();
            }}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpenPwdOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void submitOpenVault()}>
              Unlock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
        <DialogContent showClose>
          <DialogHeader>
            <DialogTitle>About QrypT</DialogTitle>
            <DialogDescription>
              Secure file vault application for your sensitive data
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="text-sm space-y-2">
              <div><strong>Version:</strong> 0.1.0 (Alpha)</div>
              <div><strong>Author:</strong> Aaron P. Murniadi</div>
              <div><strong>License:</strong> GPLv3</div>
              <div><strong>Technologies:</strong> Go, React, Wails, Tailwind CSS</div>
            </div>
            <div className="border-t pt-4">
              <h4 className="font-semibold mb-2">Future Contributors</h4>
              <p className="text-sm text-muted-foreground">
                Space reserved for contributors who help improve QrypT.
                Whether fixing bugs, adding features, improving documentation,
                or enhancing security - your contributions are welcome!
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setAboutOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
