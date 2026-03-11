import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Locate, Settings, Ghost, Users, ZoomIn, ZoomOut, Loader2, Map as MapIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { UserProfileModal } from "@/components/UserProfileModal";

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
    tracking_enabled?: boolean;
    location_visibility_mode?: "public" | "friends" | "friends_selected";
    photo_url?: string;
    last_seen_at?: string | null;
  };
}

type VisibilityMode = "public" | "friends" | "friends_selected";

const normalizeVisibilityMode = (v: unknown): VisibilityMode => {
  if (v === "public" || v === "friends" || v === "friends_selected") return v;
  return "friends";
};

/**
 * Carga relaciones necesarias para decidir si el usuario actual puede ver
 * la ubicación de otros (amigos / allowlist).
 * - friends: set de user_ids que son amigos del usuario actual
 * - allowlisted: set de user_ids que te han agregado en su allowlist (solo para friends_selected)
 *
 * Nota: implementado con fallbacks para no romper la app si los nombres de columnas
 * difieren entre proyectos.
 */
const loadViewerRelations = async (viewerId: string) => {
  const friends = new Set<string>();
  const allowlisted = new Set<string>();

  // ---- Friends (tabla friendships) ----
  // Canonical: requester_id / addressee_id
  // Fallback:  user_id / friend_id
  try {
    const { data, error } = await supabase
      .from("friendships")
      .select("requester_id, addressee_id, status")
      .or(`requester_id.eq.${viewerId},addressee_id.eq.${viewerId}`)
      .eq("status", "accepted");

    if (!error && Array.isArray(data)) {
      for (const row of data as any[]) {
        const r = row.requester_id;
        const a = row.addressee_id;
        if (r === viewerId && typeof a === "string") friends.add(a);
        if (a === viewerId && typeof r === "string") friends.add(r);
      }
    } else {
      // fallback
      const { data: data2, error: error2 } = await supabase
        .from("friendships")
        .select("user_id, friend_id, status")
        .or(`user_id.eq.${viewerId},friend_id.eq.${viewerId}`)
        .eq("status", "accepted");

      if (!error2 && Array.isArray(data2)) {
        for (const row of data2 as any[]) {
          const u = row.user_id;
          const f = row.friend_id;
          if (u === viewerId && typeof f === "string") friends.add(f);
          if (f === viewerId && typeof u === "string") friends.add(u);
        }
      }
    }
  } catch {
    // si no existe algo, queda vacío
  }

  // ---- Allowlist (tabla location_allowlist) ----
  // Canonical: owner_id / viewer_id
  // Fallbacks: owner_id / allowed_user_id  OR  user_id / allowed_user_id
  try {
    const { data, error } = await supabase
      .from("location_allowlist")
      .select("owner_id")
      .eq("viewer_id", viewerId);

    if (!error && Array.isArray(data)) {
      for (const row of data as any[]) {
        if (typeof row.owner_id === "string") allowlisted.add(row.owner_id);
      }
    } else {
      // fallback 1
      const { data: data2, error: error2 } = await supabase
        .from("location_allowlist")
        .select("owner_id, allowed_user_id")
        .eq("allowed_user_id", viewerId);

      if (!error2 && Array.isArray(data2)) {
        for (const row of data2 as any[]) {
          if (typeof row.owner_id === "string") allowlisted.add(row.owner_id);
        }
      } else {
        // fallback 2
        const { data: data3, error: error3 } = await supabase
          .from("location_allowlist")
          .select("user_id, allowed_user_id")
          .eq("allowed_user_id", viewerId);

        if (!error3 && Array.isArray(data3)) {
          for (const row of data3 as any[]) {
            if (typeof row.user_id === "string") allowlisted.add(row.user_id);
          }
        }
      }
    }
  } catch {
    // queda vacío
  }

  return { friends, allowlisted };
};

