import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type AboutDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showClose>
        <DialogHeader>
          <DialogTitle>About QrypT</DialogTitle>
          <DialogDescription>Secure file vault application for your sensitive data</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="text-sm space-y-2">
            <div>
              <strong>Version:</strong> 0.1.0 (Alpha)
            </div>
            <div>
              <strong>Author:</strong> Aaron P. Murniadi
            </div>
            <div>
              <strong>License:</strong> GPLv3
            </div>
            <div>
              <strong>Technologies:</strong> Go, React, Wails, Tailwind CSS
            </div>
          </div>
          <div className="border-t pt-4">
            <h4 className="font-semibold mb-2">Future Contributors</h4>
            <p className="text-sm text-muted-foreground">
              Space reserved for contributors who help improve QrypT. Whether fixing bugs, adding features, improving
              documentation, or enhancing security - your contributions are welcome!
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
