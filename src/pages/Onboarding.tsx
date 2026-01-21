import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { MapPin, Shield, Users, Bell, ChevronRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MasonicSymbol, AllSeeingEye } from "@/components/icons/MasonicSymbol";

interface OnboardingStep {
  id: number;
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: string;
}

const steps: OnboardingStep[] = [
  {
    id: 0,
    icon: <MasonicSymbol size={80} className="text-gold" />,
    title: "Fraterna Nos Une",
    description: "Una comunidad exclusiva para Hermanos verificados. Conecta con Q∴H∴ cerca de ti de manera segura y discreta.",
  },
  {
    id: 1,
    icon: <Shield className="w-20 h-20 text-gold" />,
    title: "Verificación Masónica",
    description: "Tu identidad masónica será verificada mediante preguntas del grado Aprendiz. Esto garantiza que solo Hermanos legítimos accedan.",
  },
  {
    id: 2,
    icon: <MapPin className="w-20 h-20 text-gold" />,
    title: "Ubicación Aproximada",
    description: "Tu ubicación siempre se muestra de forma aproximada (100-300m) para proteger tu privacidad. Nunca compartimos tu posición exacta.",
    action: "Permitir ubicación",
  },
  {
    id: 3,
    icon: <Bell className="w-20 h-20 text-gold" />,
    title: "Alertas de Cercanía",
    description: "Recibe notificaciones cuando un Q∴H∴ esté cerca. Tú decides la distancia y puedes desactivarlo cuando quieras.",
    action: "Permitir notificaciones",
  },
  {
    id: 4,
    icon: <Users className="w-20 h-20 text-gold" />,
    title: "Control Total",
    description: "Activa el modo fantasma cuando lo necesites. Tu privacidad es lo primero.",
  },
];

export const Onboarding: React.FC = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [permissionsGranted, setPermissionsGranted] = useState({
    location: false,
    notifications: false,
  });

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      navigate("/register");
    }
  };

  const handlePermission = async (type: "location" | "notifications") => {
    // In production, this would request actual permissions
    // For now, we simulate granting
    setPermissionsGranted(prev => ({ ...prev, [type]: true }));
    
    // Auto-advance after granting
    setTimeout(() => handleNext(), 500);
  };

  const step = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;

  return (
    <div className="min-h-screen bg-navy flex flex-col">
      {/* Progress Dots */}
      <div className="flex justify-center gap-2 pt-12 pb-8">
        {steps.map((_, index) => (
          <div
            key={index}
            className={`h-2 rounded-full transition-all duration-300 ${
              index === currentStep 
                ? "w-8 bg-gold" 
                : index < currentStep 
                  ? "w-2 bg-gold/60" 
                  : "w-2 bg-ivory/20"
            }`}
          />
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4 }}
            className="flex flex-col items-center text-center max-w-sm"
          >
            {/* Icon */}
            <div className="mb-8">
              {step.icon}
            </div>

            {/* Title */}
            <h1 className="font-display text-3xl text-ivory mb-4">
              {step.title}
            </h1>

            {/* Description */}
            <p className="text-ivory/70 text-lg leading-relaxed mb-8">
              {step.description}
            </p>

            {/* Permission Button or Granted State */}
            {step.action && (
              <div className="mb-4">
                {(currentStep === 2 && permissionsGranted.location) ||
                 (currentStep === 3 && permissionsGranted.notifications) ? (
                  <div className="flex items-center gap-2 text-success">
                    <Check size={20} />
                    <span>Permiso concedido</span>
                  </div>
                ) : (
                  <Button
                    variant="masonic-outline"
                    size="lg"
                    onClick={() => handlePermission(currentStep === 2 ? "location" : "notifications")}
                  >
                    {step.action}
                  </Button>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom Action */}
      <div className="px-8 pb-12 safe-area-bottom">
        <Button
          variant="masonic"
          size="xl"
          className="w-full"
          onClick={handleNext}
        >
          {isLastStep ? "Comenzar Registro" : "Continuar"}
          <ChevronRight size={20} />
        </Button>

        {currentStep > 0 && (
          <button
            onClick={() => setCurrentStep(currentStep - 1)}
            className="w-full text-ivory/50 hover:text-ivory mt-4 py-2 transition-colors"
          >
            Volver
          </button>
        )}
      </div>

      {/* Decorative Element */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-navy-dark to-transparent pointer-events-none" />
    </div>
  );
};

export default Onboarding;
