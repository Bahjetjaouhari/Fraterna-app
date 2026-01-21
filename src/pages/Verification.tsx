import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, AlertTriangle, Check, X, Lock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MasonicSymbol } from "@/components/icons/MasonicSymbol";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useVerification } from "@/hooks/useVerification";

interface Question {
  id: number;
  question: string;
  options: string[];
  correctIndex: number;
}

// Preguntas de verificación del grado Aprendiz
const verificationQuestions: Question[] = [
  {
    id: 1,
    question: "¿Cuántos años tiene un Aprendiz?",
    options: ["Tres años", "Cinco años", "Siete años", "Un año"],
    correctIndex: 0,
  },
  {
    id: 2,
    question: "¿Cuál es la posición del Aprendiz en Logia?",
    options: [
      "Columna del Sur",
      "Columna del Norte",
      "Al Oriente",
      "Al Occidente",
    ],
    correctIndex: 1,
  },
  {
    id: 3,
    question: "¿Cuáles son las herramientas del Aprendiz?",
    options: [
      "Compás y Escuadra",
      "Martillo y Cincel",
      "Regla de 24 pulgadas y Mazo",
      "Nivel y Plomada",
    ],
    correctIndex: 2,
  },
  {
    id: 4,
    question: "¿Qué representa la Piedra Bruta?",
    options: [
      "La perfección alcanzada",
      "El trabajo del Compañero",
      "El Aprendiz sin pulir, trabajo por hacer",
      "La culminación del viaje",
    ],
    correctIndex: 2,
  },
];

