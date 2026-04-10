import { Button } from "@/components/ui/button";
import {
  FilePlus,
  FolderOpen,
  FolderPlus,
  Lock,
  PlusCircle,
} from "lucide-react";

type AppToolbarProps = {
  unlocked: boolean;
  onAbout: () => void;
  onCreateNew: () => void;
  onOpenExisting: () => void;
  onAddFile: () => void;
  onNewFolder: () => void;
  onLock: () => void;
};

export function AppToolbar({
  unlocked,
  onAbout,
  onCreateNew,
  onOpenExisting,
  onAddFile,
  onNewFolder,
  onLock,
}: AppToolbarProps) {
  return (
    <header className="border-b px-4 py-3 flex flex-wrap items-center gap-2 draggable-region">
      <button
        type="button"
        className="text-lg font-semibold tracking-tight hover:opacity-80 transition-opacity flex items-center gap-2 non-draggable"
        onClick={onAbout}
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
          <Button type="button" size="sm" onClick={() => void onAddFile()} className="non-draggable">
            <FilePlus className="size-4" aria-hidden />
            Add file here
          </Button>
          <Button type="button" variant="outline" size="sm" className="non-draggable" onClick={onNewFolder}>
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
  );
}
