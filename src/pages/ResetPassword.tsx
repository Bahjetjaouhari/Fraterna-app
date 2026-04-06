import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Eye, EyeOff, Lock, Loader2, CheckCircle2, AlertTriangle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MasonicSymbol } from "@/components/icons/MasonicSymbol";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type ErrorType = "expired" | "invalid" | "none";

export const ResetPassword: React.FC = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isValidSession, setIsValidSession] = useState<boolean | null>(null);
  const [errorType, setErrorType] = useState<ErrorType>("none");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const checkSession = async () => {
      // Primero verificar si hay error en la URL (link expirado/inválido)
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const searchParams = new URLSearchParams(window.location.search);

      const errorCode = hashParams.get("error_code") || searchParams.get("error_code");
      const errorDescription = hashParams.get("error_description") || searchParams.get("error_description");
      const urlError = hashParams.get("error") || searchParams.get("error");

      if (urlError || errorCode) {
        console.log("Error in URL:", { errorCode, errorDescription, urlError });

        if (errorCode === "otp_expired" || errorDescription?.includes("expired")) {
          setErrorType("expired");
          setErrorMessage("Este enlace ha expirado. Los enlaces de recuperación son válidos por 1 hora.");
        } else if (urlError === "access_denied") {
          setErrorType("invalid");
          setErrorMessage("Este enlace no es válido. Por favor solicita uno nuevo.");
        } else {
          setErrorType("invalid");
          setErrorMessage(errorDescription || "Enlace inválido");
        }
        setIsValidSession(false);
        return;
      }

      // Verificar si hay una sesión activa
      const { data, error } = await supabase.auth.getSession();

      if (error || !data.session) {
        // Intentar obtener la sesión del hash de la URL
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");
        const type = hashParams.get("type");

        if (accessToken && type === "recovery") {
          // Establecer la sesión con el token
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || "",
          });

          if (sessionError) {
            toast.error("Enlace inválido o expirado");
            setIsValidSession(false);
          } else {
            setIsValidSession(true);
          }
        } else {
          setIsValidSession(false);
        }
      } else {
        setIsValidSession(true);
      }
    };

    checkSession();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!password || !confirmPassword) {
      toast.error("Por favor completa todos los campos");
      return;
    }

    if (password.length < 6) {
      toast.error("La contraseña debe tener al menos 6 caracteres");
      return;
    }

    if (password !== confirmPassword) {
      toast.error("Las contraseñas no coinciden");
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        toast.error(error.message || "Error al actualizar la contraseña");
        return;
      }

      toast.success("Contraseña actualizada exitosamente");

      // Cerrar sesión y redirigir al login
      await supabase.auth.signOut();

      setTimeout(() => {
        navigate("/login");
      }, 2000);
    } catch {
      toast.error("Error inesperado. Intenta de nuevo.");
    } finally {
      setIsLoading(false);
    }
  };

  // Loading state - verificando sesión
  if (isValidSession === null) {
    return (
      <div className="min-h-screen bg-navy flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-gold animate-spin" />
      </div>
    );
  }

  // Sesión inválida - link expirado o error
  if (isValidSession === false) {
    return (
      <div className="min-h-screen bg-navy flex flex-col items-center justify-center px-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-sm w-full text-center"
        >
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-destructive/20 flex items-center justify-center">
            {errorType === "expired" ? (
              <AlertTriangle className="w-10 h-10 text-warning" />
            ) : (
              <Lock className="w-10 h-10 text-destructive" />
            )}
          </div>

          <h1 className="font-display text-2xl text-ivory mb-4">
            {errorType === "expired" ? "Enlace Expirado" : "Enlace Inválido"}
          </h1>

          <p className="text-ivory/70 text-sm mb-6">
            {errorMessage || "Este enlace ha expirado o no es válido. Por favor solicita uno nuevo."}
          </p>

          <div className="p-4 rounded-lg bg-warning/10 border border-warning/30 mb-6">
            <p className="text-ivory/80 text-xs">
              Los enlaces de recuperación son válidos por <strong>1 hora</strong>. Si expiró, solicita uno nuevo.
            </p>
          </div>

          <Button
            variant="masonic"
            size="xl"
            className="w-full mb-4"
            onClick={() => navigate("/forgot-password")}
          >
            <Mail className="w-4 h-4 mr-2" />
            Solicitar Nuevo Enlace
          </Button>

          <button
            onClick={() => navigate("/login")}
            className="text-sm text-ivory/60 hover:text-ivory transition-colors"
          >
            Volver al Login
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-navy flex flex-col">
      {/* Header */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 pt-16">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gold/20 flex items-center justify-center">
            <Lock className="w-10 h-10 text-gold" />
          </div>
          <h1 className="font-display text-3xl text-ivory mb-2">
            Nueva Contraseña
          </h1>
          <p className="text-ivory/60">
            Crea una contraseña segura para tu cuenta
          </p>
        </motion.div>

        {/* Form */}
        <motion.form
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          onSubmit={handleSubmit}
          className="w-full max-w-sm space-y-6"
        >
          {/* Password */}
          <div className="space-y-2">
            <Label htmlFor="password" className="flex items-center gap-2 text-ivory/80">
              <Lock size={16} className="text-gold" />
              Nueva Contraseña
            </Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="input-masonic bg-navy-light border-navy-light text-ivory placeholder:text-ivory/40 pr-12"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-ivory/40 hover:text-ivory"
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          {/* Confirm Password */}
          <div className="space-y-2">
            <Label htmlFor="confirmPassword" className="flex items-center gap-2 text-ivory/80">
              <CheckCircle2 size={16} className="text-gold" />
              Confirmar Contraseña
            </Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repite la contraseña"
                className="input-masonic bg-navy-light border-navy-light text-ivory placeholder:text-ivory/40 pr-12"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-ivory/40 hover:text-ivory"
              >
                {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            variant="masonic"
            size="xl"
            className="w-full"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Actualizando...
              </>
            ) : (
              "Guardar Nueva Contraseña"
            )}
          </Button>
        </motion.form>
      </div>

      {/* Footer */}
      <div className="px-8 pb-8 safe-area-bottom text-center">
        <div className="flex items-center justify-center gap-1.5 opacity-70">
          <span className="text-gold text-[10px]">♔</span>
          <p className="text-gold/80 text-[10px] tracking-[0.15em] uppercase font-medium">
            Creada por INOVA
          </p>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;