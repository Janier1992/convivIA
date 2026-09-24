import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ClipboardList } from "lucide-react";
import { insforge } from "@/lib/insforgeClient";
import { useOrgId } from "@/hooks/useOrganization";
import { formatRelative } from "@/lib/format";
import { PQRS_PRIORITY, PQRS_STATUS } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { PqrsTicket } from "@/types/domain";

/** PQRS abiertas ordenadas por vencimiento: lo más urgente primero. */
export function RecentPqrsCard() {
  const orgId = useOrgId();
  const { data, isLoading } = useQuery({
    queryKey: ["pqrs-due", orgId],
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from("pqrs_tickets")
        .select("id, radicado, subject, status, priority, due_at")
        .eq("organization_id", orgId)
        .not("status", "in", "(answered,closed)")
        .order("due_at", { ascending: true })
        .limit(6);
      if (error) throw error;
      return data as Pick<PqrsTicket, "id" | "radicado" | "subject" | "status" | "priority" | "due_at">[];
    }
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-primary" aria-hidden /> PQRS por vencer
        </CardTitle>
        <Link to="/dashboard/pqrs" className="text-sm font-medium text-primary hover:underline">
          Ver todas
        </Link>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <Skeleton className="h-24 w-full" />}
        {data?.length === 0 && <p className="text-sm text-muted-foreground">No hay PQRS abiertas. ¡Todo al día!</p>}
        {data?.map((ticket) => {
          const overdue = ticket.due_at ? new Date(ticket.due_at) < new Date() : false;
          return (
            <div key={ticket.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{ticket.subject}</p>
                <p className="text-xs text-muted-foreground">
                  {ticket.radicado} · <span className={overdue ? "font-medium text-destructive" : undefined}>
                    {overdue ? "vencida " : "vence "}
                    {formatRelative(ticket.due_at)}
                  </span>
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge variant={PQRS_STATUS[ticket.status].variant}>{PQRS_STATUS[ticket.status].label}</Badge>
                {ticket.priority !== "normal" && <Badge variant={PQRS_PRIORITY[ticket.priority].variant}>{PQRS_PRIORITY[ticket.priority].label}</Badge>}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
