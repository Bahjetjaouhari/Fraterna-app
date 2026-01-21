import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Mail, Eye, EyeOff, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MasonicSymbol } from "@/components/icons/MasonicSymbol";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const { signIn, user, isVerified, profile, isLoading: authLoading } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Redirect if already logged in
  useEffect(() => {
    if (user && !authLoading) {
      if (isVerified) {
        navigate("/map");
      } else if (profile?.verification_status === 'pending') {
        navigate("/verification");
      } else if (profile?.verification_status === 'manual_review' || profile?.verification_status === 'blocked') {
        navigate("/verification");
      }
    }
  }, [user, isVerified, profile, authLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      toast.error("Por favor completa todos los campos");
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await signIn(email, password);

      if (error) {
        if (error.message.includes('Invalid login')) {
          toast.error("Credenciales incorrectas");
        } else {
          toast.error(error.message || "Error al iniciar sesión");
        }
        return;
      }

      toast.success("Bienvenido de vuelta, Q∴H∴");
      // Navigation handled by useEffect
    } catch (error) {
      toast.error("Error al iniciar sesión");
    } finally {
      setIsLoading(false);
    }
  };

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
          <h1 className="font-display text-3xl text-ivory mb-2">Fraterna</h1>
          <p className="text-ivory/60">Bienvenido de vuelta, Q∴H∴</p>
        </motion.div>

        {/* Form */}
        <motion.form
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          onSubmit={handleSubmit}
          className="w-full max-w-sm space-y-6"
        >
          {/* Email */}
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

          {/* Password */}
          <div className="space-y-2">
            <Label htmlFor="password" className="flex items-center gap-2 text-ivory/80">
              <Eye size={16} className="text-gold" />
              Contraseña
            </Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
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

          {/* Forgot Password */}
          <div className="text-right">
            <button
              type="button"
              className="text-sm text-gold hover:underline"
            >
              ¿Olvidaste tu contraseña?
            </button>
          </div>

          {/* Submit */}
          <Button
            type="submit"
            variant="masonic"
            size="xl"
            className="w-full"
            disabled={isLoading}
          >
            {isLoading ? "Ingresando..." : "Ingresar"}
            <ChevronRight size={20} />
          </Button>
        </motion.form>
      </div>

      {/* Footer */}
      <div className="px-8 pb-12 safe-area-bottom text-center">
        <p className="text-ivory/50 text-sm">
          ¿No tienes cuenta?{" "}
          <Link to="/register" className="text-gold hover:underline">
            Registrarse
          </Link>
        </p>
      </div>
    </div>
  );
};

export default Login;