export const Verification: React.FC = () => {
  const navigate = useNavigate();
  const { user, profile, isVerified, isLoading: authLoading } = useAuth();
  const { 
    isBlocked, 
    remainingAttempts, 
    recordFailedAttempt, 
    recordSuccessfulVerification,
    isLoading: verificationLoading 
  } = useVerification();

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [correctAnswers, setCorrectAnswers] = useState(0);
  const [isAnswered, setIsAnswered] = useState(false);
  const [verificationComplete, setVerificationComplete] = useState(false);
  const [localBlocked, setLocalBlocked] = useState(false);

  const requiredCorrect = 3; // Mínimo 3 de 4 correctas
  const currentQuestion = verificationQuestions[currentQuestionIndex];

  // Redirect if already verified
  useEffect(() => {
    if (!authLoading && isVerified) {
      navigate("/map");
    }
  }, [isVerified, authLoading, navigate]);

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/login");
    }
  }, [user, authLoading, navigate]);

  // Check blocked status from profile
  useEffect(() => {
    if (profile?.verification_status === 'manual_review' || profile?.verification_status === 'blocked') {
      setLocalBlocked(true);
    }
  }, [profile]);

  const handleSelectAnswer = (index: number) => {
    if (isAnswered || isBlocked || localBlocked) return;
    setSelectedAnswer(index);
  };

  const handleSubmitAnswer = async () => {
    if (selectedAnswer === null || isAnswered) return;

    setIsAnswered(true);
    const isCorrect = selectedAnswer === currentQuestion.correctIndex;

    if (isCorrect) {
      setCorrectAnswers(prev => prev + 1);
    }

    // Avanzar después de un momento
    setTimeout(async () => {
      if (currentQuestionIndex < verificationQuestions.length - 1) {
        setCurrentQuestionIndex(prev => prev + 1);
        setSelectedAnswer(null);
        setIsAnswered(false);
      } else {
        // Evaluación final
        const totalCorrect = correctAnswers + (isCorrect ? 1 : 0);
        
        if (totalCorrect >= requiredCorrect) {
          const success = await recordSuccessfulVerification();
          if (success) {
            setVerificationComplete(true);
            toast.success("¡Verificación exitosa!");
          } else {
            toast.error("Error al guardar verificación");
          }
        } else {
          const wasBlocked = await recordFailedAttempt();
          
          if (wasBlocked) {
            setLocalBlocked(true);
            toast.error("Has excedido los intentos permitidos");
          } else {
            toast.error(`Verificación fallida. Intentos restantes: ${remainingAttempts - 1}`);
            // Reset para nuevo intento
            setCurrentQuestionIndex(0);
            setCorrectAnswers(0);
            setSelectedAnswer(null);
            setIsAnswered(false);
          }
        }
      }
    }, 1500);
  };

  // Loading state
  if (authLoading || verificationLoading) {
    return (
      <div className="min-h-screen bg-navy flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-gold animate-spin" />
      </div>
    );
  }

  // Estado bloqueado
  if (isBlocked || localBlocked) {
    return (
      <div className="min-h-screen bg-navy flex flex-col items-center justify-center px-8 text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-sm"
        >
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-destructive/20 flex items-center justify-center">
            <Lock className="w-10 h-10 text-destructive" />
          </div>
          <h1 className="font-display text-2xl text-ivory mb-4">
            Cuenta en Revisión
          </h1>
          <p className="text-ivory/70 mb-8">
            Has excedido los intentos de verificación. Tu solicitud será revisada manualmente por un administrador.
          </p>
          <div className="p-4 rounded-lg bg-warning/10 border border-warning/30 mb-8">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
              <p className="text-sm text-ivory/80 text-left">
                Recibirás una notificación cuando tu cuenta sea revisada. Esto puede tomar 24-48 horas.
              </p>
            </div>
          </div>
          <Button
            variant="masonic-outline"
            onClick={() => navigate("/")}
          >
            Volver al inicio
          </Button>
        </motion.div>
      </div>
    );
  }

  // Verificación completada
  if (verificationComplete) {
    return (
      <div className="min-h-screen bg-navy flex flex-col items-center justify-center px-8 text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-sm"
        >
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-success/20 flex items-center justify-center">
            <Check className="w-10 h-10 text-success" />
          </div>
          <h1 className="font-display text-2xl text-ivory mb-4">
            ¡Verificación Exitosa!
          </h1>
          <p className="text-ivory/70 mb-8">
            Bienvenido, Q∴H∴. Tu identidad masónica ha sido verificada. Ya puedes acceder a todas las funciones de Fraterna.
          </p>
          <MasonicSymbol size={60} className="text-gold mx-auto mb-8" />
          <Button
            variant="masonic"
            size="xl"
            className="w-full"
            onClick={() => navigate("/map")}
          >
            Explorar el Mapa
          </Button>
        </motion.div>
      </div>
    );
  }

  // Cuestionario activo
  return (
    <div className="min-h-screen bg-navy flex flex-col">
      {/* Header */}
      <div className="pt-12 pb-6 px-6">
        <Link to="/register" className="text-ivory/60 text-sm mb-4 inline-block">
          ← Volver
        </Link>
        <div className="flex items-center gap-3 mb-4">
          <Shield className="w-8 h-8 text-gold" />
          <div>
            <h1 className="font-display text-xl text-ivory">Verificación Masónica</h1>
            <p className="text-ivory/60 text-sm">
              Pregunta {currentQuestionIndex + 1} de {verificationQuestions.length}
            </p>
          </div>
        </div>
        
        {/* Progress Bar */}
        <div className="h-2 bg-navy-light rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gold"
            initial={{ width: 0 }}
            animate={{ 
              width: `${((currentQuestionIndex + 1) / verificationQuestions.length) * 100}%` 
            }}
            transition={{ duration: 0.3 }}
          />
        </div>

        {/* Attempts Warning */}
        {remainingAttempts < 3 && (
          <div className="mt-4 p-3 rounded-lg bg-warning/10 border border-warning/30">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-warning" />
              <span className="text-sm text-warning">
                Intentos restantes: {remainingAttempts}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Question */}
      <div className="flex-1 px-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentQuestionIndex}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            <h2 className="text-xl text-ivory mb-6 leading-relaxed">
              {currentQuestion.question}
            </h2>

            <div className="space-y-3">
              {currentQuestion.options.map((option, index) => {
                const isSelected = selectedAnswer === index;
                const isCorrect = index === currentQuestion.correctIndex;
                const showResult = isAnswered;

                return (
                  <button
                    key={index}
                    onClick={() => handleSelectAnswer(index)}
                    disabled={isAnswered}
                    className={`w-full p-4 rounded-lg text-left transition-all duration-300 border-2 ${
                      showResult
                        ? isCorrect
                          ? "bg-success/20 border-success text-success"
                          : isSelected
                            ? "bg-destructive/20 border-destructive text-destructive"
                            : "bg-navy-light/50 border-navy-light text-ivory/50"
                        : isSelected
                          ? "bg-gold/20 border-gold text-ivory"
                          : "bg-navy-light border-navy-light text-ivory hover:border-gold/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>{option}</span>
                      {showResult && isCorrect && (
                        <Check className="w-5 h-5" />
                      )}
                      {showResult && isSelected && !isCorrect && (
                        <X className="w-5 h-5" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Submit Button */}
      <div className="px-6 pb-12 safe-area-bottom">
        <Button
          variant="masonic"
          size="xl"
          className="w-full"
          onClick={handleSubmitAnswer}
          disabled={selectedAnswer === null || isAnswered}
        >
          {isAnswered ? "Procesando..." : "Confirmar Respuesta"}
        </Button>
      </div>
    </div>
  );
};

export default Verification;
