import { useEffect, useState } from "react";
import * as Backend from "../../wailsjs/go/backend/App";
import { backend } from "../../wailsjs/go/models";
import { formatErr, isImage, isTextLike, isVideo } from "@/lib/vault-utils";
import { logger } from "@/lib/logger";

export function useFilePreview(unlocked: boolean, selected: backend.VaultFileEntry | null) {
  const [detectedMime, setDetectedMime] = useState<string>("");
  const [previewSrc, setPreviewSrc] = useState("");
  const [textPreview, setTextPreview] = useState<string | null>(null);
  const [isMediaLoading, setIsMediaLoading] = useState(false);

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
          const text = decodeURIComponent(
            atob(data)
              .split("")
              .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
              .join(""),
          );
          setTextPreview(text);
          setIsMediaLoading(false);
        } else if (isImage(effectiveMime)) {
          setPreviewSrc(`data:${effectiveMime};base64,${data}`);
        } else if (isVideo(effectiveMime)) {
          const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
          const blob = new Blob([bytes], { type: effectiveMime });
          blobUrl = URL.createObjectURL(blob);
          setPreviewSrc(blobUrl);
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

  return {
    detectedMime,
    previewSrc,
    textPreview,
    isMediaLoading,
    setIsMediaLoading,
    setPreviewSrc,
    setTextPreview,
    setDetectedMime,
  };
}
