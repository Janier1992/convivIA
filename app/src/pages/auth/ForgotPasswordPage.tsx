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

const emailSchema = z.object({ email: z.string().email("Ingresa un correo válido") });
type EmailValues = z.infer<typeof emailSchema>;

export function ForgotPasswordPage() {
  const { sendPasswordReset, exchangeResetCode, resetPassword } = useAuth();
  const navigate = useNavigate();
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<EmailValues>({ resolver: zodResolver(emailSchema) });

  const onSendCode = async (values: EmailValues) => {
    try {
      await sendPasswordReset(values.email);
      setPendingEmail(values.email);
      toast.success("Te enviamos un código para restablecer tu contraseña.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo enviar el código.");
    }
  };

  const onResetPassword = async () => {
    if (!pendingEmail || code.length < 4 || newPassword.length < 6) return;
    setSubmitting(true);
    try {
      const token = await exchangeResetCode(pendingEmail, code);
      await resetPassword(newPassword, token);
      toast.success("Contraseña actualizada. Inicia sesión con tu nueva contraseña.");
      navigate("/login", { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo restablecer la contraseña.");
    } finally {
      setSubmitting(false);
    }
  };

  if (pendingEmail) {
    return (
      <AuthLayout title="Nueva contraseña" subtitle={`Ingresa el código enviado a ${pendingEmail} y tu nueva contraseña`}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="code">Código</Label>
            <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" maxLength={6} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="newPassword">Nueva contraseña</Label>
            <Input id="newPassword" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <Button className="w-full" onClick={onResetPassword} disabled={submitting}>
            {submitting ? "Guardando..." : "Restablecer contraseña"}
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Recuperar contraseña" subtitle="Te enviaremos un código por email">
      <form className="space-y-4" onSubmit={handleSubmit(onSendCode)}>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" {...register("email")} />
          {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
        </div>
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Enviando..." : "Enviar código"}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        <Link to="/login" className="font-medium text-primary hover:underline">
          Volver a iniciar sesión
        </Link>
      </p>
    </AuthLayout>
  );
}
