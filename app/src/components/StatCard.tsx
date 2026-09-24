import type { ElementType, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Tone = "default" | "accent" | "success" | "warning" | "destructive";

const TONES: Record<Tone, string> = {
  default: "bg-primary/10 text-primary",
  accent: "bg-accent/10 text-accent",
  success: "bg-success/10 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/10 text-destructive"
};

interface StatCardProps {
  icon: ElementType;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  loading?: boolean;
  to?: string;
}

export function StatCard({ icon: Icon, label, value, hint, tone = "default", loading, to }: StatCardProps) {
  const content = (
    <Card className={cn("h-full transition-shadow", to && "hover:card-elevated")}>
      <CardContent className="flex items-start gap-4 p-5">
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", TONES[tone])}>
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          {loading ? <Skeleton className="mt-1 h-7 w-24" /> : <p className="truncate text-2xl font-bold tracking-tight">{value}</p>}
          {hint && !loading && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
  return to ? (
    <Link to={to} className="block rounded-lg focus-visible:ring-2 focus-visible:ring-primary/40">
      {content}
    </Link>
  ) : (
    content
  );
}
