import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { User, Mail, Phone, MapPin, Building2, Camera, ChevronRight, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MasonicSymbol } from "@/components/icons/MasonicSymbol";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

interface RegisterFormData {
  fullName: string;
  email: string;
  password: string;
  phone: string;
  country: string;
  city: string;
  lodge: string;
  photoUrl?: string;
}

export const Register: React.FC = () => {
  const navigate = useNavigate();
  const { signUp } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<RegisterFormData>({
    fullName: "",
    email: "",
    password: "",
    phone: "",
    country: "Venezuela",
    city: "",
    lodge: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Basic validation
    if (!formData.fullName || !formData.email || !formData.password) {
      toast.error("Por favor completa los campos requeridos");
      return;
    }

    if (formData.password.length < 6) {
      toast.error("La contraseña debe tener al menos 6 caracteres");
      return;
    }

    if (!formData.city || !formData.lodge) {
      toast.error("Por favor indica tu ciudad y logia");
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await signUp(formData.email, formData.password, {
        full_name: formData.fullName,
        city: formData.city,
        lodge: formData.lodge,
        country: formData.country || 'Venezuela',
        phone: formData.phone || '',
      });

      if (error) {
        if (error.message.includes('already registered')) {
          toast.error("Este correo ya está registrado");
        } else {
          toast.error(error.message || "Error al crear la cuenta");
        }
        return;
      }

      toast.success("Cuenta creada. Procede con la verificación masónica.");
      navigate("/verification");
    } catch (error) {
      toast.error("Error al crear la cuenta");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-navy pt-12 pb-8 px-6">
        <Link to="/onboarding" className="text-ivory/60 text-sm mb-4 inline-block">
          ← Volver
        </Link>
        <div className="flex items-center gap-3">
          <MasonicSymbol size={40} className="text-gold" />
          <div>
            <h1 className="font-display text-2xl text-ivory">Registro</h1>
            <p className="text-ivory/60 text-sm">Crea tu cuenta en Fraterna</p>
          </div>
        </div>
      </div>

      {/* Form */}
      <motion.form
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        onSubmit={handleSubmit}
        className="px-6 py-8 space-y-6"
      >
        {/* Photo Upload */}
        <div className="flex justify-center">
          <button
            type="button"
            className="relative w-24 h-24 rounded-full bg-muted border-2 border-dashed border-gold/30 flex items-center justify-center hover:border-gold/60 transition-colors"
          >
            <Camera className="w-8 h-8 text-muted-foreground" />
            <span className="absolute -bottom-6 text-xs text-muted-foreground">
              Foto (opcional)
            </span>
          </button>
        </div>

        {/* Name */}
        <div className="space-y-2 pt-4">
          <Label htmlFor="fullName" className="flex items-center gap-2 text-foreground">
            <User size={16} className="text-gold" />
            Nombre completo *
          </Label>
          <Input
            id="fullName"
            name="fullName"
            value={formData.fullName}
            onChange={handleChange}
            placeholder="Tu nombre real"
            className="input-masonic"
            required
          />
        </div>

        {/* Email */}
        <div className="space-y-2">
          <Label htmlFor="email" className="flex items-center gap-2 text-foreground">
            <Mail size={16} className="text-gold" />
            Correo electrónico *
          </Label>
          <Input
            id="email"
            name="email"
            type="email"
            value={formData.email}
            onChange={handleChange}
            placeholder="tu@email.com"
            className="input-masonic"
            required
          />
        </div>

        {/* Password */}
        <div className="space-y-2">
          <Label htmlFor="password" className="flex items-center gap-2 text-foreground">
            <Eye size={16} className="text-gold" />
            Contraseña *
          </Label>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              value={formData.password}
              onChange={handleChange}
              placeholder="Mínimo 6 caracteres"
              className="input-masonic pr-12"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
        </div>

        {/* Phone */}
        <div className="space-y-2">
          <Label htmlFor="phone" className="flex items-center gap-2 text-foreground">
            <Phone size={16} className="text-gold" />
            Teléfono
          </Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            value={formData.phone}
            onChange={handleChange}
            placeholder="+58 424 123 4567"
            className="input-masonic"
          />
        </div>

        {/* Country & City */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="country" className="flex items-center gap-2 text-foreground">
              <MapPin size={16} className="text-gold" />
              País *
            </Label>
            <Input
              id="country"
              name="country"
              value={formData.country}
              onChange={handleChange}
              placeholder="Venezuela"
              className="input-masonic"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="city" className="text-foreground">Ciudad *</Label>
            <Input
              id="city"
              name="city"
              value={formData.city}
              onChange={handleChange}
              placeholder="Caracas"
              className="input-masonic"
              required
            />
          </div>
        </div>

        {/* Lodge */}
        <div className="space-y-2">
          <Label htmlFor="lodge" className="flex items-center gap-2 text-foreground">
            <Building2 size={16} className="text-gold" />
            Logia *
          </Label>
          <Input
            id="lodge"
            name="lodge"
            value={formData.lodge}
            onChange={handleChange}
            placeholder="Nombre de tu Logia"
            className="input-masonic"
            required
          />
        </div>

        {/* Submit */}
        <div className="pt-4 space-y-4">
          <Button
            type="submit"
            variant="masonic"
            size="xl"
            className="w-full"
            disabled={isLoading}
          >
            {isLoading ? "Creando cuenta..." : "Continuar a Verificación"}
            <ChevronRight size={20} />
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            ¿Ya tienes cuenta?{" "}
            <Link to="/login" className="text-gold hover:underline">
              Iniciar sesión
            </Link>
          </p>
        </div>
      </motion.form>
    </div>
  );
};

export default Register;
