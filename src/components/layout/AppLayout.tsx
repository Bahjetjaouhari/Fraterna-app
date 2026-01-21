import React from "react";
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
  // altura real del viewport (iOS friendly) + espacio del BottomNav (pb)
  const mainPaddingBottom = showNav
    ? "calc(5rem + env(safe-area-inset-bottom, 0px))"
    : undefined;

  return (
    <div
      className={`${darkMode ? "dark" : ""}`}
      style={{
        minHeight: "100dvh",
      }}
    >
      <main
        style={{
          minHeight: "100dvh",
          paddingBottom: mainPaddingBottom,
        }}
      >
        {children}
      </main>

      {showNav && <BottomNav isAdmin={isAdmin} />}
    </div>
  );
};

export default AppLayout;
