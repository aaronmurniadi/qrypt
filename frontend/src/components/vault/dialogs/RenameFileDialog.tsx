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

type RenameFileDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetPath: string | null;
  fileName: string;
  onFileNameChange: (v: string) => void;
  onSubmit: () => void;
};

export function RenameFileDialog({
  open,
  onOpenChange,
  targetPath,
  fileName,
  onFileNameChange,
  onSubmit,
}: RenameFileDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showClose>
        <DialogHeader>
          <DialogTitle>Rename file</DialogTitle>
          <DialogDescription>
            New name in the same folder only (no slashes). Full path:{" "}
            <span className="font-mono text-xs break-all">{targetPath ?? "—"}</span>
          </DialogDescription>
        </DialogHeader>
        <Input
          value={fileName}
          placeholder="File name"
          onChange={(ev) => onFileNameChange(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") void onSubmit();
          }}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void onSubmit()}>
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
