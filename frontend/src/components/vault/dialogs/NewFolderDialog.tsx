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

type NewFolderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderPrefix: string;
  folderName: string;
  onFolderNameChange: (v: string) => void;
  onSubmit: () => void;
};

export function NewFolderDialog({
  open,
  onOpenChange,
  folderPrefix,
  folderName,
  onFolderNameChange,
  onSubmit,
}: NewFolderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showClose>
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>
            Create an empty folder under{" "}
            <span className="font-mono text-xs break-all">{folderPrefix === "" ? "vault root" : folderPrefix}</span>. Use
            letters, numbers, spaces, or dashes (no slashes).
          </DialogDescription>
        </DialogHeader>
        <Input
          value={folderName}
          placeholder="Folder name"
          onChange={(ev) => onFolderNameChange(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") void onSubmit();
          }}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void onSubmit()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
