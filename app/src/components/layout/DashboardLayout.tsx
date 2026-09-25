import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Building, ChevronDown, LifeBuoy, LogOut, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useOrganization } from "@/hooks/useOrganization";
import { usePropertyProfile } from "@/hooks/usePropertyProfile";
import { useSupportStaff } from "@/hooks/useSupportStaff";
import { useAdminDashboard } from "@/hooks/useAdminDashboard";
import { ROLE_LABELS } from "@/lib/labels";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { NAV_SECTIONS, type NavItem } from "./navigation";
import type { AdminDashboard } from "@/types/domain";

/** Coincide con la ruta activa igual que NavLink, para saber qué módulo abrir. */
function isItemActive(item: NavItem, pathname: string): boolean {
  return item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);
}

function sectionForPath(pathname: string): string | null {
  return NAV_SECTIONS.find((section) => section.items.some((item) => isItemActive(item, pathname)))?.title ?? null;
}

function Brand({ name, logoUrl }: { name: string; logoUrl: string | null | undefined }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {logoUrl ? (
        <img src={logoUrl} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
      ) : (
        <div className="brand-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white">
          <Building className="h-5 w-5" aria-hidden />
        </div>
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold leading-tight">{name}</p>
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">ConvivIA</p>
      </div>
    </div>
  );
}

function SectionHeader({ title, open, count, onToggle }: { title: string; open: boolean; count: number; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <span className="flex-1 truncate text-left">{title}</span>
      {!open && count > 0 && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-label={`${count} pendientes en ${title}`} />
      )}
      <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-200", open ? "rotate-0" : "-rotate-90")} aria-hidden />
    </button>
  );
}

function NavEntry({ item, count }: { item: NavItem; count: number }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive ? "bg-primary/10 text-primary" : "text-foreground/75 hover:bg-muted hover:text-foreground"
        )
      }
    >
      <item.icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1 truncate">{item.label}</span>
      {count > 0 && (
        <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning" aria-label={`${count} pendientes`}>
          {count > 99 ? "99+" : count}
        </span>
      )}
    </NavLink>
  );
}

export function DashboardLayout() {
  const { user, signOut } = useAuth();
  const { memberships, currentOrganizationId, currentOrganization, currentRole, setCurrentOrganizationId, can } = useOrganization();
  const { data: profile } = usePropertyProfile();
  const { data: dashboard } = useAdminDashboard();
  const { isSupportStaff } = useSupportStaff();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();
  const brandName = profile?.display_name || currentOrganization?.name || "ConvivIA";

  // El módulo del que se navega queda abierto de entrada; los demás, plegados.
  const [openSection, setOpenSection] = useState<string | null>(() => sectionForPath(location.pathname));

  useEffect(() => {
    setMobileNavOpen(false);
    setOpenSection(sectionForPath(location.pathname));
  }, [location.pathname]);

  function toggleSection(title: string) {
    setOpenSection((current) => (current === title ? null : title));
  }

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.permission || can(item.permission))
  })).filter((section) => section.items.length > 0);

  function sectionBadgeTotal(items: NavItem[], dashboard: AdminDashboard | undefined) {
    if (!dashboard) return 0;
    return items.reduce((sum, item) => sum + (item.badge ? item.badge(dashboard) : 0), 0);
  }

  const sidebar = (
    <>
      <div className="flex h-16 items-center gap-2 border-b border-border px-4">
        <Brand name={brandName} logoUrl={profile?.logo_url} />
        <button className="ml-auto rounded-md p-1.5 text-foreground/60 hover:bg-muted lg:hidden" onClick={() => setMobileNavOpen(false)} aria-label="Cerrar menú">
          <X className="h-5 w-5" />
        </button>
      </div>

      {memberships.length > 1 && (
        <div className="border-b border-border p-3">
          <Select value={currentOrganizationId ?? undefined} onValueChange={setCurrentOrganizationId}>
            <SelectTrigger aria-label="Cambiar de copropiedad">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {memberships.map((m) => (
                <SelectItem key={m.organization_id} value={m.organization_id}>
                  {m.organizations.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Navegación principal">
        {sections.map((section) => {
          const open = openSection === section.title;
          return (
            <div key={section.title}>
              <SectionHeader
                title={section.title}
                open={open}
                count={sectionBadgeTotal(section.items, dashboard)}
                onToggle={() => toggleSection(section.title)}
              />
              <div className={cn("grid transition-[grid-template-rows] duration-200 ease-in-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                <div className="overflow-hidden">
                  <div className="space-y-1 py-1">
                    {section.items.map((item) => (
                      <NavEntry key={item.to} item={item} count={dashboard && item.badge ? item.badge(dashboard) : 0} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {isSupportStaff && (
          <NavEntry item={{ to: "/soporte", label: "Soporte ConvivIA", icon: LifeBuoy }} count={0} />
        )}
      </nav>

      <div className="border-t border-border p-3">
        <div className="mb-2 px-1">
          <p className="truncate text-xs font-medium">{user?.email}</p>
          {currentRole && <p className="text-[11px] text-muted-foreground">{ROLE_LABELS[currentRole]}</p>}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => signOut()} className="flex flex-1 items-center gap-2 rounded-md px-2 py-2 text-sm text-foreground/80 hover:bg-muted">
            <LogOut className="h-4 w-4" aria-hidden /> Cerrar sesión
          </button>
          <ThemeToggle />
        </div>
      </div>
    </>
  );

  return (
    <div className="flex h-dvh bg-background">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] shrink-0 flex-col border-r border-border bg-card transition-transform duration-200 ease-in-out lg:static lg:z-auto lg:w-64 lg:max-w-none lg:translate-x-0",
          mobileNavOpen ? "translate-x-0 shadow-xl" : "-translate-x-full"
        )}
      >
        {sidebar}
      </aside>

      {mobileNavOpen && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setMobileNavOpen(false)} aria-hidden="true" />}

      <div className="flex h-dvh min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4 lg:hidden">
          <button className="rounded-md p-1.5 text-foreground/70 hover:bg-muted" onClick={() => setMobileNavOpen(true)} aria-label="Abrir menú">
            <Menu className="h-5 w-5" />
          </button>
          <span className="flex-1 truncate font-semibold">{brandName}</span>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
            <ErrorBoundary key={location.pathname} title="No se pudo cargar esta sección.">
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
