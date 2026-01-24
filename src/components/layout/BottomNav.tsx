import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Map, MessageCircle, User, Shield, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface NavItem {
  icon: React.ElementType;
  label: string;
  path: string;
  adminOnly?: boolean;
  emergencyOnly?: boolean;
  onClick?: () => void; // si existe, no navega (Fase 1 segura)
  badge?: number; // opcional: contador
}

interface BottomNavProps {
  isAdmin?: boolean;
}

type EmergencyRow = {
  available: boolean;
  others_count: number;
};

export const BottomNav: React.FC<BottomNavProps> = ({ isAdmin = false }) => {
  const location = useLocation();

  // ====== Emergencia (Fase 1: solo mostrar/ocultar) ======
  const [emergencyAvailable, setEmergencyAvailable] = useState(false);
  const [emergencyCount, setEmergencyCount] = useState(0);

  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);

  // MVP: mismos valores que en tu función
  const RADIUS_KM = 5;
  const FRESH_MINUTES = 5;

  const checkEmergencyAvailability = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    try {
      const { data, error } = await supabase.rpc("emergency_status", {
        radius_km: RADIUS_KM,
        fresh_minutes: FRESH_MINUTES,
      });

      if (error) {
        // Si falla por cualquier cosa, ocultamos para no romper UI
        console.error("emergency_status rpc error:", error);
        setEmergencyAvailable(false);
        setEmergencyCount(0);
        return;
      }

      const row = (Array.isArray(data) ? (data[0] as EmergencyRow | undefined) : undefined) ?? undefined;

      const available = row?.available === true;
      const count = typeof row?.others_count === "number" ? row.others_count : 0;

      setEmergencyAvailable(available);
      setEmergencyCount(count);
    } finally {
      inFlightRef.current = false;
    }
  };

  // Polling ligero: al montar + cada 20s
  useEffect(() => {
    checkEmergencyAvailability();

    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      checkEmergencyAvailability();
    }, 20000);

    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opcional: refrescar al cambiar de ruta
  useEffect(() => {
    checkEmergencyAvailability();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const navItems: NavItem[] = useMemo(
    () => [
      { icon: Map, label: "Mapa", path: "/map" },
      { icon: MessageCircle, label: "Chat", path: "/chat" },
      // 🚨 Solo aparece si Supabase dice que hay 2+ (tú + al menos 1)
      {
        icon: AlertTriangle,
        label: "Emergencia",
        path: "#",
        emergencyOnly: true,
        onClick: () => toast.message("Chat de emergencia: Próximamente"),
        badge: emergencyCount, // número de QH adicionales
      },
      { icon: User, label: "Perfil", path: "/profile" },
      { icon: Shield, label: "Admin", path: "/admin", adminOnly: true },
    ],
    [emergencyCount]
  );

  const visibleItems = navItems.filter((item) => {
    if (item.adminOnly && !isAdmin) return false;
    if (item.emergencyOnly && !emergencyAvailable) return false;
    return true;
  });

  return (
    <nav className="nav-masonic safe-area-bottom">
      <div className="flex items-center justify-around py-2">
        {visibleItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;

          const content = (
            <>
              <div className="relative">
                <Icon size={24} />
                {typeof item.badge === "number" && item.badge > 0 && item.emergencyOnly && (
                  <span className="absolute -top-1 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-gold text-navy text-[11px] font-bold flex items-center justify-center">
                    {item.badge}
                  </span>
                )}
                {isActive && item.path !== "#" && (
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-gold rounded-full" />
                )}
              </div>
              <span className="text-xs font-medium">{item.label}</span>
            </>
          );

          // Si tiene onClick, no navegamos (Fase 1 segura)
          if (item.onClick) {
            return (
              <button
                key={item.label}
                type="button"
                onClick={item.onClick}
                className={cn(
                  "flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-all duration-200",
                  "text-ivory/60 hover:text-ivory"
                )}
              >
                {content}
              </button>
            );
          }

          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-all duration-200",
                isActive ? "text-gold" : "text-ivory/60 hover:text-ivory"
              )}
            >
              {content}
            </Link>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
