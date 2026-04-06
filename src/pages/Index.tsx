import React, { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { MasonicSymbol } from "@/components/icons/MasonicSymbol";
import { useAuth } from "@/hooks/useAuth";

const Index: React.FC = () => {
  const navigate = useNavigate();
  const { user, isLoading, isVerified, profile } = useAuth();
  const hasRedirected = useRef(false);

  useEffect(() => {
    // Prevent multiple redirects
    if (hasRedirected.current) return;

    // Wait for auth to finish loading
    if (isLoading) return;

    // Mark as redirected to prevent double navigation
    hasRedirected.current = true;

    // Redirect immediately based on auth status (no splash delay for returning users)
    if (user) {
      // User is logged in - redirect to appropriate page
      if (isVerified) {
        navigate("/map", { replace: true });
      } else if (profile?.verification_status === 'pending' ||
                 profile?.verification_status === 'manual_review' ||
                 profile?.verification_status === 'blocked') {
        navigate("/verification", { replace: true });
      } else {
        navigate("/map", { replace: true });
      }
    } else {
      // User not logged in - show splash for 2.5s then go to onboarding
      const timer = setTimeout(() => {
        navigate("/onboarding", { replace: true });
      }, 2500);

      return () => clearTimeout(timer);
    }
  }, [navigate, user, isLoading, isVerified, profile]);

  return (
    <div className="min-h-screen bg-navy flex flex-col items-center justify-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="text-center"
      >
        {/* Logo */}
        <motion.div
          initial={{ rotate: -10 }}
          animate={{ rotate: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="mb-8"
        >
          <MasonicSymbol size={120} className="text-gold mx-auto" />
        </motion.div>

        {/* App Name */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="font-display text-5xl text-ivory mb-3"
        >
          Fraterna
        </motion.h1>

        {/* Tagline */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="text-ivory/60 text-lg"
        >
          Conectando Hermanos
        </motion.p>

        {/* Loading indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1, duration: 0.5 }}
          className="mt-12"
        >
          <div className="flex justify-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="w-2 h-2 bg-gold rounded-full"
                animate={{
                  scale: [1, 1.5, 1],
                  opacity: [0.5, 1, 0.5],
                }}
                transition={{
                  duration: 1,
                  repeat: Infinity,
                  delay: i * 0.2,
                }}
              />
            ))}
          </div>
        </motion.div>
      </motion.div>

      {/* Bottom gradient */}
      <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-navy-dark to-transparent pointer-events-none" />

      {/* Attribution */}
      <div className="absolute bottom-6 left-0 right-0 flex items-center justify-center gap-1.5 z-10 opacity-70">
        <span className="text-gold text-[10px]">♔</span>
        <p className="text-gold/80 text-[10px] tracking-[0.15em] uppercase font-medium">Creada por INOVA</p>
      </div>
    </div>
  );
};

export default Index;
