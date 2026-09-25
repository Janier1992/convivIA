import { lazy, Suspense, type ComponentType } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { queryClient } from "@/lib/queryClient";
import { ThemeProvider } from "@/hooks/useTheme";
import { AuthProvider } from "@/hooks/useAuth";
import { OrganizationProvider } from "@/hooks/useOrganization";
import { InstallPromptProvider } from "@/hooks/useInstallPrompt";
import { RequireAuth, FullscreenLoader } from "@/components/RequireAuth";
import { RequireOrganization } from "@/components/RequireOrganization";
import { RequirePermission } from "@/components/RequirePermission";
import { RequireSupportStaff } from "@/components/RequireSupportStaff";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { SupportLayout } from "@/components/layout/SupportLayout";

// Cada página en su propio chunk: el login no paga el JS de todo el panel.
function page<K extends string>(loader: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(() => loader().then((m) => ({ default: m[name] })));
}

const LoginPage = page(() => import("@/pages/auth/LoginPage"), "LoginPage");
const RegisterPage = page(() => import("@/pages/auth/RegisterPage"), "RegisterPage");
const ForgotPasswordPage = page(() => import("@/pages/auth/ForgotPasswordPage"), "ForgotPasswordPage");
const OnboardingWizard = page(() => import("@/pages/onboarding/OnboardingWizard"), "OnboardingWizard");
const DashboardHome = page(() => import("@/pages/dashboard/DashboardHome"), "DashboardHome");
const PortfolioPage = page(() => import("@/pages/dashboard/PortfolioPage"), "PortfolioPage");
const InboxPage = page(() => import("@/pages/dashboard/inbox/InboxPage"), "InboxPage");
const PqrsPage = page(() => import("@/pages/dashboard/pqrs/PqrsPage"), "PqrsPage");
const ReservationsPage = page(() => import("@/pages/dashboard/reservations/ReservationsPage"), "ReservationsPage");
const CommonAreasPage = page(() => import("@/pages/dashboard/areas/CommonAreasPage"), "CommonAreasPage");
const GatehousePage = page(() => import("@/pages/dashboard/gatehouse/GatehousePage"), "GatehousePage");
const MaintenancePage = page(() => import("@/pages/dashboard/maintenance/MaintenancePage"), "MaintenancePage");
const AnnouncementsPage = page(() => import("@/pages/dashboard/announcements/AnnouncementsPage"), "AnnouncementsPage");
const BillingPage = page(() => import("@/pages/dashboard/billing/BillingPage"), "BillingPage");
const PaymentsPage = page(() => import("@/pages/dashboard/payments/PaymentsPage"), "PaymentsPage");
const UnitsPage = page(() => import("@/pages/dashboard/units/UnitsPage"), "UnitsPage");
const ResidentsPage = page(() => import("@/pages/dashboard/residents/ResidentsPage"), "ResidentsPage");
const AssemblyListPage = page(() => import("@/pages/dashboard/assembly/AssemblyListPage"), "AssemblyListPage");
const AssemblyDetailPage = page(() => import("@/pages/dashboard/assembly/AssemblyDetailPage"), "AssemblyDetailPage");
const DocumentsPage = page(() => import("@/pages/dashboard/documents/DocumentsPage"), "DocumentsPage");
const AssistantPage = page(() => import("@/pages/dashboard/assistant/AssistantPage"), "AssistantPage");
const IntegrationsPage = page(() => import("@/pages/dashboard/IntegrationsPage"), "IntegrationsPage");
const TeamPage = page(() => import("@/pages/dashboard/TeamPage"), "TeamPage");
const AuditPage = page(() => import("@/pages/dashboard/AuditPage"), "AuditPage");
const SettingsPage = page(() => import("@/pages/dashboard/settings/SettingsPage"), "SettingsPage");
const SupportOrganizationsPage = page(() => import("@/pages/support/SupportOrganizationsPage"), "SupportOrganizationsPage");
const SupportObservabilityPage = page(() => import("@/pages/support/SupportObservabilityPage"), "SupportObservabilityPage");
const SupportOrganizationDetailPage = page(
  () => import("@/pages/support/SupportOrganizationDetailPage"),
  "SupportOrganizationDetailPage"
);

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <InstallPromptProvider>
          <BrowserRouter>
            <AuthProvider>
              <OrganizationProvider>
                <Toaster richColors position="top-right" closeButton />
                <ErrorBoundary title="La aplicación no pudo cargar esta pantalla.">
                  <Suspense fallback={<FullscreenLoader />}>
                    <Routes>
                      <Route path="/" element={<Navigate to="/dashboard" replace />} />
                      <Route path="/login" element={<LoginPage />} />
                      <Route path="/register" element={<RegisterPage />} />
                      <Route path="/forgot-password" element={<ForgotPasswordPage />} />

                      <Route element={<RequireAuth />}>
                        <Route path="/onboarding" element={<OnboardingWizard />} />

                        <Route element={<RequireSupportStaff />}>
                          <Route path="/soporte" element={<SupportLayout />}>
                            <Route index element={<SupportOrganizationsPage />} />
                            <Route path="copropiedades/:orgId" element={<SupportOrganizationDetailPage />} />
                            <Route path="observabilidad" element={<SupportObservabilityPage />} />
                          </Route>
                        </Route>

                        <Route element={<RequireOrganization />}>
                          <Route path="/dashboard" element={<DashboardLayout />}>
                            <Route index element={<DashboardHome />} />
                            <Route element={<RequirePermission module="portfolio" />}>
                              <Route path="portfolio" element={<PortfolioPage />} />
                            </Route>
                            <Route element={<RequirePermission module="units" />}>
                              <Route path="units" element={<UnitsPage />} />
                            </Route>
                            <Route element={<RequirePermission module="team" />}>
                              <Route path="team" element={<TeamPage />} />
                            </Route>
                            <Route element={<RequirePermission permission="inbox.read" module="inbox" />}>
                              <Route path="inbox" element={<InboxPage />} />
                            </Route>
                            <Route element={<RequirePermission permission="pqrs.read" module="pqrs" />}>
                              <Route path="pqrs" element={<PqrsPage />} />
                            </Route>
                            <Route element={<RequirePermission permission="reservations.read" module="reservations" />}>
                              <Route path="reservations" element={<ReservationsPage />} />
                              <Route path="common-areas" element={<CommonAreasPage />} />
                            </Route>
                            <Route element={<RequirePermission permission="porteria.read" module="porteria" />}>
                              <Route path="gatehouse" element={<GatehousePage />} />
                            </Route>
                            <Route element={<RequirePermission permission="maintenance.read" module="maintenance" />}>
                              <Route path="maintenance" element={<MaintenancePage />} />
                            </Route>
                            <Route element={<RequirePermission permission="communications.read" module="communications" />}>
                              <Route path="announcements" element={<AnnouncementsPage />} />
                            </Route>
                            <Route element={<RequirePermission permission="finance.read" module="finance" />}>
                              <Route path="billing" element={<BillingPage />} />
                              <Route path="payments" element={<PaymentsPage />} />
                            </Route>
                            <Route element={<RequirePermission permission="residents.read" module="residents" />}>
                              <Route path="residents" element={<ResidentsPage />} />
                            </Route>
                            <Route element={<RequirePermission permission="assembly.read" module="assembly" />}>
                              <Route path="assembly" element={<AssemblyListPage />} />
                              <Route path="assembly/:id" element={<AssemblyDetailPage />} />
                            </Route>
                            <Route element={<RequirePermission permission="documents.read" module="documents" />}>
                              <Route path="documents" element={<DocumentsPage />} />
                            </Route>
                            <Route element={<RequirePermission permission="agent.manage" module="agent" />}>
                              <Route path="assistant" element={<AssistantPage />} />
                            </Route>
                            <Route element={<RequirePermission permission="integrations.manage" module="integrations" />}>
                              <Route path="integrations" element={<IntegrationsPage />} />
                            </Route>
                            <Route element={<RequirePermission permission="audit.read" module="audit" />}>
                              <Route path="audit" element={<AuditPage />} />
                            </Route>
                            <Route element={<RequirePermission permission="settings.manage" module="settings" />}>
                              <Route path="settings" element={<SettingsPage />} />
                            </Route>
                          </Route>
                        </Route>
                      </Route>

                      <Route path="*" element={<Navigate to="/dashboard" replace />} />
                    </Routes>
                  </Suspense>
                </ErrorBoundary>
              </OrganizationProvider>
            </AuthProvider>
          </BrowserRouter>
        </InstallPromptProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
