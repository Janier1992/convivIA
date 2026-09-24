import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "./AuthLayout";

const schema = z.object({
  fullName: z.string().min(2, "Ingresa tu nombre completo"),
  email: z.string().email("Ingresa un correo válido"),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres")
});

type FormValues = z.infer<typeof schema>;

export function RegisterPage() {
  const { signUp, verifyEmailCode, resendVerificationEmail } = useAuth();
  const navigate = useNavigate();
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [verifying, setVerifying] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormValues) => {
    try {
      const result = await signUp(values.email, values.password, values.fullName);
      if (result.requireEmailVerification) {
        setPendingEmail(values.email);
        toast.info("Te enviamos un código de verificación a tu email.");
      } else {
        toast.success("Cuenta creada. ¡Bienvenido!");
        navigate("/onboarding", { replace: true });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo crear la cuenta.");
    }
  };

  const onVerify = async () => {
    if (!pendingEmail || otp.length < 4) return;
    setVerifying(true);
    try {
      await verifyEmailCode(pendingEmail, otp);
      toast.success("Email verificado. ¡Bienvenido!");
      navigate("/onboarding", { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Código inválido o expirado.");
    } finally {
      setVerifying(false);
    }
  };

  if (pendingEmail) {
    return (
      <AuthLayout title="Verifica tu correo" subtitle={`Ingresa el código que enviamos a ${pendingEmail}`}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="otp">Código de verificación</Label>
            <Input id="otp" value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="123456" maxLength={6} />
          </div>
          <Button className="w-full" onClick={onVerify} disabled={verifying}>
            {verifying ? "Verificando..." : "Verificar y continuar"}
          </Button>
          <button
            type="button"
            className="w-full text-center text-sm text-primary hover:underline"
            onClick={() => resendVerificationEmail(pendingEmail).then(() => toast.success("Código reenviado."))}
          >
            Reenviar código
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Crear cuenta" subtitle="Empieza a administrar tu copropiedad">
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <div className="space-y-1.5">
          <Label htmlFor="fullName">Nombre completo</Label>
          <Input id="fullName" autoComplete="name" {...register("fullName")} />
          {errors.fullName && <p className="text-xs text-destructive">{errors.fullName.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" {...register("email")} />
          {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Contraseña</Label>
          <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
          {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
        </div>
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Creando cuenta..." : "Crear cuenta"}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        ¿Ya tienes cuenta?{" "}
        <Link to="/login" className="font-medium text-primary hover:underline">
          Inicia sesión
        </Link>
      </p>
    </AuthLayout>
  );
}
