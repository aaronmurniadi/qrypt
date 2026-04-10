import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type DeleteFileDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetPath: string | null;
  onConfirm: () => void;
};

export function DeleteFileDialog({ open, onOpenChange, targetPath, onConfirm }: DeleteFileDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showClose>
        <DialogHeader>
          <DialogTitle>Delete file</DialogTitle>
          <DialogDescription>
            This removes the file from the vault and reclaims space. This cannot be undone. Path:{" "}
            <span className="font-mono text-xs break-all">{targetPath ?? "—"}</span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={() => void onConfirm()}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
