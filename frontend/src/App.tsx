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
import { AddFileDialog } from "@/components/vault/dialogs/AddFileDialog";
import { CreateVaultDialog } from "@/components/vault/dialogs/CreateVaultDialog";
import {
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Check,
  Link,
  Loader2,
  Lock,
  Pencil,
  PlusCircle,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";

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
      <div className="flex flex-1 min-h-0 flex-col items-center justify-center p-6 text-center">
        {children}
      </div>
    </div>
  );
}

function VaultVideoPreview({ 
  src, 
  className,
  onLoadedData,
  onError,
}: { 
  src: string; 
  className?: string;
  onLoadedData?: () => void;
  onError?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (v && v.readyState >= 2 && onLoadedData) {
      onLoadedData();
    }
    return () => {
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
      autoPlay
      onLoadedData={onLoadedData}
      onError={onError}
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
  // previewSrc holds a data: URI (images), blob: URL (video), or empty string.
  const [previewSrc, setPreviewSrc] = useState("");
  const [textPreview, setTextPreview] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [createPwdOpen, setCreatePwdOpen] = useState(false);
  const [openPwdOpen, setOpenPwdOpen] = useState(false);
  const [pendingPath, setPendingPath] = useState("");
  const [password, setPassword] = useState("");
  const [algorithm, setAlgorithm] = useState("aes");
  const [createVaultSubmitting, setCreateVaultSubmitting] = useState(false);

  const [isMediaLoading, setIsMediaLoading] = useState(false);

  const [folderPrefix, setFolderPrefix] = useState("");
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [addFileOpen, setAddFileOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTargetPath, setRenameTargetPath] = useState<string | null>(null);
  const [renameFileName, setRenameFileName] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTargetPath, setDeleteTargetPath] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">("light");
  const [copyLinkState, setCopyLinkState] = useState<"idle" | "copying" | "copied">("idle");

  const refresh = useCallback(async (): Promise<backend.VaultFileEntry[]> => {
    logger.debug("Checking vault lock status...");
    const ok = await Backend.VaultUnlocked();
    setUnlocked(ok);
    if (!ok) {
      setFiles([]);
      setSelected(null);
      setFolderPrefix("");
      setPreviewSrc("");
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

  // Detect and apply system theme
  useEffect(() => {
    const detectTheme = async () => {
      try {
        const theme = await Backend.GetSystemTheme();
        setSystemTheme(theme as "light" | "dark");
      } catch {
        // Fallback to browser preference if backend detection fails
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        setSystemTheme(prefersDark ? "dark" : "light");
      }
    };

    detectTheme();

    // Listen for system theme changes
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      setSystemTheme(mediaQuery.matches ? "dark" : "light");
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(systemTheme);
  }, [systemTheme]);

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
      logger.info(`Drop event received with ${paths.length} items`);
      setBanner(null);
      const folder = folderPrefixRef.current;
      const errs: string[] = [];
      for (const p of paths) {
        if (!p) continue;
        try {
          await Backend.AddFileFromPathToVault(p, folder);
          logger.debug(`Dropped item imported: ${p}`);
        } catch (e) {
          logger.error(`Failed to import dropped item ${p}: ${formatErr(e)}`);
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

  // Decrypt selected file via IPC (no HTTP round-trip).
  useEffect(() => {
    if (!unlocked || !selected || selected.isDir) {
      setPreviewSrc("");
      setTextPreview(null);
      setDetectedMime("");
      setIsMediaLoading(false);
      return;
    }

    let cancelled = false;
    let blobUrl = "";
    setPreviewSrc("");
    setTextPreview(null);
    setDetectedMime("");
    setIsMediaLoading(true);

    logger.debug(`Decrypting in-memory: ${selected.path}`);
    Backend.GetDecryptedFileBase64(selected.path)
      .then(({ data, mime }) => {
        if (cancelled) return;
        logger.info(`Decrypted: ${selected.path} (${mime})`);
        setDetectedMime(mime ? mime.split(";")[0].trim() : "");
        const effectiveMime = (mime || selected.mime || "application/octet-stream").split(";")[0].trim();

        if (isTextLike(mime || selected.mime)) {
          // Decode base64 → UTF-8 string directly, no fetch needed.
          const text = decodeURIComponent(
            atob(data)
              .split("")
              .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
              .join("")
          );
          setTextPreview(text);
          setIsMediaLoading(false);
        } else if (isImage(effectiveMime)) {
          // data: URI is safe for images of any size in a desktop WebView.
          setPreviewSrc(`data:${effectiveMime};base64,${data}`);
          // isMediaLoading cleared by <img> onLoad/onError
        } else if (isVideo(effectiveMime)) {
          // Build a Blob URL so the <video> element can seek properly.
          const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
          const blob = new Blob([bytes], { type: effectiveMime });
          blobUrl = URL.createObjectURL(blob);
          setPreviewSrc(blobUrl);
          // isMediaLoading cleared by VaultVideoPreview onLoadedData/onError
        } else {
          setIsMediaLoading(false);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        logger.error(`Decrypt failed for ${selected.path}: ${formatErr(e)}`);
        setPreviewSrc("");
        setTextPreview(null);
        setDetectedMime("");
        setIsMediaLoading(false);
      });

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      setPreviewSrc("");
      setTextPreview(null);
      setIsMediaLoading(false);
    };
  }, [unlocked, selected?.path, selected?.isDir, selected?.mime]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (createPwdOpen || openPwdOpen || renameOpen || newFolderOpen || deleteOpen) return;
      setSelected(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createPwdOpen, openPwdOpen, renameOpen, newFolderOpen, deleteOpen]);

  async function copyDecryptLink() {
    if (!selected || copyLinkState !== "idle") return;
    setCopyLinkState("copying");
    try {
      const relPath = await Backend.DecryptURLForVaultPath(selected.path);
      // Wails WebView exposes wails://wails.localhost:PORT as the origin, but the
      // actual HTTP server is http://localhost:PORT — rewrite it so the link works
      // when opened in an external browser.
      const origin = window.location.origin
        .replace(/^wails:\/\/wails\.localhost/, "http://localhost");
      const full = origin + relPath;
      await navigator.clipboard.writeText(full);
      logger.info(`Copied decrypt link for: ${selected.path}`);
      setCopyLinkState("copied");
      setTimeout(() => setCopyLinkState("idle"), 2000);
    } catch (e) {
      logger.error(`Failed to copy decrypt link: ${formatErr(e)}`);
      setCopyLinkState("idle");
    }
  }

  async function onCreateNew() {
    logger.info("Initiating new vault creation flow");
    setBanner(null);
    try {
      const path = await Backend.PickNewVaultPath();
      if (!path) {
        logger.debug("User cancelled PickNewVaultPath");
        return;
      }
      logger.info(`Selected new vault path: ${path}`);
      setPendingPath(path);
      setPassword("");
      setCreatePwdOpen(true);
    } catch (e) {
      logger.error(`Failed to pick new vault path: ${formatErr(e)}`);
      setBanner(formatErr(e));
    }
  }

  async function onOpenExisting() {
    logger.info("Initiating open existing vault flow");
    setBanner(null);
    try {
      const path = await Backend.PickExistingVaultPath();
      if (!path) {
        logger.debug("User cancelled PickExistingVaultPath");
        return;
      }
      logger.info(`Selected existing vault path: ${path}`);
      setPendingPath(path);
      setPassword("");
      setOpenPwdOpen(true);
    } catch (e) {
      logger.error(`Failed to pick existing vault path: ${formatErr(e)}`);
      setBanner(formatErr(e));
    }
  }

  async function submitCreateVault() {
    if (createVaultSubmitting) return;
    logger.info(`Finalizing new vault creation: ${pendingPath} with ${algorithm}`);
    setBanner(null);
    setCreateVaultSubmitting(true);
    try {
      await Backend.FinalizeNewVault(pendingPath, password, algorithm);
      logger.info("Vault created successfully");
      setCreatePwdOpen(false);
      setPassword("");
      setPendingPath("");
      setAlgorithm("aes");
      setFolderPrefix("");
      await refresh();
    } catch (e) {
      logger.error(`Failed to create vault: ${formatErr(e)}`);
      setBanner(formatErr(e));
    } finally {
      setCreateVaultSubmitting(false);
    }
  }

  async function submitOpenVault() {
    logger.info(`Unlocking vault: ${pendingPath}`);
    setBanner(null);
    try {
      await Backend.UnlockVaultAtPath(pendingPath, password);
      logger.info("Vault unlocked successfully");
      setOpenPwdOpen(false);
      setPassword("");
      setPendingPath("");
      setFolderPrefix("");
      await refresh();
    } catch (e) {
      logger.error(`Failed to unlock vault: ${formatErr(e)}`);
      setBanner(formatErr(e));
    }
  }

  async function onLock() {
    logger.info("Locking the current vault");
    setBanner(null);
    await Backend.LockVault();
    await refresh();
  }

  async function onAddFile() {
    logger.info(`Adding file to folder: ${folderPrefix || "root"}`);
    setBanner(null);
    try {
      await Backend.AddFileToVault(folderPrefix);
      logger.info("File successfully added to vault");
      await refresh();
    } catch (e) {
      const msg = formatErr(e);
      if (msg !== "cancelled") {
        logger.error(`Failed to add file: ${msg}`);
        setBanner(msg);
      } else {
        logger.debug("User cancelled add file dialog");
      }
    }
  }

  async function submitNewFolder() {
    const name = newFolderName.trim();
    logger.info(`Creating new folder: ${name}`);
    setBanner(null);
    if (!name || name.includes("/") || name.includes("\\")) {
      logger.warn("Invalid folder name attempted");
      setBanner("Enter a single folder name without slashes.");
      return;
    }
    const full = folderPrefix === "" ? name : `${folderPrefix}/${name}`;
    try {
      await Backend.CreateVaultFolder(full);
      logger.info(`Folder created: ${full}`);
      setNewFolderOpen(false);
      setNewFolderName("");
      await refresh();
    } catch (e) {
      logger.error(`Failed to create folder: ${formatErr(e)}`);
      setBanner(formatErr(e));
    }
  }

  async function submitRenameFile() {
    if (!renameTargetPath) return;
    const name = renameFileName.trim();
    logger.info(`Renaming ${renameTargetPath} to ${name}`);
    setBanner(null);
    if (!name || name.includes("/") || name.includes("\\")) {
      logger.warn("Invalid rename target name attempted");
      setBanner("Enter a single file name without slashes.");
      return;
    }
    const newPath =
      renameTargetPath.lastIndexOf("/") >= 0
        ? `${renameTargetPath.slice(0, renameTargetPath.lastIndexOf("/"))}/${name}`
        : name;
    try {
      await Backend.RenameVaultFile(renameTargetPath, name);
      logger.info(`Successfully renamed to ${newPath}`);
      setRenameOpen(false);
      setRenameTargetPath(null);
      const rows = await refresh();
      setSelected(rows.find((e) => e.path === newPath) ?? null);
    } catch (e) {
      logger.error(`Failed to rename file: ${formatErr(e)}`);
      setBanner(formatErr(e));
    }
  }

  async function confirmDeleteFile() {
    if (!deleteTargetPath) return;
    logger.warn(`Deleting file from vault: ${deleteTargetPath}`);
    setBanner(null);
    try {
      await Backend.DeleteVaultPath(deleteTargetPath);
      logger.info(`Successfully deleted file: ${deleteTargetPath}`);
      setDeleteOpen(false);
      if (selected?.path === deleteTargetPath) setSelected(null);
      setDeleteTargetPath(null);
      await refresh();
    } catch (e) {
      logger.error(`Failed to delete file: ${formatErr(e)}`);
      setBanner(formatErr(e));
    }
  }

  const moveVaultFileToFolder = useCallback(
    async (srcPath: string, destFolder: string) => {
      logger.info(`Moving file ${srcPath} to folder ${destFolder || "root"}`);
      setBanner(null);
      const rec = files.find((f) => f.path === srcPath);
      if (!rec || rec.isDir) return;
      if (parentVaultPath(srcPath) === destFolder) return;
      const base = basename(srcPath);
      const newPath = destFolder === "" ? base : `${destFolder}/${base}`;
      try {
        await Backend.MoveVaultEntry(srcPath, destFolder);
        logger.info("Successfully moved file");
        const rows = await refresh();
        setSelected((prev) => {
          if (prev?.path !== srcPath) return prev;
          return rows.find((r) => r.path === newPath) ?? null;
        });
      } catch (e) {
        logger.error(`Failed to move file: ${formatErr(e)}`);
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
      <header className="border-b px-4 py-3 flex flex-wrap items-center gap-2 draggable-region">
        <button
          className="text-lg font-semibold tracking-tight hover:opacity-80 transition-opacity flex items-center gap-2 non-draggable"
          onClick={() => setAboutOpen(true)}
        >
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base outline outline-1 outline-border">
            🔒
          </div>
        </button>
        <Button type="button" variant="outline" size="sm" onClick={() => void onCreateNew()} className="non-draggable">
          <PlusCircle className="size-4" aria-hidden />
          Create vault
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => void onOpenExisting()} className="non-draggable">
          <FolderOpen className="size-4" aria-hidden />
          Open vault
        </Button>
        {unlocked ? (
          <>
            <Button type="button" size="sm" onClick={() => setAddFileOpen(true)} className="non-draggable">
              <FilePlus className="size-4" aria-hidden />
              Add file here
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="non-draggable"
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
              className="text-destructive hover:text-destructive non-draggable"
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



      {banner ? (
        <div className="mx-4 mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {banner}
        </div>
      ) : null}

      <div className="flex flex-1 min-h-0">
        <aside className={cn("w-64 shrink-0 border-r flex flex-col min-h-0", isMediaLoading && "pointer-events-none opacity-60")}>
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
                      onClick={() => {
                        setFolderPrefix(row.path);
                        setSelected(null);
                      }}
                      className={cn(
                        "w-full text-left rounded-md px-2 py-1 text-sm truncate hover:bg-accent flex items-center gap-2",
                        dragOverTarget === `drop-folder:${row.path}` &&
                        "ring-2 ring-inset ring-primary",
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
                      onClick={() => {
                        setFolderPrefix(row.entry.path);
                        setSelected(null);
                      }}
                      className={cn(
                        "w-full text-left rounded-md px-2 py-1 text-sm truncate hover:bg-accent flex items-center gap-2",
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
                    className="py-1"
                  >
                    <button
                      type="button"
                      onClick={() => setSelected(row.entry)}
                      className={cn(
                        "w-full text-left rounded-md px-2 py-1 text-sm truncate hover:bg-accent cursor-grab active:cursor-grabbing",
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
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={copyLinkState === "copying"}
                    onClick={() => void copyDecryptLink()}
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
                  <div className={cn("transition-opacity duration-300 w-full", isMediaLoading ? "opacity-0 absolute inset-0 pointer-events-none" : "opacity-100 relative")}>
                  {isImage(detectedMime || selected.mime) ? (
                    <img
                      key={selected.path}
                      src={previewSrc}
                      alt={basename(selected.path)}
                      className="max-h-[calc(100vh-8rem)] max-w-full rounded-md border object-contain inline-block"
                      onLoad={() => setIsMediaLoading(false)}
                      onError={() => setIsMediaLoading(false)}
                    />
                  ) : isVideo(detectedMime || selected.mime) ? (
                    <VaultVideoPreview
                      key={selected.path}
                      src={previewSrc}
                      onLoadedData={() => setIsMediaLoading(false)}
                      onError={() => setIsMediaLoading(false)}
                    />
                  ) : isTextLike(detectedMime || selected.mime) ? (
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
          )}
        </main>
      </div>

      <CreateVaultDialog
        open={createPwdOpen}
        onOpenChange={(open: boolean) => {
          if (!open && createVaultSubmitting) return;
          setCreatePwdOpen(open);
          if (!open) {
            setCreateVaultSubmitting(false);
            setAlgorithm("aes");
          }
        }}
        pendingPath={pendingPath}
        password={password}
        onPasswordChange={setPassword}
        algorithm={algorithm}
        onAlgorithmChange={setAlgorithm}
        submitting={createVaultSubmitting}
        onSubmit={submitCreateVault}
      />

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

      <AddFileDialog
        open={addFileOpen}
        onOpenChange={setAddFileOpen}
        folderPrefix={folderPrefix}
        onSelectFile={() => void onAddFile()}
        onDownloadUrl={async (url: string) => {
          logger.info(`Downloading file from URL: ${url}`);
          setBanner(null);
          try {
            await Backend.AddFileFromUrlToVault(url, folderPrefix);
            logger.info("File downloaded and added to vault");
            await refresh();
          } catch (e) {
            const msg = formatErr(e);
            logger.error(`Failed to download file: ${msg}`);
            setBanner(msg);
            throw e;
          }
        }}
      />

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
