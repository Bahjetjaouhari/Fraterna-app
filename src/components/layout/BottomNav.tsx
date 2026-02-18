import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Map, MessageCircle, User, Shield, AlertTriangle, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  icon: React.ElementType;
  label: string;
  path: string;
  adminOnly?: boolean;
  emergencyOnly?: boolean;
  badge?: number;
}

interface BottomNavProps {
  isAdmin?: boolean;
}

const NEARBY_KEY = "fraterna_nearby_brothers_count";

export const BottomNav: React.FC<BottomNavProps> = ({ isAdmin = false }) => {
  const location = useLocation();

  // Regla: Emergencia solo aparece si hay >= 1 QH cerca (según MapView)
  const [emergencyAvailable, setEmergencyAvailable] = useState(false);
  const [emergencyCount, setEmergencyCount] = useState(0);

  const timerRef = useRef<number | null>(null);

  const readNearbyCount = () => {
    try {
      const raw = localStorage.getItem(NEARBY_KEY);
      const n = Number(raw ?? "0");
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  };

  const syncFromLocal = () => {
    const count = readNearbyCount();
    setEmergencyCount(count);
    setEmergencyAvailable(count > 0);
  };

  useEffect(() => {
    // primer sync
    syncFromLocal();

    // en el mismo tab, storage event no siempre dispara, así que hacemos polling suave
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      syncFromLocal();
    }, 1500);

    // si cambia en otra pestaña, esto ayuda
    const onStorage = (e: StorageEvent) => {
      if (e.key === NEARBY_KEY) syncFromLocal();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
      window.removeEventListener("storage", onStorage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // refresca al cambiar de ruta
  useEffect(() => {
    syncFromLocal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const navItems: NavItem[] = useMemo(
    () => [
      { icon: Map, label: "Mapa", path: "/map" },
      { icon: MessageCircle, label: "Chat", path: "/chat" },
      { icon: Users, label: "Amigos", path: "/friends" },
      {
        icon: AlertTriangle,
        label: "Emergencia",
        path: "/emergency/chat",
        emergencyOnly: true,
        badge: emergencyCount,
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
    <nav className="nav-masonic safe-area-bottom" id="bottom-nav">
      <div className="flex items-center justify-around py-2">
        {visibleItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;

          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-all duration-200",
                isActive ? "text-gold" : "text-ivory/60 hover:text-ivory"
              )}
            >
              <div className="relative">
                <Icon size={24} />

                {typeof item.badge === "number" &&
                  item.badge > 0 &&
                  item.emergencyOnly && (
                    <span className="absolute -top-1 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-gold text-navy text-[11px] font-bold flex items-center justify-center">
                      {item.badge}
                    </span>
                  )}

                {isActive && (
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-gold rounded-full" />
                )}
              </div>

              <span className="text-xs font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
