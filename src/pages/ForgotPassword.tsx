import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Mail, ArrowLeft, MailCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MasonicSymbol } from "@/components/icons/MasonicSymbol";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const ForgotPassword: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email) {
      toast.error("Por favor ingresa tu correo electrónico");
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: "https://fraterna-app.pages.dev/reset-password",
      });

      if (error) {
        if (error.message.includes("not found")) {
          // Por seguridad, no revelamos si el email existe o no
          setEmailSent(true);
        } else {
          toast.error(error.message || "Error al enviar el correo");
        }
      } else {
        setEmailSent(true);
        toast.success("Correo enviado exitosamente");
      }
    } catch {
      toast.error("Error inesperado. Intenta de nuevo.");
    } finally {
      setIsLoading(false);
    }
  };

  if (emailSent) {
    return (
      <div className="min-h-screen bg-navy flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center max-w-sm"
          >
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-success/20 flex items-center justify-center">
              <MailCheck className="w-10 h-10 text-success" />
            </div>

            <h1 className="font-display text-2xl text-ivory mb-4">
              Revisa tu Correo
            </h1>

            <p className="text-ivory/70 text-sm mb-6">
              Hemos enviado un enlace para restablecer tu contraseña a{" "}
              <span className="text-gold font-medium">{email}</span>
            </p>

            <div className="p-4 rounded-lg bg-navy-light/50 border border-gold/20 mb-6">
              <p className="text-ivory/60 text-xs">
                El enlace expirará en 1 hora. Si no lo encuentras, revisa tu carpeta de spam.
              </p>
            </div>

            <Button
              variant="masonic"
              size="lg"
              className="w-full mb-4"
              onClick={() => navigate("/login")}
            >
              Volver al Login
            </Button>

            <button
              onClick={() => {
                setEmailSent(false);
                setEmail("");
              }}
              className="text-sm text-gold hover:underline"
            >
              Enviar a otro correo
            </button>
          </motion.div>
        </div>

        {/* Footer */}
        <div className="px-8 pb-8 text-center">
          <div className="flex items-center justify-center gap-1.5 opacity-70">
            <span className="text-gold text-[10px]">♔</span>
            <p className="text-gold/80 text-[10px] tracking-[0.15em] uppercase font-medium">
              Creada por INOVA
            </p>
          </div>
        </div>
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
          <MasonicSymbol size={80} className="text-gold mx-auto mb-6" />
          <h1 className="font-display text-3xl text-ivory mb-2">
            ¿Olvidaste tu Contraseña?
          </h1>
          <p className="text-ivory/60">
            Te enviaremos un enlace para restablecerla
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
          <div className="space-y-2">
            <Label htmlFor="email" className="flex items-center gap-2 text-ivory/80">
              <Mail size={16} className="text-gold" />
              Correo electrónico
            </Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@email.com"
              className="input-masonic bg-navy-light border-navy-light text-ivory placeholder:text-ivory/40"
              required
            />
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
                Enviando...
              </>
            ) : (
              "Enviar Enlace"
            )}
          </Button>

          <Link
            to="/login"
            className="flex items-center justify-center gap-2 text-sm text-ivory/60 hover:text-ivory transition-colors"
          >
            <ArrowLeft size={16} />
            Volver al Login
          </Link>
        </motion.form>
      </div>

      {/* Footer */}
      <div className="px-8 pb-8 text-center">
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

export default ForgotPassword;