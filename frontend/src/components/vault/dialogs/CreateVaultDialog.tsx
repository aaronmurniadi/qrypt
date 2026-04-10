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
import { Loader2 } from "lucide-react";

type CreateVaultDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingPath: string;
  password: string;
  onPasswordChange: (v: string) => void;
  algorithm: string;
  onAlgorithmChange: (v: string) => void;
  submitting: boolean;
  onSubmit: () => void;
};

export function CreateVaultDialog({
  open,
  onOpenChange,
  pendingPath,
  password,
  onPasswordChange,
  algorithm,
  onAlgorithmChange,
  submitting,
  onSubmit,
}: CreateVaultDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && submitting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        showClose={!submitting}
        onPointerDownOutside={(ev) => {
          if (submitting) ev.preventDefault();
        }}
        onEscapeKeyDown={(ev) => {
          if (submitting) ev.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>New vault password</DialogTitle>
          <DialogDescription>
            Argon2id derives a key for your vault. Choose a strong password. Path:{" "}
            <span className="font-mono text-xs break-all">{pendingPath}</span>
          </DialogDescription>
        </DialogHeader>
        <Input
          type="password"
          autoComplete="new-password"
          placeholder="Password"
          value={password}
          disabled={submitting}
          onChange={(ev) => onPasswordChange(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" && !submitting) void onSubmit();
          }}
        />
        <div className="space-y-1.5">
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            Encryption Algorithm
          </label>
          <select
            value={algorithm}
            disabled={submitting}
            onChange={(e) => onAlgorithmChange(e.target.value)}
            className="border-input bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="aes">AES-256 GCM (Standard)</option>
            <option value="serpent">Serpent-256 XTS (Advanced)</option>
            <option value="twofish">Twofish-256 XTS (Advanced)</option>
          </select>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={submitting} aria-busy={submitting} onClick={() => void onSubmit()}>
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Creating…
              </>
            ) : (
              "Create vault"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
