import { useCallback, useEffect, useRef, useState } from "react";
import * as Backend from "../../wailsjs/go/backend/App";
import { backend } from "../../wailsjs/go/models";
import { logger } from "@/lib/logger";

export function useVaultFiles() {
  const [unlocked, setUnlocked] = useState(false);
  const [files, setFiles] = useState<backend.VaultFileEntry[]>([]);
  const [folderPrefix, setFolderPrefix] = useState("");

  const refresh = useCallback(async (): Promise<backend.VaultFileEntry[]> => {
    logger.debug("Checking vault lock status...");
    const ok = await Backend.VaultUnlocked();
    setUnlocked(ok);
    if (!ok) {
      setFiles([]);
      setFolderPrefix("");
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

  return {
    unlocked,
    files,
    folderPrefix,
    setFolderPrefix,
    refresh,
  };
}
