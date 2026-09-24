import type { ReactNode } from "react";
import { Building2 } from "lucide-react";
import { InstallAppButton } from "@/components/InstallAppButton";
import { ThemeToggle } from "@/components/ThemeToggle";

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      <ThemeToggle className="absolute right-4 top-4" />
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="brand-gradient flex h-12 w-12 items-center justify-center rounded-xl text-white">
            <Building2 className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">{children}</div>
        <div className="flex justify-center">
          <InstallAppButton />
        </div>
      </div>
    </div>
  );
}
