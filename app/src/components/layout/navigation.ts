import {
  Bot,
  Building2,
  CalendarDays,
  ClipboardList,
  FileText,
  History,
  Inbox,
  LayoutDashboard,
  Megaphone,
  Plug,
  Settings,
  Trees,
  Users,
  UsersRound,
  Wallet,
  Receipt,
  type LucideIcon
} from "lucide-react";
import type { AdminDashboard, Permission } from "@/types/domain";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission?: Permission;
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
      { to: "/dashboard/inbox", label: "Conversaciones", icon: Inbox, permission: "inbox.read", badge: (d) => d.conversations.handoff }
    ]
  },
  {
    title: "Operación",
    items: [
      { to: "/dashboard/pqrs", label: "PQRS", icon: ClipboardList, permission: "pqrs.read", badge: (d) => d.pqrs.overdue + d.pqrs.due_soon },
      {
        to: "/dashboard/reservations",
        label: "Reservas",
        icon: CalendarDays,
        permission: "reservations.read",
        badge: (d) => d.reservations.pending_approval
      },
      { to: "/dashboard/common-areas", label: "Zonas comunes", icon: Trees, permission: "reservations.read" },
      { to: "/dashboard/announcements", label: "Comunicados", icon: Megaphone, permission: "communications.read" }
    ]
  },
  {
    title: "Finanzas",
    items: [
      { to: "/dashboard/billing", label: "Cartera", icon: Wallet, permission: "finance.read" },
      {
        to: "/dashboard/payments",
        label: "Pagos",
        icon: Receipt,
        permission: "finance.read",
        badge: (d) => d.finance?.payments_pending_review ?? 0
      }
    ]
  },
  {
    title: "Copropiedad",
    items: [
      { to: "/dashboard/units", label: "Unidades", icon: Building2 },
      { to: "/dashboard/residents", label: "Residentes", icon: Users, permission: "residents.read" },
      { to: "/dashboard/documents", label: "Documentos", icon: FileText, permission: "documents.read" }
    ]
  },
  {
    title: "Configuración",
    items: [
      { to: "/dashboard/assistant", label: "Asistente IA", icon: Bot, permission: "agent.manage" },
      { to: "/dashboard/integrations", label: "Canales", icon: Plug, permission: "integrations.manage" },
      { to: "/dashboard/team", label: "Equipo", icon: UsersRound },
      { to: "/dashboard/audit", label: "Auditoría", icon: History, permission: "audit.read" },
      { to: "/dashboard/settings", label: "Configuración", icon: Settings, permission: "settings.manage" }
    ]
  }
];
