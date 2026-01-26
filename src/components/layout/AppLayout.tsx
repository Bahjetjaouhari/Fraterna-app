import React, { useEffect, useRef } from "react";
import { BottomNav } from "./BottomNav";

interface AppLayoutProps {
  children: React.ReactNode;
  showNav?: boolean;
  isAdmin?: boolean;
  darkMode?: boolean;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  children,
  showNav = true,
  isAdmin = false,
  darkMode = false,
}) => {
  const bottomNavRef = useRef<HTMLDivElement | null>(null);

  // ✅ Optimización segura:
  useEffect(() => {
    if (!showNav) return;
    const el = bottomNavRef.current;
    if (!el) return;

    const setVar = () => {
      const h = Math.round(el.getBoundingClientRect().height || 0);
      if (h > 0) {
        document.documentElement.style.setProperty("--bottom-nav-h", `${h}px`);
      }
    };

    setVar();

    const ro = new ResizeObserver(setVar);
    ro.observe(el);

    window.addEventListener("resize", setVar);
    window.addEventListener("orientationchange", setVar);

    const t1 = setTimeout(setVar, 200);
    const t2 = setTimeout(setVar, 600);
    const t3 = setTimeout(setVar, 1200);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", setVar);
      window.removeEventListener("orientationchange", setVar);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [showNav]);

  // Asegúrate de que el padding de la parte inferior se ajuste correctamente
  const mainPaddingBottom = showNav
    ? "calc(var(--bottom-nav-h, 5rem) + env(safe-area-inset-bottom, 0px))"
    : undefined;

  return (
    <div className={darkMode ? "dark" : ""} style={{ minHeight: "100dvh" }}>
      <main style={{ minHeight: "100dvh", paddingBottom: mainPaddingBottom }}>
        {children}
      </main>

      {showNav && (
        <div
          id="bottom-nav"
          ref={bottomNavRef}
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 50,
          }}
        >
          <BottomNav isAdmin={isAdmin} />
        </div>
      )}
    </div>
  );
};

export default AppLayout;
