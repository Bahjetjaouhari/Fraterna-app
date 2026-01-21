import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Map, MessageCircle, User, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  icon: React.ElementType;
  label: string;
  path: string;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { icon: Map, label: "Mapa", path: "/map" },
  { icon: MessageCircle, label: "Chat", path: "/chat" },
  { icon: User, label: "Perfil", path: "/profile" },
  { icon: Shield, label: "Admin", path: "/admin", adminOnly: true },
];

interface BottomNavProps {
  isAdmin?: boolean;
}

export const BottomNav: React.FC<BottomNavProps> = ({ isAdmin = false }) => {
  const location = useLocation();
  
  const visibleItems = navItems.filter(item => !item.adminOnly || isAdmin);

  return (
    <nav className="nav-masonic safe-area-bottom">
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
                isActive 
                  ? "text-gold" 
                  : "text-ivory/60 hover:text-ivory"
              )}
            >
              <div className="relative">
                <Icon size={24} />
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
