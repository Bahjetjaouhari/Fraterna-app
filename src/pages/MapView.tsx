import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Locate, Settings, Ghost, Users, ZoomIn, ZoomOut, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L, { Map as LeafletMap } from "leaflet";

// -----------------------------
// Utils
// -----------------------------
const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const R = 6371;

  const lat1Rad = toRad(lat1);
  const lon1Rad = toRad(lon1);
  const lat2Rad = toRad(lat2);
  const lon2Rad = toRad(lon2);

  const deltaLat = lat2Rad - lat1Rad;
  const deltaLon = lon2Rad - lon1Rad;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

interface BrotherLocation {
  id: string;
  user_id: string;
  lat: number;
  lng: number;
  accuracy_meters: number;
  updated_at: string;
  profile: {
    full_name: string;
    city: string;
    stealth_mode: boolean;
  };
}

export const MapView: React.FC = () => {
  const { user, profile, isAdmin, refreshProfile } = useAuth();

  const [stealthMode, setStealthMode] = useState(false);
  const prevStealthRef = useRef<boolean>(false);

  const [selectedBrother, setSelectedBrother] = useState<string | null>(null);
  const [brothers, setBrothers] = useState<BrotherLocation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdatingLocation, setIsUpdatingLocation] = useState(false);

  const [bottomNavH, setBottomNavH] = useState(80);

