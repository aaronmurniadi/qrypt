import { backend } from "../../wailsjs/go/models";

export function formatErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export function isTextLike(mime: string) {
  return mime.startsWith("text/") || mime === "application/json";
}

export function isImage(mime: string) {
  return mime.startsWith("image/");
}

export function isVideo(mime: string) {
  return mime.startsWith("video/");
}

export function basename(path: string) {
  const n = path.replace(/\\/g, "/");
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(i + 1) : n;
}

export const QRYPT_DND = "application/x-qrypt-path";

export function parentVaultPath(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

export function vaultPathFromDrag(dt: DataTransfer): string | null {
  const v = (dt.getData(QRYPT_DND) || dt.getData("text/plain")).trim();
  return v || null;
}

export function canAcceptVaultPathDrop(dt: DataTransfer): boolean {
  return dt.types.includes(QRYPT_DND) || dt.types.includes("text/plain");
}

export type ChildRow =
  | { kind: "folder"; name: string; path: string }
  | { kind: "entry"; entry: backend.VaultFileEntry };

export function listChildRows(folderPrefix: string, entries: backend.VaultFileEntry[]): ChildRow[] {
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

export const ALGORITHM_OPTIONS = [
  { value: "aes", label: "AES-256 GCM (Standard)" },
  { value: "serpent", label: "Serpent-256 XTS (Advanced)" },
  { value: "twofish", label: "Twofish-256 XTS (Advanced)" },
] as const;
