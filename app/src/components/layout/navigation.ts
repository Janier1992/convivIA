import {
  Bot,
  Briefcase,
  Building2,
  CalendarDays,
  ClipboardList,
  FileText,
  Gavel,
  History,
  Inbox,
  LayoutDashboard,
  Megaphone,
  Plug,
  Settings,
  ShieldCheck,
  Trees,
  Users,
  UsersRound,
  Wallet,
  Receipt,
  Wrench,
  type LucideIcon
} from "lucide-react";
import type { AdminDashboard, ModuleKey, Permission } from "@/types/domain";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission?: Permission;
  /** Módulo comercial del que depende (lo activa/desactiva soporte); "Inicio" es el único sin uno, siempre visible. */
  module?: ModuleKey;
  end?: boolean;
  /** Pendientes que se muestran como contador junto al ítem. */
  badge?: (dashboard: AdminDashboard) => number;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "General",
    items: [
      { to: "/dashboard", label: "Inicio", icon: LayoutDashboard, end: true },
      { to: "/dashboard/portfolio", label: "Portafolio", icon: Briefcase, module: "portfolio" },
      {
        to: "/dashboard/inbox",
        label: "Conversaciones",
        icon: Inbox,
        permission: "inbox.read",
        module: "inbox",
        badge: (d) => d.conversations.handoff
      }
    ]
  },
  {
    title: "Operación",
    items: [
      {
        to: "/dashboard/pqrs",
        label: "PQRS",
        icon: ClipboardList,
        permission: "pqrs.read",
        module: "pqrs",
        badge: (d) => d.pqrs.overdue + d.pqrs.due_soon
      },
      {
        to: "/dashboard/reservations",
        label: "Reservas",
        icon: CalendarDays,
        permission: "reservations.read",
        module: "reservations",
        badge: (d) => d.reservations.pending_approval
      },
      { to: "/dashboard/common-areas", label: "Zonas comunes", icon: Trees, permission: "reservations.read", module: "reservations" },
      { to: "/dashboard/gatehouse", label: "Portería", icon: ShieldCheck, permission: "porteria.read", module: "porteria" },
      { to: "/dashboard/maintenance", label: "Mantenimiento", icon: Wrench, permission: "maintenance.read", module: "maintenance" },
      { to: "/dashboard/announcements", label: "Comunicados", icon: Megaphone, permission: "communications.read", module: "communications" }
    ]
  },
  {
    title: "Finanzas",
    items: [
      { to: "/dashboard/billing", label: "Cartera", icon: Wallet, permission: "finance.read", module: "finance" },
      {
        to: "/dashboard/payments",
        label: "Pagos",
        icon: Receipt,
        permission: "finance.read",
        module: "finance",
        badge: (d) => d.finance?.payments_pending_review ?? 0
      }
    ]
  },
  {
    title: "Copropiedad",
    items: [
      { to: "/dashboard/units", label: "Unidades", icon: Building2, module: "units" },
      { to: "/dashboard/residents", label: "Residentes", icon: Users, permission: "residents.read", module: "residents" },
      { to: "/dashboard/assembly", label: "Asamblea", icon: Gavel, permission: "assembly.read", module: "assembly" },
      { to: "/dashboard/documents", label: "Documentos", icon: FileText, permission: "documents.read", module: "documents" }
    ]
  },
  {
    title: "Configuración",
    items: [
      { to: "/dashboard/assistant", label: "Asistente IA", icon: Bot, permission: "agent.manage", module: "agent" },
      { to: "/dashboard/integrations", label: "Canales", icon: Plug, permission: "integrations.manage", module: "integrations" },
      { to: "/dashboard/team", label: "Equipo", icon: UsersRound, module: "team" },
      { to: "/dashboard/audit", label: "Auditoría", icon: History, permission: "audit.read", module: "audit" },
      { to: "/dashboard/settings", label: "Configuración", icon: Settings, permission: "settings.manage", module: "settings" }
    ]
  }
];
