import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  User, MapPin, Building2, Shield, Bell, Ghost,
  Eye, LogOut, ChevronRight, Check, Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { AppLayout } from "@/components/layout/AppLayout";
import { MasonicSymbol } from "@/components/icons/MasonicSymbol";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const proximityOptions = [
  { value: 1, label: "1 km" },
  { value: 5, label: "5 km" },
  { value: 10, label: "10 km" },
  { value: 0, label: "Desactivado" },
];

export const Profile: React.FC = () => {
  const navigate = useNavigate();
  const { profile, user, signOut, refreshProfile, isAdmin } = useAuth();
  const [isUpdating, setIsUpdating] = useState(false);

  const [proximityRadius, setProximityRadius] = useState<number>(
    profile?.proximity_radius_km ?? 5
  );
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(
    profile?.proximity_alerts_enabled ?? true
  );

  const updateProfileSetting = async (key: string, value: boolean) => {
    if (!user) return;

    setIsUpdating(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ [key]: value })
        .eq("id", user.id);

      if (error) throw error;

      await refreshProfile();
      toast.success("Configuración actualizada");
    } catch (error) {
      console.error("Error updating profile:", error);
      toast.error("Error al actualizar configuración");
    } finally {
      setIsUpdating(false);
    }
  };

  const updateProfileValue = async (key: string, value: number | boolean) => {
    if (!user) return;

    setIsUpdating(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ [key]: value })
        .eq("id", user.id);

      if (error) throw error;

      await refreshProfile();
      toast.success("Configuración actualizada");
    } catch (error) {
      console.error("Error updating profile:", error);
      toast.error("Error al actualizar configuración");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  if (!profile) {
    return (
      <AppLayout showNav={true} isAdmin={isAdmin}>
        <div className="min-h-screen bg-background flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-gold animate-spin" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout showNav={true} isAdmin={isAdmin}>
      <div className="min-h-screen bg-background pb-24">
        {/* Header */}
        <div className="bg-navy pt-12 pb-8 px-6 safe-area-top">
          <div className="flex items-center gap-4">
            <div className="avatar-masonic w-20 h-20 flex items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-navy-light flex items-center justify-center">
                <MasonicSymbol size={40} className="text-gold" />
              </div>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h1 className="font-display text-xl text-ivory">{profile.full_name}</h1>
                {profile.is_verified && (
                  <div className="w-5 h-5 rounded-full bg-success flex items-center justify-center">
                    <Check size={12} className="text-white" />
                  </div>
                )}
              </div>
              <p className="text-ivory/60 text-sm">{profile.email}</p>
              <div className="flex items-center gap-2 mt-1">
                <MapPin size={12} className="text-gold" />
                <span className="text-ivory/60 text-sm">
                  {profile.city}, {profile.country}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-6 space-y-6">
          {/* Profile Info */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-masonic p-4 space-y-4"
          >
            <h2 className="font-display text-lg flex items-center gap-2">
              <User size={18} className="text-gold" />
              Información Personal
            </h2>

            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-muted-foreground">Logia</span>
                <span className="flex items-center gap-2">
                  <Building2 size={16} className="text-gold" />
                  {profile.lodge}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-muted-foreground">Estado</span>
                {profile.is_verified ? (
                  <span className="badge-verified">
                    <Shield size={12} />
                    Verificado
                  </span>
                ) : (
                  <span className="text-warning text-sm">Pendiente</span>
                )}
              </div>
              {profile.phone && (
                <div className="flex items-center justify-between py-2 border-b border-border">
                  <span className="text-muted-foreground">Teléfono</span>
                  <span>{profile.phone}</span>
                </div>
              )}
            </div>

            <Button variant="outline" className="w-full">
              Editar Perfil
              <ChevronRight size={16} />
            </Button>
          </motion.div>

          {/* Privacy Settings */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="card-masonic p-4 space-y-4"
          >
            <h2 className="font-display text-lg flex items-center gap-2">
              <Eye size={18} className="text-gold" />
              Privacidad
            </h2>

            {/* Tracking Toggle */}
            <div className="flex items-center justify-between py-3 border-b border-border">
              <div className="flex items-center gap-3">
                <MapPin size={20} className="text-gold" />
                <div>
                  <p className="font-medium">Tracking de Ubicación</p>
                  <p className="text-sm text-muted-foreground">
                    Permite que otros Q∴H∴ te vean en el mapa
                  </p>
                </div>
              </div>
              <Switch
                checked={profile.tracking_enabled}
                onCheckedChange={(checked) => updateProfileSetting("tracking_enabled", checked)}
                disabled={isUpdating}
              />
            </div>

            {/* Stealth Mode */}
            <div className="flex items-center justify-between py-3 border-b border-border">
              <div className="flex items-center gap-3">
                <Ghost size={20} className="text-gold" />
                <div>
                  <p className="font-medium">Modo Fantasma</p>
                  <p className="text-sm text-muted-foreground">
                    Tu avatar se muestra transparente y ubicación congelada
                  </p>
                </div>
              </div>
              <Switch
                checked={profile.stealth_mode}
                onCheckedChange={(checked) => updateProfileSetting("stealth_mode", checked)}
                disabled={isUpdating}
              />
            </div>
          </motion.div>

          {/* Notifications */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="card-masonic p-4 space-y-4"
          >
            <h2 className="font-display text-lg flex items-center gap-2">
              <Bell size={18} className="text-gold" />
              Notificaciones
            </h2>

            {/* Proximity Notifications */}
            <div className="flex items-center justify-between py-3 border-b border-border">
              <div>
                <p className="font-medium">Alertas de Cercanía</p>
                <p className="text-sm text-muted-foreground">
                  Notificarte cuando un Q∴H∴ esté cerca
                </p>
              </div>
              <Switch
                checked={notificationsEnabled}
                onCheckedChange={(checked) => {
                  setNotificationsEnabled(checked);
                  updateProfileValue("proximity_alerts_enabled", checked);
                }}
                disabled={isUpdating}
              />
            </div>

            {/* Proximity Radius */}
            {notificationsEnabled && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="space-y-3"
              >
                <p className="text-sm font-medium">Radio de proximidad</p>
                <div className="grid grid-cols-4 gap-2">
                  {proximityOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setProximityRadius(option.value);
                        updateProfileValue("proximity_radius_km", option.value);
                      }}
                      className={`py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                        proximityRadius === option.value
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </motion.div>

          {/* Logout */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <Button
              variant="outline"
              className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={handleSignOut}
            >
              <LogOut size={18} />
              Cerrar Sesión
            </Button>
          </motion.div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Profile;
