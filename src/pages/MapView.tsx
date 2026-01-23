import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Locate, Settings, Ghost, Users, ZoomIn, ZoomOut, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

import maplibregl, { Map as MapLibreMap, Marker as MapLibreMarker, Popup as MapLibrePopup } from "maplibre-gl";

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

  // Tu ubicación en memoria
  const [myLat, setMyLat] = useState<number | null>(null);
  const [myLng, setMyLng] = useState<number | null>(null);

  // MapLibre refs
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  // Markers refs (para actualizar sin recrear todo)
  const myMarkerRef = useRef<MapLibreMarker | null>(null);
  const brotherMarkersByIdRef = useRef<Record<string, MapLibreMarker>>({});

  // Anti-spam de alertas
  const lastNotifiedRef = useRef<Record<string, number>>({});

  // ✅ Optimización: anti-spam para fetchBrothers() vía realtime
  const fetchDebounceTimerRef = useRef<number | null>(null);
  const isFetchingRef = useRef(false);
  const pendingFetchRef = useRef(false);

  // -----------------------------
  // Bottom nav measure
  // -----------------------------
  useEffect(() => {
    const el = document.getElementById("bottom-nav");
    if (!el) return;

    const measure = () => {
      const h = Math.round(el.getBoundingClientRect().height || 0);
      if (h > 0) setBottomNavH(h);
    };

    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);

    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);

    const t1 = setTimeout(measure, 200);
    const t2 = setTimeout(measure, 600);
    const t3 = setTimeout(measure, 1200);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  const bottomOffset = `calc(${bottomNavH}px + env(safe-area-inset-bottom, 0px) + 2px)`;

  // -----------------------------
  // Perfil -> stealthMode
  // -----------------------------
  useEffect(() => {
    if (profile) setStealthMode(profile.stealth_mode);
  }, [profile]);

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
  // Centro inicial (si aún no hay coords => Venezuela)
  // -----------------------------
  const initialCenter = useMemo<[number, number]>(() => {
    // MapLibre usa [lng, lat]
    if (myLat != null && myLng != null) return [myLng, myLat];
    return [-66.9, 8.6];
  }, [myLat, myLng]);

  // -----------------------------
  // Init MapLibre (1 sola vez)
  // -----------------------------
  useEffect(() => {
    if (!mapDivRef.current) return;
    if (mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapDivRef.current,
      style: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
      center: initialCenter,
      zoom: 6,
      minZoom: 3,
      maxZoom: 18,
      fadeDuration: 0,
      renderWorldCopies: false,
      attributionControl: true,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });

    mapRef.current = map;

    const resize = () => map.resize();
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);

    map.on("load", () => {
      requestAnimationFrame(() => map.resize());
    });

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", resize);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cada vez que cambie el layout (bottom nav), resize al mapa
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    requestAnimationFrame(() => map.resize());
  }, [bottomNavH]);

  // -----------------------------
  // Center helper
  // -----------------------------
  const centerOn = (lat: number, lng: number) => {
    const map = mapRef.current;
    if (!map) return;

    map.flyTo({
      center: [lng, lat],
      zoom: 18,
      duration: 800,
      essential: true,
    });

    requestAnimationFrame(() => map.resize());
  };

  // -----------------------------
  // Fetch brothers + realtime
  // -----------------------------
  useEffect(() => {
    // Primer fetch
    fetchBrothers();

    const channel = supabase
      .channel("locations-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "locations" }, () => {
        // ✅ Optimización: agrupa eventos seguidos (anti-spam de consultas)
        scheduleFetchBrothers();
      })
      .subscribe();

    return () => {
      if (fetchDebounceTimerRef.current) window.clearTimeout(fetchDebounceTimerRef.current);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ Debounce: si entran muchos eventos, hacemos 1 sola consulta
  const scheduleFetchBrothers = () => {
    if (fetchDebounceTimerRef.current) window.clearTimeout(fetchDebounceTimerRef.current);
    fetchDebounceTimerRef.current = window.setTimeout(() => {
      fetchBrothers();
    }, 600);
  };

  const fetchBrothers = async () => {
    // ✅ Evita solapar fetches (si llega otro evento mientras tanto, corre 1 vez al final)
    if (isFetchingRef.current) {
      pendingFetchRef.current = true;
      return;
    }

    isFetchingRef.current = true;

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
      isFetchingRef.current = false;
      setIsLoading(false);

      if (pendingFetchRef.current) {
        pendingFetchRef.current = false;
        // Re-ejecuta 1 vez por si llegaron cambios mientras estábamos consultando
        scheduleFetchBrothers();
      }
    }
  };

  // -----------------------------
  // Markers (MapLibre) - ultra fluido
  // -----------------------------
  const makeDotEl = (variant: "me" | "bro") => {
    const el = document.createElement("div");
    el.style.width = variant === "me" ? "18px" : "16px";
    el.style.height = variant === "me" ? "18px" : "16px";
    el.style.borderRadius = "999px";
    el.style.background = variant === "me" ? "#d4af37" : "#3b82f6";
    el.style.border = "3px solid rgba(0,0,0,0.35)";
    el.style.boxShadow =
      variant === "me" ? "0 0 0 6px rgba(212,175,55,0.25)" : "0 0 0 5px rgba(59,130,246,0.20)";
    el.style.cursor = "pointer";
    return el;
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Yo
    if (myLat != null && myLng != null) {
      if (!myMarkerRef.current) {
        myMarkerRef.current = new maplibregl.Marker({ element: makeDotEl("me") })
          .setLngLat([myLng, myLat])
          .addTo(map);
      } else {
        myMarkerRef.current.setLngLat([myLng, myLat]);
      }
    }

    // Hermanos (diff update: crear/actualizar/remover sin recrear todo)
    const nextIds = new Set<string>();

    for (const b of brothers) {
      // ✅ Importante: no usar "!b.lat" porque 0 sería falso
      if (b.lat == null || b.lng == null) continue;
      if (b.profile?.stealth_mode) continue;

      nextIds.add(b.user_id);

      const existing = brotherMarkersByIdRef.current[b.user_id];

      if (existing) {
        existing.setLngLat([b.lng, b.lat]);
        continue;
      }

      const el = makeDotEl("bro");
      el.addEventListener("click", () => setSelectedBrother(b.user_id));

      const popup = new MapLibrePopup({ offset: 12 }).setText(b.profile?.full_name ?? "Q∴H∴");

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([b.lng, b.lat])
        .setPopup(popup)
        .addTo(map);

      brotherMarkersByIdRef.current[b.user_id] = marker;
    }

    // Remover markers que ya no están
    for (const [id, marker] of Object.entries(brotherMarkersByIdRef.current)) {
      if (!nextIds.has(id)) {
        marker.remove();
        delete brotherMarkersByIdRef.current[id];
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brothers, myLat, myLng]);

  // Cleanup de markers al salir de la pantalla
  useEffect(() => {
    return () => {
      for (const marker of Object.values(brotherMarkersByIdRef.current)) marker.remove();
      brotherMarkersByIdRef.current = {};
      myMarkerRef.current?.remove();
      myMarkerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------
  // Location update (con centrar)
  // -----------------------------
  const updateMyLocation = async ({ center }: { center: boolean }) => {
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

        if (center) centerOn(latitude, longitude);

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

          await supabase.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", user.id);

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
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };

  // Si sales de stealth, actualiza ubicación 1 vez (y centra)
  useEffect(() => {
    const prev = prevStealthRef.current;
    prevStealthRef.current = stealthMode;

    if (prev === true && stealthMode === false) {
      setTimeout(() => updateMyLocation({ center: true }), 800);
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
      if (!isUpdatingLocation) updateMyLocation({ center: false });
    }, 30000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, stealthMode, profile?.tracking_enabled, isUpdatingLocation]);

  // Al entrar a mapa: intenta ubicación inicial (y centra)
  useEffect(() => {
    if (!user) return;
    if (stealthMode) return;
    // @ts-ignore
    if (profile?.tracking_enabled === false) return;

    const t = setTimeout(() => updateMyLocation({ center: true }), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stealthMode]);

  // Si cambia initialCenter y el mapa está listo, mueve la cámara suave
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (myLat == null || myLng == null) return;

    map.jumpTo({ center: [myLng, myLat], zoom: Math.max(map.getZoom(), 13) });
  }, [myLat, myLng]);

  const toggleStealthMode = async () => {
    if (!user) return;

    const newValue = !stealthMode;
    setStealthMode(newValue);

    try {
      const { error } = await supabase.from("profiles").update({ stealth_mode: newValue }).eq("id", user.id);
      if (error) throw error;

      await refreshProfile();
      toast.success(newValue ? "Modo fantasma activado" : "Modo fantasma desactivado");

      if (newValue === false) setTimeout(() => updateMyLocation({ center: true }), 800);
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

  const zoomIn = () => mapRef.current?.zoomIn({ duration: 0 });
  const zoomOut = () => mapRef.current?.zoomOut({ duration: 0 });

  return (
    <AppLayout showNav={true} isAdmin={isAdmin} darkMode={true}>
      <div className="bg-map-bg relative overflow-hidden" style={{ height: "100dvh" }}>
        {/* MAP */}
        <div className="absolute inset-0 z-0">
          <div ref={mapDivRef} style={{ height: "100%", width: "100%", background: "#0b1220" }} />

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

        {/* BOTTOM CONTROLS */}
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
            onClick={() => updateMyLocation({ center: true })}
            disabled={isUpdatingLocation}
            title="Centrarme y actualizar"
          >
            {isUpdatingLocation ? <Loader2 size={24} className="animate-spin" /> : <Locate size={24} />}
          </Button>

          <Button variant="masonic-dark" size="icon" className="pointer-events-auto" title="Opciones">
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
