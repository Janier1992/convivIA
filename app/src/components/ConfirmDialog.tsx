import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** Si se indica, muestra un campo de motivo (queda en la auditoría). */
  reasonLabel?: string;
  /** Por defecto el motivo es obligatorio (mínimo 5 caracteres) cuando hay reasonLabel. */
  reasonRequired?: boolean;
  onConfirm: (reason: string) => Promise<void> | void;
}

const MIN_REASON = 5;

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  reasonLabel,
  reasonRequired = true,
  onConfirm
}: ConfirmDialogProps) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const reasonMissing = Boolean(reasonLabel) && reasonRequired && reason.trim().length < MIN_REASON;

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      onOpenChange(false);
    } catch {
      // onConfirm ya mostró el error; el diálogo queda abierto para reintentar.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription asChild><div>{description}</div></DialogDescription>}
        </DialogHeader>
        {reasonLabel && (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-reason">{reasonLabel}</Label>
            <Textarea id="confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
            <p className="text-xs text-muted-foreground">
              {reasonRequired ? `Mínimo ${MIN_REASON} caracteres. ` : ""}Queda registrado en la auditoría.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button variant={destructive ? "destructive" : "default"} onClick={handleConfirm} disabled={busy || reasonMissing}>
            {busy ? "Procesando..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
