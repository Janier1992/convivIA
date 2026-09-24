import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageCircle, Send, Unplug } from "lucide-react";
import { functionsClient } from "@/lib/functionsClient";
import { errorMessage } from "@/lib/rpc";
import { useOrgId } from "@/hooks/useOrganization";
import { rpc } from "@/lib/rpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/PageHeader";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface ChannelStatus {
  provider: "telegram" | "twilio";
  status: "connected" | "disconnected" | "error";
  connected_at: string | null;
}

export function IntegrationsPage() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [botToken, setBotToken] = useState("");
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [busy, setBusy] = useState<"telegram" | "twilio" | null>(null);
  const [disconnecting, setDisconnecting] = useState<"telegram" | "twilio" | null>(null);

  const { data: channels = [] } = useQuery({
    queryKey: ["channel-status", orgId],
    enabled: !!orgId,
    refetchInterval: 15_000,
    queryFn: () => rpc<ChannelStatus[]>("get_channel_status", { p_organization_id: orgId })
  });

  const telegram = channels.find((c) => c.provider === "telegram");
  const twilio = channels.find((c) => c.provider === "twilio");

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["channel-status", orgId] });

  async function connectTelegram() {
    if (!botToken.trim()) return toast.error("Pega el token del bot.");
    setBusy("telegram");
    try {
      const result = await functionsClient.post<{ botUsername: string | null }>("telegram-connect", { organization_id: orgId, botToken: botToken.trim() });
      toast.success(result.botUsername ? `Conectado como @${result.botUsername}.` : "Telegram conectado.");
      setBotToken("");
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function connectTwilio() {
    if (!accountSid.trim() || !authToken.trim() || !whatsappNumber.trim()) return toast.error("Completa los tres campos.");
    setBusy("twilio");
    try {
      await functionsClient.post("twilio-connect", { organization_id: orgId, accountSid: accountSid.trim(), authToken: authToken.trim(), whatsappNumber: whatsappNumber.trim() });
      toast.success("WhatsApp conectado.");
      setAccountSid(""); setAuthToken(""); setWhatsappNumber("");
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!disconnecting) return;
    await functionsClient.post(disconnecting === "telegram" ? "telegram-disconnect" : "twilio-disconnect", { organization_id: orgId });
    toast.success("Canal desconectado.");
    await refresh();
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Canales" description="Conecta Telegram y WhatsApp para que el asistente atienda a los residentes." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2"><Send className="h-4 w-4" aria-hidden /> Telegram</CardTitle>
              <CardDescription>Gratis, recomendado para empezar.</CardDescription>
            </div>
            <Badge variant={telegram?.status === "connected" ? "success" : "muted"}>{telegram?.status === "connected" ? "Conectado" : "Desconectado"}</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {telegram?.status === "connected" ? (
              <Button variant="outline" onClick={() => setDisconnecting("telegram")}><Unplug className="h-4 w-4" aria-hidden /> Desconectar</Button>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Crea un bot gratis con <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-primary underline">@BotFather</a> y pega aquí el token.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="tg-token">Token del bot</Label>
                  <Input id="tg-token" value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder="123456789:AA..." />
                </div>
                <Button onClick={connectTelegram} disabled={busy === "telegram"}>{busy === "telegram" ? "Conectando..." : "Conectar Telegram"}</Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2"><MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp</CardTitle>
              <CardDescription>Vía Twilio (tiene costo por conversación).</CardDescription>
            </div>
            <Badge variant={twilio?.status === "connected" ? "success" : "muted"}>{twilio?.status === "connected" ? "Conectado" : "Desconectado"}</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {twilio?.status === "connected" ? (
              <Button variant="outline" onClick={() => setDisconnecting("twilio")}><Unplug className="h-4 w-4" aria-hidden /> Desconectar</Button>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="tw-sid">Account SID</Label>
                  <Input id="tw-sid" value={accountSid} onChange={(e) => setAccountSid(e.target.value)} placeholder="ACxxxxxxxx..." />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tw-auth">Auth Token</Label>
                  <Input id="tw-auth" type="password" value={authToken} onChange={(e) => setAuthToken(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tw-number">Número de WhatsApp</Label>
                  <Input id="tw-number" value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} placeholder="+1415..." />
                </div>
                <Button onClick={connectTwilio} disabled={busy === "twilio"}>{busy === "twilio" ? "Conectando..." : "Conectar WhatsApp"}</Button>
                <p className="text-xs text-muted-foreground">
                  Configura el webhook entrante de Twilio hacia el compute service (ver README del despliegue).
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={!!disconnecting}
        onOpenChange={(o) => !o && setDisconnecting(null)}
        title="Desconectar canal"
        description="El asistente dejará de responder por este canal hasta que lo vuelvas a conectar."
        confirmLabel="Desconectar"
        destructive
        onConfirm={disconnect}
      />
    </div>
  );
}
