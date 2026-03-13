import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  User,
  MapPin,
  Building2,
  Shield,
  Bell,
  Ghost,
  Eye,
  LogOut,
  ChevronRight,
  Check,
  Loader2,
  Pencil,
  Save,
  Phone,
  Camera,
  Crown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { AppLayout } from "@/components/layout/AppLayout";
import { MasonicSymbol } from "@/components/icons/MasonicSymbol";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { resizeImageForAvatar } from "@/utils/resizeImage";
import { toast } from "sonner";

const proximityOptions = [
  { value: 1, label: "1 km" },
  { value: 5, label: "5 km" },
  { value: 10, label: "10 km" },
  { value: 15, label: "15 km" },
  { value: 25, label: "25 km" },
];

export const Profile: React.FC = () => {
  const navigate = useNavigate();
  const { profile, user, signOut, refreshProfile, isAdmin } = useAuth();
  const [isUpdating, setIsUpdating] = useState(false);

  // Edit mode
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editLodge, setEditLodge] = useState("");
  const [editCity, setEditCity] = useState("");
  const [editPhone, setEditPhone] = useState("");

  // Photo upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  const avatarInitials = useMemo(() => {
    const name = profile?.full_name || "";
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] ?? "?";
    const b = parts.length > 1 ? parts[parts.length - 1]?.[0] : "";
    return (a + b).toUpperCase();
  }, [profile?.full_name]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error("La imagen no puede superar 5MB");
      return;
    }

    setIsUploadingPhoto(true);
    try {
      const ext = "jpg"; // always JPEG after resize
      const filePath = `${user.id}/avatar.${ext}`;

      // Resize for crisp avatar display
      const resizedFile = await resizeImageForAvatar(file, 512, 0.92);

      // Upload (upsert)
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, resizedFile, { upsert: true, contentType: "image/jpeg" });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(filePath);
      const photoUrl = urlData.publicUrl + "?t=" + Date.now(); // cache bust

      // Update profile
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ photo_url: photoUrl })
        .eq("id", user.id);

      if (updateError) throw updateError;

      await refreshProfile();
      toast.success("Foto actualizada");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error("Photo upload error:", err);
      toast.error("No se pudo subir la foto: " + (err?.message || "error"));
    } finally {
      setIsUploadingPhoto(false);
      // Reset input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Friends allowlist (for 'friends_selected')
  const [friends, setFriends] = useState<Array<{ id: string; full_name: string | null }>>([]);
  const [allowedIds, setAllowedIds] = useState<string[]>([]);
  const [isLoadingFriends, setIsLoadingFriends] = useState(false);

  const [proximityRadius, setProximityRadius] = useState<number>(
    profile?.proximity_radius_km ?? 5
  );
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(
    profile?.proximity_alerts_enabled ?? true
  );

  const loadFriendsAndAllowlist = useCallback(async () => {
    if (!user) return;
    setIsLoadingFriends(true);

    try {
      const { data: friendships, error: friendshipsError } = await supabase
        .from("friendships")
        .select("requester_id, addressee_id, status")
        .eq("status", "accepted")
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);

      if (friendshipsError) throw friendshipsError;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const friendIds = (friendships || []).map((f: any) =>
        f.requester_id === user.id ? f.addressee_id : f.requester_id
      );

      if (friendIds.length === 0) {
        setFriends([]);
        setAllowedIds([]);
        return;
      }

      const { data: friendProfiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", friendIds);

      if (profilesError) throw profilesError;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setFriends((friendProfiles || []) as any);

      // ✅ FIX: tu tabla usa viewer_id, no allowed_user_id
      const { data: allowlist, error: allowlistError } = await supabase
        .from("location_allowlist")
        .select("viewer_id")
        .eq("owner_id", user.id);

      if (allowlistError) throw allowlistError;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setAllowedIds((allowlist || []).map((a: any) => a.viewer_id));
    } catch (error) {
      console.error("Error loading friends/allowlist:", error);
      toast.error("No se pudo cargar tu lista de amigos");
    } finally {
      setIsLoadingFriends(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user || !profile) return;
    loadFriendsAndAllowlist();
  }, [user, profile, loadFriendsAndAllowlist]);

  const toggleAllowedFriend = async (friendId: string, makeAllowed: boolean) => {
    if (!user) return;

    try {
      if (makeAllowed) {
        // ✅ FIX: insertar owner_id + viewer_id (y upsert por si ya existe)
        const { error } = await supabase.from("location_allowlist").upsert(
          {
            owner_id: user.id,
            viewer_id: friendId,
          },
          { onConflict: "owner_id,viewer_id", ignoreDuplicates: true }
        );

        if (error) throw error;
        setAllowedIds((prev) => (prev.includes(friendId) ? prev : [...prev, friendId]));
      } else {
        // ✅ FIX: borrar por viewer_id
        const { error } = await supabase
          .from("location_allowlist")
          .delete()
          .eq("owner_id", user.id)
          .eq("viewer_id", friendId);

        if (error) throw error;
        setAllowedIds((prev) => prev.filter((id) => id !== friendId));
      }
    } catch (error) {
      console.error("Error updating allowlist:", error);
      toast.error("No se pudo actualizar la lista de permitidos");
    }
  };

  const updateProfileSetting = async (key: string, value: boolean) => {
    if (!user) return;

    setIsUpdating(true);
    try {
      const { error } = await supabase.from("profiles").update({ [key]: value }).eq("id", user.id);
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
      const { error } = await supabase.from("profiles").update({ [key]: value }).eq("id", user.id);
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

  const startEditing = () => {
    setEditName(profile?.full_name || "");
    setEditLodge(profile?.lodge || "");
    setEditCity(profile?.city || "");
    setEditPhone(profile?.phone || "");
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
  };

  const saveProfile = async () => {
    if (!user) return;
    setIsUpdating(true);
    try {
      const updates: Record<string, string> = {};
      if (editName.trim()) updates.full_name = editName.trim();
      if (editLodge.trim() !== (profile?.lodge || "")) updates.lodge = editLodge.trim();
      if (editCity.trim() !== (profile?.city || "")) updates.city = editCity.trim();
      if (editPhone.trim() !== (profile?.phone || "")) updates.phone = editPhone.trim();

      if (Object.keys(updates).length === 0) {
        setIsEditing(false);
        return;
      }

      const { error } = await supabase.from("profiles").update(updates).eq("id", user.id);
      if (error) throw error;

      await refreshProfile();
      toast.success("Perfil actualizado correctamente");
      setIsEditing(false);
    } catch (error) {
      console.error("Error updating profile:", error);
      toast.error("Error al actualizar el perfil");
    } finally {
      setIsUpdating(false);
    }
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
      <div className="min-h-screen bg-map-bg pb-24">
        {/* Header */}
        <div className="bg-navy pt-12 pb-8 px-6 safe-area-top">
          <div className="flex items-center gap-4">
            <div className="relative group">
              {profile.photo_url ? (
                <img
                  src={profile.photo_url}
                  alt={profile.full_name || "Avatar"}
                  className="w-20 h-20 rounded-full object-cover border-2 border-gold/40"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-gold/15 border-2 border-gold/40 flex items-center justify-center">
                  <span className="text-gold font-bold text-2xl">{avatarInitials}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingPhoto}
                className="absolute inset-0 w-20 h-20 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              >
                {isUploadingPhoto ? (
                  <Loader2 className="w-6 h-6 text-white animate-spin" />
                ) : (
                  <Camera className="w-6 h-6 text-white" />
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handlePhotoUpload}
                className="hidden"
              />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h1 className="font-display text-xl text-ivory">{profile.full_name}</h1>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                {profile.is_verified && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success/20 text-success text-[10px] font-semibold">
                    <Check size={10} />
                    Verificado
                  </span>
                )}
                {isAdmin && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gold/20 text-gold text-[10px] font-semibold">
                    <Crown size={10} />
                    Admin
                  </span>
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

            {isEditing ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Nombre completo</label>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Tu nombre completo"
                    className="w-full px-3 py-2 rounded-md bg-navy/60 border border-gold/20 text-ivory placeholder:text-ivory/40 focus:outline-none focus:ring-2 focus:ring-gold/40 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Building2 size={12} className="text-gold" /> Logia
                  </label>
                  <input
                    value={editLodge}
                    onChange={(e) => setEditLodge(e.target.value)}
                    placeholder="Nombre de tu logia"
                    className="w-full px-3 py-2 rounded-md bg-navy/60 border border-gold/20 text-ivory placeholder:text-ivory/40 focus:outline-none focus:ring-2 focus:ring-gold/40 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin size={12} className="text-gold" /> Ciudad
                  </label>
                  <input
                    value={editCity}
                    onChange={(e) => setEditCity(e.target.value)}
                    placeholder="Tu ciudad"
                    className="w-full px-3 py-2 rounded-md bg-navy/60 border border-gold/20 text-ivory placeholder:text-ivory/40 focus:outline-none focus:ring-2 focus:ring-gold/40 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Phone size={12} className="text-gold" /> Teléfono
                  </label>
                  <input
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    placeholder="+58 412 1234567"
                    className="w-full px-3 py-2 rounded-md bg-navy/60 border border-gold/20 text-ivory placeholder:text-ivory/40 focus:outline-none focus:ring-2 focus:ring-gold/40 text-sm"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={saveProfile}
                    disabled={isUpdating}
                    className="flex-1 bg-gold hover:bg-gold/90 text-navy font-semibold"
                  >
                    {isUpdating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save size={16} className="mr-2" />}
                    Guardar
                  </Button>
                  <Button
                    variant="outline"
                    onClick={cancelEditing}
                    disabled={isUpdating}
                    className="border-gold/30 text-gold hover:bg-gold/10 hover:text-gold font-semibold"
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  <div className="flex items-center justify-between py-2 border-b border-border">
                    <span className="text-muted-foreground">Logia</span>
                    <span className="flex items-center gap-2">
                      <Building2 size={16} className="text-gold" />
                      {profile.lodge || <span className="text-ivory/60 italic">Sin logia</span>}
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
                  <div className="flex items-center justify-between py-2 border-b border-border">
                    <span className="text-muted-foreground">Teléfono</span>
                    <span className="flex items-center gap-2">
                      <Phone size={16} className="text-gold" />
                      {profile.phone || <span className="text-ivory/40 italic">No configurado</span>}
                    </span>
                  </div>
                </div>

                <Button
                  onClick={startEditing}
                  variant="outline"
                  className="w-full border-gold/30 text-gold hover:bg-gold/10 hover:text-gold font-semibold"
                >
                  <Pencil size={16} className="mr-2" />
                  Editar Perfil
                </Button>
              </>
            )}
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

            {/* Visibilidad de ubicación */}
            <div className="space-y-2 py-3 border-b border-border">
              <label className="text-sm font-medium">¿Quién puede ver tu ubicación?</label>

              <select
                value={profile?.location_visibility_mode ?? "friends"}
                onChange={async (e) => {
                  const mode = e.target.value as "public" | "friends" | "friends_selected";

                  setIsUpdating(true);
                  try {
                    const { error } = await supabase
                      .from("profiles")
                      .update({ location_visibility_mode: mode })
                      .eq("id", user?.id);

                    if (error) throw error;

                    await refreshProfile();
                    toast.success("Configuración actualizada");
                  } catch (error) {
                    console.error("Error updating visibility mode:", error);
                    toast.error("Error al actualizar configuración");
                  } finally {
                    setIsUpdating(false);
                  }
                }}
                className="w-full rounded-md border px-3 py-2 text-sm bg-background"
                disabled={isUpdating}
              >
                <option value="public">Público (todos los Q∴H∴)</option>
                <option value="friends">Solo amigos</option>
                <option value="friends_selected">Amigos seleccionados</option>
              </select>

              <p className="text-xs text-muted-foreground">Controla quién puede verte en el mapa.</p>
            </div>

            {/* Allowlist UI - only for friends_selected */}
            {profile?.location_visibility_mode === "friends_selected" && (
              <div className="py-3 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm">Amigos permitidos</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadFriendsAndAllowlist}
                    disabled={isUpdating || isLoadingFriends}
                  >
                    {isLoadingFriends ? <Loader2 className="w-4 h-4 animate-spin" /> : "Actualizar"}
                  </Button>
                </div>

                {isLoadingFriends && <p className="text-xs text-muted-foreground">Cargando...</p>}

                {!isLoadingFriends && friends.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No tienes amigos aceptados todavía.
                  </p>
                )}

                <div className="space-y-2">
                  {friends.map((f) => {
                    const name = f.full_name?.trim() || "Sin nombre";
                    const isAllowed = allowedIds.includes(f.id);

                    return (
                      <div
                        key={f.id}
                        className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                      >
                        <span className="text-sm">{name}</span>
                        <input
                          type="checkbox"
                          checked={isAllowed}
                          onChange={(e) => toggleAllowedFriend(f.id, e.target.checked)}
                        />
                      </div>
                    );
                  })}
                </div>

                <p className="text-xs text-muted-foreground">
                  Solo los amigos marcados podrán verte cuando uses “Amigos seleccionados”.
                </p>
              </div>
            )}
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
                <div className="flex flex-wrap gap-2">
                  {proximityOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setProximityRadius(option.value);
                        updateProfileValue("proximity_radius_km", option.value);
                      }}
                      className={`flex-1 min-w-[80px] whitespace-nowrap py-2 px-3 rounded-lg text-sm font-medium transition-all ${proximityRadius === option.value
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
            className="mb-8"
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

          <div className="flex justify-center items-center gap-1.5 pb-6 opacity-60">
            <span className="text-gold text-[10px]">♔</span>
            <p className="text-gold/80 text-[10px] tracking-[0.15em] uppercase font-medium">Creada por INOVA</p>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Profile;
