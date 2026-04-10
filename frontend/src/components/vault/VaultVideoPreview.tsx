import { useEffect, useRef } from "react";

export function VaultVideoPreview({
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
      className={className ?? "max-h-[calc(100vh-8rem)] max-w-full rounded-md border bg-black"}
    />
  );
}
