import { useEffect, useRef } from "react";
import * as Backend from "../../wailsjs/go/backend/App";
import { OnFileDrop, OnFileDropOff } from "../../wailsjs/runtime/runtime";
import { basename, formatErr } from "@/lib/vault-utils";
import { logger } from "@/lib/logger";

export function useFileDrop(
  unlocked: boolean,
  folderPrefix: string,
  refresh: () => Promise<any>,
  setBanner: (msg: string | null) => void
) {
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
        /* */
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
  }, [unlocked, setBanner]);
}
