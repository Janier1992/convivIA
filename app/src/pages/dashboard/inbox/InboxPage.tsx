import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Bot, Handshake, Info, Send } from "lucide-react";
import { insforge } from "@/lib/insforgeClient";
import { errorMessage, rpc } from "@/lib/rpc";
import { formatRelative, formatTime } from "@/lib/format";
import { CHANNEL_LABELS } from "@/lib/labels";
import { useOrganization } from "@/hooks/useOrganization";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { QueryErrorState } from "@/components/QueryErrorState";
import { EmptyState } from "@/components/EmptyState";
import { FileLink } from "@/components/FileLink";
import { cn } from "@/lib/utils";
import type { Conversation, Message } from "@/types/domain";
import { ConversationInfo } from "./ConversationInfo";

export function InboxPage() {
  const { currentOrganizationId: orgId, can } = useOrganization();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [mobilePane, setMobilePane] = useState<"list" | "thread">("list");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const canReply = can("inbox.reply");

  const { data: conversations = [], isError: conversationsError, refetch: refetchConversations } = useQuery({
    queryKey: ["conversations", orgId],
    enabled: !!orgId,
    refetchInterval: 10_000,
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("conversations")
        .select("*, persons(full_name, phone)")
        .eq("organization_id", orgId)
        .eq("is_preview", false)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return data as Conversation[];
    }
  });

  const activeConversation = conversations.find((c) => c.id === selectedId) ?? null;

  const { data: messages = [] } = useQuery({
    queryKey: ["messages", activeConversation?.id],
    enabled: !!activeConversation,
    refetchInterval: 5_000,
    queryFn: async () => {
      const { data, error } = await insforge.database.from("messages").select("*").eq("conversation_id", activeConversation!.id).order("created_at", { ascending: true });
      if (error) throw error;
      return data as Message[];
    }
  });

  async function sendReply() {
    if (!activeConversation || !draft.trim()) return;
    const content = draft.trim();
    setDraft("");
    try {
      await rpc("send_staff_reply", { p_conversation_id: activeConversation.id, p_content: content });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["messages", activeConversation.id] }),
        queryClient.invalidateQueries({ queryKey: ["conversations", orgId] })
      ]);
    } catch (err) {
      toast.error(errorMessage(err));
      setDraft(content);
    }
  }

  async function toggleHandoff(back: boolean) {
    if (!activeConversation) return;
    try {
      await rpc("set_conversation_status", { p_conversation_id: activeConversation.id, p_status: back ? "active" : "handoff", p_reason: back ? null : "Tomada manualmente desde el Inbox" });
      toast.success(back ? "El asistente vuelve a responder esta conversación." : "El asistente quedó en pausa en esta conversación.");
      await queryClient.invalidateQueries({ queryKey: ["conversations", orgId] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="flex h-[calc(100vh-6.5rem)] gap-4 lg:h-[calc(100vh-3.5rem)]">
      <div className={cn("w-full shrink-0 overflow-y-auto rounded-lg border border-border bg-card lg:block lg:w-72", mobilePane === "thread" ? "hidden lg:block" : "block")}>
        {conversationsError ? (
          <div className="p-3"><QueryErrorState onRetry={() => refetchConversations()} message="No se pudieron cargar las conversaciones." /></div>
        ) : conversations.length === 0 ? (
          <div className="p-4"><EmptyState icon={Send} title="Sin conversaciones todavía" /></div>
        ) : (
          conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => { setSelectedId(c.id); setMobilePane("thread"); }}
              className={cn("flex w-full flex-col gap-0.5 border-b border-border px-4 py-3 text-left hover:bg-muted", activeConversation?.id === c.id && "bg-primary/10")}
            >
              <span className="flex items-center justify-between gap-2 text-sm font-medium">
                <span className="truncate">{c.persons?.full_name || c.contact_name || c.external_identity}</span>
                {c.status === "handoff" && <Badge variant="warning" className="shrink-0">Con el equipo</Badge>}
              </span>
              <span className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{CHANNEL_LABELS[c.channel]}</span>
                {c.last_message_at && <span>{formatRelative(c.last_message_at)}</span>}
              </span>
            </button>
          ))
        )}
      </div>

      <div className={cn("flex-1 flex-col rounded-lg border border-border bg-card lg:flex", mobilePane === "thread" ? "flex" : "hidden")}>
        {activeConversation ? (
          <>
            <div className="flex items-center gap-2 border-b border-border p-3">
              <button className="rounded-md p-1.5 text-foreground/70 hover:bg-muted lg:hidden" onClick={() => setMobilePane("list")} aria-label="Volver a la lista"><ArrowLeft className="h-4 w-4" /></button>
              <span className="flex-1 truncate text-sm font-medium">{activeConversation.persons?.full_name || activeConversation.contact_name || activeConversation.external_identity}</span>
              {canReply && (
                <Button variant="outline" size="sm" onClick={() => toggleHandoff(activeConversation.status === "handoff")}>
                  {activeConversation.status === "handoff" ? <><Bot className="h-3.5 w-3.5" aria-hidden /> Devolver al asistente</> : <><Handshake className="h-3.5 w-3.5" aria-hidden /> Tomar conversación</>}
                </Button>
              )}
              <button className="rounded-md p-1.5 text-foreground/70 hover:bg-muted lg:hidden" onClick={() => setDetailsOpen(true)} aria-label="Ver info del residente"><Info className="h-4 w-4" /></button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.filter((m) => m.role !== "tool").map((m) => (
                <div key={m.id} className={cn("flex", m.role === "user" ? "justify-start" : "justify-end")}>
                  <div className={cn("max-w-[85%] whitespace-pre-line rounded-lg px-3 py-2 text-sm sm:max-w-[70%]", m.role === "user" ? "bg-muted" : m.role === "staff" ? "bg-accent text-accent-foreground" : "bg-primary text-primary-foreground")}>
                    {m.message_type === "image" || m.message_type === "document" ? (
                      <FileLink kind="message_attachment" id={m.id} label="Ver adjunto" />
                    ) : (
                      m.content
                    )}
                    <p className="mt-1 text-[10px] opacity-70">{formatTime(m.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
            {canReply && (
              <div className="flex gap-2 border-t border-border p-3">
                <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Escribe una respuesta manual..." onKeyDown={(e) => e.key === "Enter" && sendReply()} />
                <Button onClick={sendReply} aria-label="Enviar respuesta"><Send className="h-4 w-4" /></Button>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Selecciona una conversación</div>
        )}
      </div>

      <div className="hidden w-72 shrink-0 space-y-4 overflow-y-auto rounded-lg border border-border bg-card p-4 lg:block">
        {activeConversation ? <ConversationInfo conversation={activeConversation} /> : <p className="text-sm text-muted-foreground">Selecciona una conversación.</p>}
      </div>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Información del residente</DialogTitle></DialogHeader>
          {activeConversation && <ConversationInfo conversation={activeConversation} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