export const MapView: React.FC = () => {
  const { user, profile, isAdmin, refreshProfile } = useAuth();

  const [stealthMode, setStealthMode] = useState(false);
  const prevStealthRef = useRef<boolean>(false);

  const [selectedBrother, setSelectedBrother] = useState<string | null>(null);
  const [profileModalUserId, setProfileModalUserId] = useState<string | null>(null);
  const [brothers, setBrothers] = useState<BrotherLocation[]>([]);
  const [showMapStyles, setShowMapStyles] = useState(false);
  const [mapStyle, setMapStyle] = useState("streets-v2");
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdatingLocation, setIsUpdatingLocation] = useState(false);

  const [bottomNavH, setBottomNavH] = useState(80);

  // Tu ubicación en memoria
  const [myLat, setMyLat] = useState<number | null>(null);
  const [myLng, setMyLng] = useState<number | null>(null);

  // Reverse geocoding
  const [geoCity, setGeoCity] = useState<string | null>(null);
  const [geoCountry, setGeoCountry] = useState<string | null>(null);
  const lastGeoRef = useRef<string>("");

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

  // ✅ Caché de relaciones (friends + allowlist) — se refresca cada 60s, no cada fetch
  const relationsCache = useRef<{ friends: Set<string>; allowlisted: Set<string> } | null>(null);
  const relationsCacheTs = useRef<number>(0);
  const RELATIONS_CACHE_TTL = 60_000; // 60 segundos

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

  // ✅ Contador visible (QH visibles/cargados)
  const visibleBrothersCount = useMemo(() => {
    return brothers.length;
  }, [brothers]);

  // ✅ NUEVO (mínimo): QH cerca REAL (distancia + radio + tu ubicación)
  // Solo cuenta QH ACTIVOS (last_seen_at dentro de 5 min) — los inactivos (rojo) no cuentan
  const nearbyBrothersCount = useMemo(() => {
    // Si no hay perfil o no hay ubicación actual, no podemos calcular cercanía real
    if (!profile) return 0;
    if (myLat == null || myLng == null) return 0;

    // @ts-ignore
    const radiusKm = typeof profile.proximity_radius_km === "number" ? profile.proximity_radius_km : 5;
    if (radiusKm === 0) return 0;

    const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
    const nowMs = Date.now();

    let count = 0;
    for (const b of brothers) {
      if (b.lat == null || b.lng == null) continue;
      if (b.profile?.stealth_mode) continue; // doble seguro

      // Solo contar QH activos (verde) — ignorar inactivos (rojo)
      const lastSeen = b.profile?.last_seen_at;
      const isActive = lastSeen
        ? (nowMs - new Date(lastSeen).getTime()) < ACTIVE_THRESHOLD_MS
        : false;
      if (!isActive) continue;

      const dist = haversineDistance(myLat, myLng, b.lat, b.lng);
      if (dist <= radiusKm) count++;
    }
    return count;
  }, [brothers, myLat, myLng, profile]);

  // ✅ Notificar a BottomNav (Emergencia) vía CustomEvent — sin polling
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("fraterna:nearby-count", { detail: nearbyBrothersCount })
    );
  }, [nearbyBrothersCount]);

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
      style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${import.meta.env.VITE_MAPTILER_KEY}`,
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
      maxTileCacheSize: 150,
      pixelRatio: 1,
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
    fetchBrothers();

    const channel = supabase
      .channel("locations-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "locations" }, () => {
        scheduleFetchBrothers();
      })
      .subscribe();

    return () => {
      if (fetchDebounceTimerRef.current) window.clearTimeout(fetchDebounceTimerRef.current);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleFetchBrothers = () => {
    if (fetchDebounceTimerRef.current) window.clearTimeout(fetchDebounceTimerRef.current);
    fetchDebounceTimerRef.current = window.setTimeout(() => {
      fetchBrothers();
    }, 600);
  };

  const fetchBrothers = async () => {
    if (isFetchingRef.current) {
      pendingFetchRef.current = true;
      return;
    }

    isFetchingRef.current = true;

    try {
      if (!user?.id) return;

      // Relaciones para privacidad (amigos / allowlist) — cacheadas 60s
      const now = Date.now();
      if (!relationsCache.current || now - relationsCacheTs.current > RELATIONS_CACHE_TTL) {
        relationsCache.current = await loadViewerRelations(user.id);
        relationsCacheTs.current = now;
      }
      const { friends, allowlisted } = relationsCache.current;

      const { data, error } = await supabase
        .from("locations")
        .select(
          `*,
           profile:profiles!locations_user_id_fkey (
             full_name,
             city,
             stealth_mode,
             tracking_enabled,
             location_visibility_mode,
             photo_url,
             last_seen_at
           )`
        )
        .neq("user_id", user.id);

      if (error) {
        console.error("Error fetching locations:", error);
        return;
      }

      const rawList = (data || []) as unknown as BrotherLocation[];

      // Aplicar privacidad del QH (owner) hacia el viewer (tú)
      const filtered = rawList.filter((b) => {
        const p = b.profile as any;

        // Seguridad: si el otro no quiere trackear o está en stealth => no mostrar
        if (p?.stealth_mode) return false;
        if (p?.tracking_enabled === false) return false;

        const mode = normalizeVisibilityMode(p?.location_visibility_mode);

        if (mode === "public") return true;
        if (mode === "friends") return friends.has(b.user_id);
        // friends_selected
        return allowlisted.has(b.user_id);
      });

      setBrothers(filtered);
      checkProximityAlerts(filtered);
    } catch (e) {
      console.error("Error in fetchBrothers:", e);
    } finally {
      isFetchingRef.current = false;
      setIsLoading(false);

      if (pendingFetchRef.current) {
        pendingFetchRef.current = false;
        scheduleFetchBrothers();
      }
    }
  };

  // -----------------------------
  // Markers (MapLibre) - Traje Masón
  // -----------------------------
  const makeMarkerEl = (
    variant: "me" | "bro",
    photoUrl?: string,
    name?: string,
    isNearby?: boolean,
    isActive?: boolean
  ) => {
    const isMe = variant === "me";
    const size = isMe ? 48 : 42;
    const photoSize = isMe ? 32 : 28;

    // Status colors
    const activeColor = "#00ff88"; // verde fosforescente
    const inactiveColor = "#ff4444"; // rojo
    const statusColor = isMe ? "#d4af37" : (isActive ? activeColor : inactiveColor);

    // Container - NO usar transform/transition aquí (MapLibre lo usa internamente)
    const container = document.createElement("div");
    container.style.width = `${size}px`;
    container.style.height = `${size + 10}px`;
    container.style.position = "relative";
    container.style.cursor = "pointer";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.alignItems = "center";

    // Badge body (the "suit")
    const badge = document.createElement("div");
    badge.style.width = `${size}px`;
    badge.style.height = `${size}px`;
    badge.style.borderRadius = "50% 50% 50% 50% / 40% 40% 60% 60%";
    badge.style.background = isMe
      ? "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)"
      : "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)";
    badge.style.border = isMe
      ? "2.5px solid #d4af37"
      : `2.5px solid ${statusColor}`;
    badge.style.display = "flex";
    badge.style.alignItems = "center";
    badge.style.justifyContent = "center";
    badge.style.position = "relative";

    // Box shadow based on status
    if (isMe) {
      badge.style.boxShadow = "0 2px 12px rgba(212,175,55,0.4), 0 0 0 3px rgba(212,175,55,0.15)";
      badge.style.animation = "marker-pulse 3s ease-in-out infinite";
    } else if (isNearby) {
      badge.style.boxShadow = `0 0 0 4px ${statusColor}44, 0 0 16px ${statusColor}66`;
      badge.style.animation = isActive ? "marker-active-glow 2s ease-in-out infinite" : "none";
    } else if (isActive) {
      badge.style.boxShadow = `0 0 8px ${activeColor}55, 0 0 0 2px ${activeColor}33`;
      badge.style.animation = "marker-active-glow 2.5s ease-in-out infinite";
    } else {
      badge.style.boxShadow = "0 2px 8px rgba(0,0,0,0.4)";
    }

    // Photo circle
    const photoCircle = document.createElement("div");
    photoCircle.style.width = `${photoSize}px`;
    photoCircle.style.height = `${photoSize}px`;
    photoCircle.style.borderRadius = "50%";
    photoCircle.style.overflow = "hidden";
    photoCircle.style.border = isMe
      ? "2px solid #d4af37"
      : `1.5px solid ${statusColor}88`;
    photoCircle.style.position = "relative";
    photoCircle.style.zIndex = "2";

    // Inactive: slight opacity to visually distinguish
    if (!isMe && !isActive) {
      badge.style.opacity = "0.7";
    }

    if (photoUrl) {
      const img = document.createElement("img");
      img.src = photoUrl;
      img.alt = name || "QH";
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "cover";
      img.style.display = "block";
      photoCircle.appendChild(img);
    } else {
      // Initials fallback
      const parts = (name || "").trim().split(/\s+/).filter(Boolean);
      const initials = ((parts[0]?.[0] ?? "Q") + (parts.length > 1 ? parts[parts.length - 1]?.[0] : "H")).toUpperCase();
      photoCircle.style.background = "rgba(212,175,55,0.15)";
      photoCircle.style.display = "flex";
      photoCircle.style.alignItems = "center";
      photoCircle.style.justifyContent = "center";
      const span = document.createElement("span");
      span.textContent = initials;
      span.style.color = "#d4af37";
      span.style.fontSize = isMe ? "13px" : "11px";
      span.style.fontWeight = "700";
      span.style.fontFamily = "system-ui, sans-serif";
      photoCircle.appendChild(span);
    }

    badge.appendChild(photoCircle);

    // Decorative "V" lapel notch (SVG)
    const lapelSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    lapelSvg.setAttribute("viewBox", "0 0 24 8");
    lapelSvg.setAttribute("width", "18");
    lapelSvg.setAttribute("height", "6");
    lapelSvg.style.position = "absolute";
    lapelSvg.style.bottom = "-1px";
    lapelSvg.style.left = "50%";
    lapelSvg.style.transform = "translateX(-50%)";
    lapelSvg.style.zIndex = "1";
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M2,0 L12,7 L22,0");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", isMe ? "#d4af37" : `${statusColor}66`);
    path.setAttribute("stroke-width", isMe ? "1.5" : "1");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    lapelSvg.appendChild(path);
    badge.appendChild(lapelSvg);

    container.appendChild(badge);

    // Pointer triangle at bottom
    const pointer = document.createElement("div");
    pointer.style.width = "0";
    pointer.style.height = "0";
    pointer.style.borderLeft = "5px solid transparent";
    pointer.style.borderRight = "5px solid transparent";
    pointer.style.borderTop = isMe ? "6px solid #d4af37" : `6px solid ${statusColor}88`;
    pointer.style.marginTop = "-1px";
    container.appendChild(pointer);

    // Hover effect (en el badge, NO en el container)
    badge.style.transition = "filter 0.2s ease";
    container.addEventListener("mouseenter", () => { badge.style.filter = "brightness(1.3)"; });
    container.addEventListener("mouseleave", () => { badge.style.filter = "brightness(1)"; });

    return container;
  };

  // Inject CSS animations for markers (once)
  useEffect(() => {
    if (document.getElementById("fraterna-marker-styles")) return;
    const style = document.createElement("style");
    style.id = "fraterna-marker-styles";
    style.textContent = `
      @keyframes marker-pulse {
        0%, 100% { box-shadow: 0 2px 12px rgba(212,175,55,0.4), 0 0 0 3px rgba(212,175,55,0.15); }
        50% { box-shadow: 0 2px 16px rgba(212,175,55,0.6), 0 0 0 5px rgba(212,175,55,0.25); }
      }
      @keyframes marker-glow {
        0%, 100% { box-shadow: 0 0 0 4px rgba(212,175,55,0.3), 0 0 16px rgba(212,175,55,0.5); }
        50% { box-shadow: 0 0 0 6px rgba(212,175,55,0.5), 0 0 24px rgba(212,175,55,0.7); }
      }
      @keyframes marker-active-glow {
        0%, 100% { box-shadow: 0 0 8px rgba(0,255,136,0.35), 0 0 0 2px rgba(0,255,136,0.2); }
        50% { box-shadow: 0 0 14px rgba(0,255,136,0.5), 0 0 0 4px rgba(0,255,136,0.3); }
      }
    `;
    document.head.appendChild(style);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // -- My marker --
    if (myLat != null && myLng != null) {
      if (myMarkerRef.current) {
        myMarkerRef.current.remove();
        myMarkerRef.current = null;
      }
      const myPhotoUrl = profile?.photo_url as string | undefined;
      const myName = profile?.full_name as string | undefined;
      const myEl = makeMarkerEl("me", myPhotoUrl, myName);
      myEl.style.zIndex = "50";
      myMarkerRef.current = new maplibregl.Marker({ element: myEl })
        .setLngLat([myLng, myLat])
        .addTo(map);
    }

    // -- Brother markers --
    const nextIds = new Set<string>();

    const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
    const nowMs = Date.now();

    for (const b of brothers) {
      if (b.lat == null || b.lng == null) continue;
      if (b.profile?.stealth_mode) continue;

      nextIds.add(b.user_id);

      // Calculate proximity
      let isNearby = false;
      let distKm = Infinity;
      if (myLat != null && myLng != null) {
        distKm = haversineDistance(myLat, myLng, b.lat, b.lng);
        isNearby = distKm < 1;
      }

      // Determine active status: active if last_seen_at is within 5 minutes
      const lastSeen = b.profile?.last_seen_at;
      const isActive = lastSeen
        ? (nowMs - new Date(lastSeen).getTime()) < ACTIVE_THRESHOLD_MS
        : false;

      // Remove old marker to update photo/proximity/status state
      const existing = brotherMarkersByIdRef.current[b.user_id];
      if (existing) existing.remove();

      const el = makeMarkerEl("bro", b.profile?.photo_url, b.profile?.full_name, isNearby, isActive);
      el.style.zIndex = isNearby ? "100" : "10";
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        setProfileModalUserId(b.user_id);
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([b.lng, b.lat])
        .addTo(map);

      brotherMarkersByIdRef.current[b.user_id] = marker;
    }

    for (const [id, marker] of Object.entries(brotherMarkersByIdRef.current)) {
      if (!nextIds.has(id)) {
        marker.remove();
        delete brotherMarkersByIdRef.current[id];
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brothers, myLat, myLng, profile?.photo_url]);

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

    const onSuccess = async (position: GeolocationPosition) => {
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
    };

    // Primero intentar con alta precisión (GPS móvil)
    navigator.geolocation.getCurrentPosition(
      onSuccess,
      (highAccErr) => {
        // Si falla por timeout o posición no disponible, reintentar con baja precisión (WiFi/IP)
        console.warn("High accuracy failed, retrying with low accuracy:", highAccErr.message);
        navigator.geolocation.getCurrentPosition(
          onSuccess,
          (lowAccErr) => {
            console.error("Geolocation error (both attempts):", lowAccErr);
            toast.error("No se pudo obtener tu ubicación. Activa los servicios de ubicación de Windows.");
            setIsUpdatingLocation(false);
          },
          { enableHighAccuracy: false, timeout: 20000, maximumAge: 30000 }
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 15000 }
    );
  };

  useEffect(() => {
    const prev = prevStealthRef.current;
    prevStealthRef.current = stealthMode;

    if (prev === true && stealthMode === false) {
      setTimeout(() => updateMyLocation({ center: true }), 800);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stealthMode]);

  useEffect(() => {
    if (!user) return;
    if (stealthMode) return;
    // @ts-ignore
    if (profile?.tracking_enabled === false) return;

    const interval = setInterval(() => {
      if (!isUpdatingLocation) updateMyLocation({ center: false });
    }, 15000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, stealthMode, profile?.tracking_enabled, isUpdatingLocation]);

  useEffect(() => {
    if (!user) return;
    if (stealthMode) return;
    // @ts-ignore
    if (profile?.tracking_enabled === false) return;

    const t = setTimeout(() => updateMyLocation({ center: true }), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stealthMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (myLat == null || myLng == null) return;

    map.jumpTo({ center: [myLng, myLat], zoom: Math.max(map.getZoom(), 13) });

    // Reverse geocode
    const geoKey = `${myLat.toFixed(3)},${myLng.toFixed(3)}`;
    if (geoKey !== lastGeoRef.current) {
      lastGeoRef.current = geoKey;
      fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${myLat}&lon=${myLng}&zoom=10&addressdetails=1`, { headers: { "Accept-Language": "es" } })
        .then((r) => r.json())
        .then((data) => {
          const addr = data?.address;
          const city = addr?.city || addr?.town || addr?.village || addr?.municipality || addr?.state || null;
          const country = addr?.country || null;
          if (city) setGeoCity(city);
          if (country) setGeoCountry(country);
          // Update profile city for persistence
          if (city && user?.id) {
            supabase.from("profiles").update({ city }).eq("id", user.id).then(() => { });
          }
        })
        .catch(() => { });
    }
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

  // Map styles available from MapTiler
  const MAP_STYLES = [
    { id: "streets-v2", name: "Calles", emoji: "🗺️" },
    { id: "satellite", name: "Satélite", emoji: "🛰️" },
    { id: "outdoor-v2", name: "Exterior", emoji: "🏔️" },
    { id: "topo-v2", name: "Topográfico", emoji: "📊" },
    { id: "dataviz", name: "Moderno", emoji: "✨" },
  ];

  const changeMapStyle = (styleId: string) => {
    const map = mapRef.current;
    if (!map) return;
    const key = import.meta.env.VITE_MAPTILER_KEY;
    const url = `https://api.maptiler.com/maps/${styleId}/style.json?key=${key}`;
    map.setStyle(url);
    setMapStyle(styleId);
    setShowMapStyles(false);
  };

  return (
    <AppLayout showNav={true} isAdmin={isAdmin} darkMode={true}>
      {/* ✅ CAMBIO ÚNICO: de "relative" a pantalla fija para bloquear el scroll del documento */}
      <div className="bg-map-bg fixed inset-0 overflow-hidden" style={{ height: "100dvh" }}>
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
              {geoCity || profile?.city || (myLat != null ? "Obteniendo..." : "Sin ubicación")}, {geoCountry || profile?.country || "Venezuela"}
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
                {/* ✅ CAMBIO MÍNIMO: ahora es REAL (nearbyBrothersCount) */}
                <p className="text-ivory font-semibold">{nearbyBrothersCount}</p>
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

          <Button
            variant="masonic-dark"
            size="icon"
            className="pointer-events-auto"
            title="Estilos de mapa"
            onClick={() => setShowMapStyles(!showMapStyles)}
          >
            <Settings size={20} />
          </Button>
        </div>

        {/* MAP STYLE SELECTOR PANEL */}
        {showMapStyles && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="absolute right-4 z-30 pointer-events-auto"
            style={{ bottom: `calc(${bottomOffset} + 60px)` }}
          >
            <div className="glass-dark rounded-xl p-3 w-48 space-y-1">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <MapIcon size={14} className="text-gold" />
                  <span className="text-ivory text-xs font-semibold">Estilo de mapa</span>
                </div>
                <button
                  onClick={() => setShowMapStyles(false)}
                  className="text-ivory/40 hover:text-ivory transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
              {MAP_STYLES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => changeMapStyle(s.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${mapStyle === s.id
                      ? "bg-gold/20 text-gold border border-gold/30"
                      : "text-ivory/80 hover:bg-ivory/10"
                    }`}
                >
                  <span className="text-base">{s.emoji}</span>
                  <span>{s.name}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {/* USER PROFILE MODAL (desde mapa) */}
        <UserProfileModal
          userId={profileModalUserId}
          onClose={() => setProfileModalUserId(null)}
        />

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
