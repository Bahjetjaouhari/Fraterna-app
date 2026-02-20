import React, { useEffect, useMemo, useState } from "react";
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

export const BottomNav: React.FC<BottomNavProps> = ({ isAdmin = false }) => {
  const location = useLocation();

  // Regla: Emergencia solo aparece si hay >= 1 QH cerca (según MapView)
  const [emergencyAvailable, setEmergencyAvailable] = useState(false);
  const [emergencyCount, setEmergencyCount] = useState(0);

  useEffect(() => {
    const onNearbyCount = (e: Event) => {
      const count = (e as CustomEvent<number>).detail ?? 0;
      setEmergencyCount(count);
      setEmergencyAvailable(count > 0);
    };

    window.addEventListener("fraterna:nearby-count", onNearbyCount);
    return () => {
      window.removeEventListener("fraterna:nearby-count", onNearbyCount);
    };
  }, []);

  // Refresca al cambiar de ruta (MapView puede no estar montado)
  // No-op ahora; el evento lo maneja todo.

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
