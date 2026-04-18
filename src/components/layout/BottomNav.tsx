import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Map, MessageCircle, User, Shield, AlertTriangle, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUnreadCount } from "@/hooks/useUnreadCount";

interface NavItem {
  icon: React.ElementType;
  label: string;
  path: string;
  adminOnly?: boolean;
  emergencyOnly?: boolean;
  unreadKey?: 'global' | 'emergency' | 'friends';
}

interface BottomNavProps {
  isAdmin?: boolean;
}

export const BottomNav: React.FC<BottomNavProps> = ({ isAdmin = false }) => {
  const location = useLocation();
  const { counts } = useUnreadCount();

  // Regla: Emergencia solo aparece si hay >= 1 QH cerca (según MapView)
  const [emergencyAvailable, setEmergencyAvailable] = useState(false);

  useEffect(() => {
    const onNearbyCount = (e: Event) => {
      const count = (e as CustomEvent<number>).detail ?? 0;
      setEmergencyAvailable(count > 0);
    };

    window.addEventListener("fraterna:nearby-count", onNearbyCount);
    return () => {
      window.removeEventListener("fraterna:nearby-count", onNearbyCount);
    };
  }, []);

  const navItems: NavItem[] = useMemo(
    () => [
      { icon: Map, label: "Mapa", path: "/map" },
      { icon: MessageCircle, label: "Chat", path: "/chat", unreadKey: 'global' },
      { icon: Users, label: "Amigos", path: "/friends", unreadKey: 'friends' },
      {
        icon: AlertTriangle,
        label: "Emergencia",
        path: "/emergency/chat",
        emergencyOnly: true,
        unreadKey: 'emergency',
      },
      { icon: User, label: "Perfil", path: "/profile" },
      { icon: Shield, label: "Admin", path: "/admin", adminOnly: true },
    ],
    [counts]
  );

  const visibleItems = navItems.filter((item) => {
    if (item.adminOnly && !isAdmin) return false;
    if (item.emergencyOnly && !emergencyAvailable) return false;
    return true;
  });

  // Obtener badge para cada item (solo mensajes no leídos)
  const getBadgeCount = (item: NavItem): number | undefined => {
    if (item.unreadKey === 'global' && counts.global > 0) {
      return counts.global;
    }
    if (item.unreadKey === 'emergency' && counts.emergency > 0) {
      return counts.emergency;
    }
    if (item.unreadKey === 'friends' && counts.friends > 0) {
      return counts.friends;
    }
    return undefined;
  };

  return (
    <nav className="nav-masonic safe-area-bottom" id="bottom-nav">
      <div className="flex items-center justify-around py-2">
        {visibleItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;
          const badgeCount = getBadgeCount(item);

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

                {typeof badgeCount === 'number' && badgeCount > 0 && (
                  <span className="absolute -top-1 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-white text-[11px] font-bold flex items-center justify-center">
                    {badgeCount > 99 ? '99+' : badgeCount}
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
