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

type UnlockVaultDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingPath: string;
  password: string;
  onPasswordChange: (v: string) => void;
  onSubmit: () => void;
};

export function UnlockVaultDialog({
  open,
  onOpenChange,
  pendingPath,
  password,
  onPasswordChange,
  onSubmit,
}: UnlockVaultDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showClose>
        <DialogHeader>
          <DialogTitle>Unlock vault</DialogTitle>
          <DialogDescription>
            Enter the password for <span className="font-mono text-xs break-all">{pendingPath}</span>
          </DialogDescription>
        </DialogHeader>
        <Input
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(ev) => onPasswordChange(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") void onSubmit();
          }}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void onSubmit()}>
            Unlock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
