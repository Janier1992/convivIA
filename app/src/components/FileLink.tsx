import { useState } from "react";
import { toast } from "sonner";
import { Paperclip } from "lucide-react";
import { functionsClient } from "@/lib/functionsClient";
import { Button } from "@/components/ui/button";

type FileKind = "payment_receipt" | "message_attachment" | "document" | "subscription_receipt";

/**
 * Abre un archivo privado con una URL firmada de corta duración (la genera
 * la Edge Function get-file-url después de verificar el permiso).
 */
export function FileLink({ kind, id, label = "Ver soporte" }: { kind: FileKind; id: string; label?: string }) {
  const [loading, setLoading] = useState(false);

  async function open() {
    // La pestaña se abre antes del await para que el navegador no la bloquee como popup.
    const tab = window.open("about:blank", "_blank");
    setLoading(true);
    try {
      const { url } = await functionsClient.get<{ url: string }>("get-file-url", { kind, id });
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (err) {
      tab?.close();
      toast.error(err instanceof Error ? err.message : "No se pudo abrir el archivo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={open} disabled={loading}>
      <Paperclip className="h-3.5 w-3.5" aria-hidden />
      {loading ? "Abriendo..." : label}
    </Button>
  );
}
