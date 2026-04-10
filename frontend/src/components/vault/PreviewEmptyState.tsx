import type { ReactNode } from "react";

export function PreviewEmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 min-h-0 flex flex-col rounded-lg ring-1 ring-border/60 relative overflow-hidden bg-muted/10">
      <div className="flex flex-1 min-h-0 flex-col items-center justify-center p-6 text-center">
        {children}
      </div>
    </div>
  );
}
