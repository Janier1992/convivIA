import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { insforge } from "@/lib/insforgeClient";
import { errorMessage, rpc } from "@/lib/rpc";
import { useOrgId } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Message, Person } from "@/types/domain";

const NO_PERSON = "__none__";

/**
 * Vista previa del asistente: corre el runtime REAL (mismas herramientas y
 * reglas) sobre una conversación marcada como prueba, donde confirmar
 * nunca ejecuta nada de verdad.
 */
export function AssistantPreviewChat() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [personId, setPersonId] = useState(NO_PERSON);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: persons = [] } = useQuery({
    queryKey: ["preview-persons", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await insforge.database.from("persons").select("id, full_name, phone").eq("organization_id", orgId).order("full_name").limit(200);
      if (error) throw error;
      return data as Pick<Person, "id" | "full_name" | "phone">[];
    }
  });

  const { data: messages = [] } = useQuery({
    queryKey: ["preview-messages", conversationId],
    enabled: !!conversationId,
    refetchInterval: 1500,
    queryFn: async () => {
      const { data, error } = await insforge.database.from("messages").select("*").eq("conversation_id", conversationId).order("created_at", { ascending: true });
      if (error) throw error;
      return data as Message[];
    }
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function send() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setSending(true);
    try {
      const result = await rpc<{ conversation_id: string }>("enqueue_preview_message", {
        p_organization_id: orgId,
        p_content: text,
        p_conversation_id: conversationId,
        p_person_id: personId === NO_PERSON ? null : personId
      });
      setConversationId(result.conversation_id);
      queryClient.invalidateQueries({ queryKey: ["preview-messages", result.conversation_id] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  function resetChat() {
    setConversationId(null);
  }

  return (
    <div className="flex h-[520px] flex-col rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <Select
          value={personId}
          onValueChange={(v) => {
            setPersonId(v);
            resetChat();
          }}
        >
          <SelectTrigger className="flex-1" aria-label="Simular identidad">
            <SelectValue placeholder="Persona no verificada" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_PERSON}>Persona no verificada</SelectItem>
            {persons.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" onClick={resetChat}>Reiniciar</Button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">Simula una conversación sin riesgo: nada de esto crea PQRS, reservas ni pagos reales.</p>
        )}
        {messages.filter((m) => m.role !== "tool").map((m) => (
          <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[85%] whitespace-pre-line rounded-lg px-3 py-2 text-sm", m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted")}>
              {m.content}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2 border-t border-border p-3">
        <Input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Escribe como si fueras un residente..." disabled={sending} />
        <Button onClick={send} disabled={sending} aria-label="Enviar"><Send className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}