useEffect(() => {
  const el = document.getElementById("bottom-nav");
  if (!el) return;

  const measure = () => {
    const h = Math.round(el.getBoundingClientRect().height || 0);
    if (h > 0) setBottomNavH(h);
  };

  // medir inmediatamente
  measure();

  // ResizeObserver
  const ro = new ResizeObserver(measure);
  ro.observe(el);

  // Eventos normales
  window.addEventListener("resize", measure);
  window.addEventListener("orientationchange", measure);

  // iOS Safari fix (reintentos cortos)
  const t1 = setTimeout(measure, 200);
  const t2 = setTimeout(measure, 600);
  const t3 = setTimeout(measure, 1200);

  // refuerzo temporal (5s)
  const start = Date.now();
  const interval = setInterval(() => {
    measure();
    if (Date.now() - start > 5000) clearInterval(interval);
  }, 400);

  return () => {
    ro.disconnect();
    window.removeEventListener("resize", measure);
    window.removeEventListener("orientationchange", measure);
    clearTimeout(t1);
    clearTimeout(t2);
    clearTimeout(t3);
    clearInterval(interval);
  };
}, []);


  // ✅ Offset inferior REAL: bottomNav + safe-area + margen
  const bottomOffset = `calc(${bottomNavH}px + env(safe-area-inset-bottom, 0px) + 2px)`;

  // Tu ubicación en memoria
  const [myLat, setMyLat] = useState<number | null>(null);
  const [myLng, setMyLng] = useState<number | null>(null);

  // Referencia al mapa
  const mapRef = useRef<LeafletMap | null>(null);

  // Anti-spam de alertas
  const lastNotifiedRef = useRef<Record<string, number>>({});

  // -----------------------------
  // Icons (sin imágenes)
  // -----------------------------
  const myIcon = useMemo(() => {
    return L.divIcon({
      className: "",
      html: `
        <div style="
          width: 18px; height: 18px;
          border-radius: 999px;
          background: #d4af37;
          border: 3px solid rgba(0,0,0,0.35);
          box-shadow: 0 0 0 6px rgba(212,175,55,0.25);
        "></div>
      `,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
      popupAnchor: [0, -10],
    });
  }, []);

  const brotherIcon = useMemo(() => {
    return L.divIcon({
      className: "",
      html: `
        <div style="
          width: 16px; height: 16px;
          border-radius: 999px;
          background: #3b82f6;
          border: 3px solid rgba(0,0,0,0.35);
          box-shadow: 0 0 0 5px rgba(59,130,246,0.20);
        "></div>
      `,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
      popupAnchor: [0, -10],
    });
  }, []);

  // -----------------------------
  // Perfil -> stealthMode
  // -----------------------------
  useEffect(() => {
    if (profile) setStealthMode(profile.stealth_mode);
  }, [profile]);

  // Si sales de stealth, actualiza ubicación 1 vez
  useEffect(() => {
    const prev = prevStealthRef.current;
    prevStealthRef.current = stealthMode;

    if (prev === true && stealthMode === false) {
      setTimeout(() => updateMyLocation(), 800);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stealthMode]);

  // Auto update cada 30s si tracking ON y no stealth
  useEffect(() => {
    if (!user) return;
    if (stealthMode) return;
    // @ts-ignore
    if (profile?.tracking_enabled === false) return;

    const interval = setInterval(() => {
      if (!isUpdatingLocation) updateMyLocation();
    }, 30000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, stealthMode, profile?.tracking_enabled, isUpdatingLocation]);

  // Al entrar a mapa: intenta ubicación inicial
  useEffect(() => {
    if (!user) return;
    if (stealthMode) return;
    // @ts-ignore
    if (profile?.tracking_enabled === false) return;

    const t = setTimeout(() => updateMyLocation(), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stealthMode]);

  // -----------------------------
  // Proximity alerts
  // -----------------------------
  const checkProximityAlerts = (list: BrotherLocation[]) => {
    if (!profile) return;

    // @ts-ignore
    const enabled = profile.proximity_alerts_enabled;
    if (enabled === false) return;

    // @ts-ignore
    const radiusKm = typeof profile.proximity_radius_km === "number" ? profile.proximity_radius_km : 5;

    if (radiusKm === 0) return;
    if (myLat == null || myLng == null) return;

    const COOLDOWN_MS = 2 * 60 * 1000;
    const now = Date.now();

    for (const b of list) {
      if (typeof b.lat !== "number" || typeof b.lng !== "number") continue;
      if (b.profile?.stealth_mode) continue;

      const dist = haversineDistance(myLat, myLng, b.lat, b.lng);
      if (dist <= radiusKm) {
        const last = lastNotifiedRef.current[b.user_id] ?? 0;
        if (now - last >= COOLDOWN_MS) {
          lastNotifiedRef.current[b.user_id] = now;
          toast.success(
            `Alerta: ${b.profile?.full_name ?? "Un Q∴H∴"} está a ${dist.toFixed(2)} km de ti (radio ${radiusKm} km).`
          );
        }
      }
    }
  };

  // -----------------------------
  // Fetch brothers + realtime
  // -----------------------------
  useEffect(() => {
    fetchBrothers();

    const channel = supabase
      .channel("locations-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "locations" }, () => {
        fetchBrothers();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchBrothers = async () => {
    try {
      const { data, error } = await supabase
        .from("locations")
        .select(
          `*,
           profile:profiles!locations_user_id_fkey (
             full_name,
             city,
             stealth_mode
           )`
        )
        .neq("user_id", user?.id || "");

      if (error) {
        console.error("Error fetching locations:", error);
        return;
      }

      const list = (data || []) as unknown as BrotherLocation[];
      setBrothers(list);
      checkProximityAlerts(list);
    } catch (e) {
      console.error("Error in fetchBrothers:", e);
    } finally {
      setIsLoading(false);
    }
  };

  // -----------------------------
  // Location + map centering
  // -----------------------------
  const updateMyLocation = async () => {
    if (!user || !navigator.geolocation) {
      toast.error("Geolocalización no disponible");
      return;
    }

    setIsUpdatingLocation(true);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude, accuracy } = position.coords;

        setMyLat(latitude);
        setMyLng(longitude);

        // Centrar mapa al obtener coords
        if (mapRef.current) {
          const currentZoom = mapRef.current.getZoom();
          mapRef.current.setView([latitude, longitude], Math.max(currentZoom, 13), { animate: true });
        }

        const clampedAccuracy = Math.max(100, Math.min(300, Math.round(accuracy)));

        try {
          const { error } = await supabase
            .from("locations")
            .upsert(
              {
                user_id: user.id,
                lat: latitude,
                lng: longitude,
                accuracy_meters: clampedAccuracy,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "user_id" }
            );

          if (error) throw error;

          await supabase
            .from("profiles")
            .update({ last_seen_at: new Date().toISOString() })
            .eq("id", user.id);

          checkProximityAlerts(brothers);
        } catch (e) {
          console.error("Error updating location:", e);
          toast.error("Error al actualizar ubicación");
        } finally {
          setIsUpdatingLocation(false);
        }
      },
      (error) => {
        console.error("Geolocation error:", error);
        toast.error("No se pudo obtener tu ubicación");
        setIsUpdatingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  const toggleStealthMode = async () => {
    if (!user) return;

    const newValue = !stealthMode;
    setStealthMode(newValue);

    try {
      const { error } = await supabase.from("profiles").update({ stealth_mode: newValue }).eq("id", user.id);
      if (error) throw error;

      await refreshProfile();
      toast.success(newValue ? "Modo fantasma activado" : "Modo fantasma desactivado");

      if (newValue === false) setTimeout(() => updateMyLocation(), 800);
    } catch (e) {
      console.error("Error toggling stealth mode:", e);
      setStealthMode(!newValue);
      toast.error("Error al cambiar modo fantasma");
    }
  };

  const getDistanceKm = (lat: number, lng: number) => {
    if (myLat == null || myLng == null) return "—";
    return haversineDistance(myLat, myLng, lat, lng).toFixed(2);
  };

  // Zoom buttons
  const zoomIn = () => mapRef.current?.setZoom(mapRef.current.getZoom() + 1);
  const zoomOut = () => mapRef.current?.setZoom(mapRef.current.getZoom() - 1);

  // Centro inicial (si aún no hay coords => Venezuela)
  const initialCenter: [number, number] = useMemo(() => {
    if (myLat != null && myLng != null) return [myLat, myLng];
    return [8.6, -66.9];
  }, [myLat, myLng]);

  return (
    <AppLayout showNav={true} isAdmin={isAdmin} darkMode={true}>
      {/* Contenedor de pantalla completa */}
      <div className="bg-map-bg relative overflow-hidden" style={{ height: "100dvh" }}>
        {/* MAPA (fondo) */}
        <div className="absolute inset-0 z-0">
          <MapContainer
            center={initialCenter}
            zoom={6}
            scrollWheelZoom={true}
            zoomControl={false}
            attributionControl={true}
            style={{ height: "100%", width: "100%" }}
            whenCreated={(map) => {
              mapRef.current = map;
            }}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

            {/* Tu marcador */}
            {myLat != null && myLng != null && (
              <Marker position={[myLat, myLng]} icon={myIcon}>
                <Popup>Tu ubicación</Popup>
              </Marker>
            )}

            {/* Marcadores QH (no stealth) */}
            {brothers.map((b) => {
              if (!b.lat || !b.lng) return null;
              if (b.profile?.stealth_mode) return null;

              return (
                <Marker
                  key={b.id}
                  position={[b.lat, b.lng]}
                  icon={brotherIcon}
                  eventHandlers={{
                    click: () => setSelectedBrother(b.user_id),
                  }}
                >
                  <Popup>{b.profile?.full_name ?? "Q∴H∴"}</Popup>
                </Marker>
              );
            })}
          </MapContainer>

          {/* Loading encima del mapa */}
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <Loader2 className="w-8 h-8 text-gold animate-spin" />
            </div>
          )}
        </div>

        {/* TOP CONTROLS */}
        <div
          className="absolute left-4 right-4 flex justify-between items-start z-20"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
        >
          <div className="glass-dark rounded-lg px-4 py-2 pointer-events-auto">
            <p className="text-ivory/60 text-xs">Tu ubicación</p>
            <p className="text-ivory font-medium">
              {profile?.city || "Sin ubicación"}, {profile?.country || "Venezuela"}
            </p>
          </div>

          <Button
            variant={stealthMode ? "masonic" : "masonic-dark"}
            size="icon"
            onClick={toggleStealthMode}
            className="relative pointer-events-auto"
          >
            <Ghost size={20} />
            {stealthMode && <span className="absolute -top-1 -right-1 w-2 h-2 bg-warning rounded-full" />}
          </Button>
        </div>

        {/* SIDE CONTROLS */}
        <div
          className="absolute right-4 flex flex-col gap-2 z-20"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 92px)" }}
        >
          <Button variant="masonic-dark" size="icon" onClick={zoomIn} className="pointer-events-auto">
            <ZoomIn size={20} />
          </Button>
          <Button variant="masonic-dark" size="icon" onClick={zoomOut} className="pointer-events-auto">
            <ZoomOut size={20} />
          </Button>
        </div>

        {/* BOTTOM CONTROLS (AUTO: pegados al BottomNav real) */}
        <div className="absolute left-4 right-4 flex justify-between items-end z-20" style={{ bottom: bottomOffset }}>
          <div className="glass-dark rounded-lg px-4 py-3 pointer-events-auto">
            <div className="flex items-center gap-2">
              <Users size={18} className="text-gold" />
              <div>
                <p className="text-ivory font-semibold">{brothers.length}</p>
                <p className="text-ivory/60 text-xs">Q∴H∴ cerca</p>
              </div>
            </div>
          </div>

          <Button
            variant="masonic"
            size="icon-lg"
            className="rounded-full shadow-gold pointer-events-auto"
            onClick={updateMyLocation}
            disabled={isUpdatingLocation}
          >
            {isUpdatingLocation ? <Loader2 size={24} className="animate-spin" /> : <Locate size={24} />}
          </Button>

          <Button variant="masonic-dark" size="icon" className="pointer-events-auto">
            <Settings size={20} />
          </Button>
        </div>

        {/* PANEL DE QH SELECCIONADO */}
        {selectedBrother && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="absolute left-4 right-4 glass-dark rounded-xl p-4 z-40 pointer-events-auto"
            style={{ bottom: `calc(${bottomOffset} + 84px)` }}
          >
            {(() => {
              const b = brothers.find((x) => x.user_id === selectedBrother);
              if (!b) return null;

              return (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="avatar-masonic w-12 h-12 flex items-center justify-center">
                      <div className="w-10 h-10 rounded-full bg-navy flex items-center justify-center">
                        <span className="text-gold font-bold">QH</span>
                      </div>
                    </div>
                    <div>
                      <h3 className="text-ivory font-medium">{b.profile?.full_name}</h3>
                      <p className="text-ivory/60 text-sm">{b.profile?.city}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-gold font-semibold">~{getDistanceKm(b.lat, b.lng)} km</p>
                    <p className="text-ivory/60 text-xs">{b.profile?.stealth_mode ? "En modo fantasma" : "Activo"}</p>
                  </div>
                </div>
              );
            })()}

            <button
              onClick={() => setSelectedBrother(null)}
              className="absolute -top-2 -right-2 w-6 h-6 bg-navy rounded-full flex items-center justify-center text-ivory/60 hover:text-ivory"
            >
              ×
            </button>
          </motion.div>
        )}

        {/* INDICADOR STEALTH */}
        {stealthMode && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute left-1/2 -translate-x-1/2 glass-dark rounded-full px-4 py-2 flex items-center gap-2 z-40"
            style={{ top: "calc(env(safe-area-inset-top, 0px) + 76px)" }}
          >
            <Ghost size={16} className="text-warning" />
            <span className="text-warning text-sm font-medium">Modo Fantasma Activo</span>
          </motion.div>
        )}
      </div>
    </AppLayout>
  );
};

export default MapView;
