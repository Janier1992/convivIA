import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Building2 } from "lucide-react";
import { errorMessage, rpc } from "@/lib/rpc";
import { slugify } from "@/lib/slug";
import { PROPERTY_TYPE_LABELS } from "@/lib/labels";
import { useAuth } from "@/hooks/useAuth";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ThemeToggle } from "@/components/ThemeToggle";

const PROPERTY_TYPES = Object.keys(PROPERTY_TYPE_LABELS).filter((k) => k !== "other").concat("other");
const TIMEZONES = ["America/Bogota", "America/Mexico_City", "America/Lima", "America/Santiago"];

/** Registrar la primera copropiedad de la cuenta: crea el tenant, el perfil, el asistente y los catálogos por defecto en un solo paso atómico. */
export function OnboardingWizard() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { refetch, setCurrentOrganizationId } = useOrganization();
  const [name, setName] = useState("");
  const [propertyType, setPropertyType] = useState("residential_complex");
  const [city, setCity] = useState("");
  const [timezone, setTimezone] = useState("America/Bogota");
  const [saving, setSaving] = useState(false);

  async function create() {
    if (name.trim().length < 3) return toast.error("Escribe el nombre de la copropiedad.");
    setSaving(true);
    try {
      const org = await rpc<{ id: string }>("create_organization_with_owner", {
        p_name: name.trim(),
        p_slug: slugify(name),
        p_property_type: propertyType,
        p_timezone: timezone,
        p_city: city.trim() || null
      });
      await refetch();
      setCurrentOrganizationId(org.id);
      toast.success("¡Copropiedad creada! Ya puedes empezar a configurarla.");
      navigate("/dashboard", { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      <ThemeToggle className="absolute right-4 top-4" />
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="brand-gradient flex h-12 w-12 items-center justify-center rounded-xl text-white">
            <Building2 className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold">Registra tu copropiedad</h1>
          <p className="text-sm text-muted-foreground">Un conjunto residencial, edificio o condominio en Colombia.</p>
        </div>
        <div className="space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm">
          <div className="space-y-1.5">
            <Label htmlFor="onb-name">Nombre de la copropiedad</Label>
            <Input id="onb-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Conjunto Residencial Los Almendros" />
          </div>
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={propertyType} onValueChange={setPropertyType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PROPERTY_TYPES.map((t) => <SelectItem key={t} value={t}>{PROPERTY_TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="onb-city">Ciudad</Label>
              <Input id="onb-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Medellín" />
            </div>
            <div className="space-y-1.5">
              <Label>Zona horaria</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TIMEZONES.map((tz) => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <Button className="w-full" onClick={create} disabled={saving}>{saving ? "Creando..." : "Crear copropiedad"}</Button>
        </div>
        <div className="flex justify-center">
          <button onClick={() => signOut()} className="text-sm text-muted-foreground hover:underline">Cerrar sesión</button>
        </div>
      </div>
    </div>
  );
}
