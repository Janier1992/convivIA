import { useOrganization } from "@/hooks/useOrganization";
import { PushNotificationsCard } from "@/components/PushNotificationsCard";
import { SubscriptionCard } from "@/components/SubscriptionCard";
import { PageHeader } from "@/components/PageHeader";
import { GeneralSettingsCard } from "./GeneralSettingsCard";
import { FinanceSettingsCard } from "./FinanceSettingsCard";
import { ChargeConceptsCard } from "./ChargeConceptsCard";
import { PqrsCategoriesCard } from "./PqrsCategoriesCard";

export function SettingsPage() {
  const { currentOrganizationId, currentRole } = useOrganization();
  const readOnly = currentRole !== "owner" && currentRole !== "admin";

  if (!currentOrganizationId) return null;

  return (
    <div className="space-y-6">
      <PageHeader title="Configuración" description="Datos de la copropiedad, cartera, conceptos de cobro y categorías de PQRS." />
      <GeneralSettingsCard readOnly={readOnly} />
      <FinanceSettingsCard readOnly={readOnly} />
      <ChargeConceptsCard readOnly={readOnly} />
      <PqrsCategoriesCard readOnly={readOnly} />
      <PushNotificationsCard organizationId={currentOrganizationId} />
      <SubscriptionCard organizationId={currentOrganizationId} />
    </div>
  );
}
