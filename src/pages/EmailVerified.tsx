import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Loader2 } from "lucide-react";
import { MasonicSymbol } from "@/components/icons/MasonicSymbol";
import { Button } from "@/components/ui/button";

const EmailVerified = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    // Supabase appends #access_token=... to the redirect URL
    // We need to let Supabase handle the hash and exchange the token
    const handleVerification = async () => {
      try {
        // getSession will automatically handle the hash fragment tokens
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          setErrorMsg(error.message);
          setStatus("error");
          return;
        }

        if (data.session) {
          setStatus("success");
        } else {
          // No session but no error — might already be verified
          setStatus("success");
        }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        setErrorMsg(e?.message || "Error inesperado");
        setStatus("error");
      }
    };

    // Small delay to let Supabase process the URL hash tokens
    const timer = setTimeout(handleVerification, 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-navy flex flex-col items-center justify-center px-6">
      <div className="max-w-sm w-full flex flex-col items-center text-center">
        {status === "loading" && (
          <>
            <Loader2 className="w-16 h-16 text-gold animate-spin mb-6" />
            <h1 className="font-display text-2xl text-ivory mb-2">
              Verificando tu email...
            </h1>
            <p className="text-ivory/60 text-sm">Un momento por favor</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="w-20 h-20 rounded-full bg-success/20 flex items-center justify-center mb-6">
              <CheckCircle2 className="w-10 h-10 text-success" />
            </div>
            <h1 className="font-display text-2xl text-ivory mb-2">
              ¡Email Verificado!
            </h1>
            <p className="text-ivory/60 text-sm mb-8">
              Tu cuenta ha sido verificada exitosamente. Ya puedes acceder a Fraterna.
            </p>
            <Button
              variant="masonic"
              size="xl"
              className="w-full"
              onClick={() => navigate("/login")}
            >
              Iniciar Sesión
            </Button>
          </>
        )}

        {status === "error" && (
          <>
            <MasonicSymbol size={60} className="text-gold/50 mb-6" />
            <h1 className="font-display text-2xl text-ivory mb-2">
              Error de Verificación
            </h1>
            <p className="text-ivory/60 text-sm mb-2">
              No se pudo verificar tu email.
            </p>
            {errorMsg && (
              <p className="text-red-400/80 text-xs mb-8 bg-red-950/30 rounded-lg px-3 py-2">
                {errorMsg}
              </p>
            )}
            <Button
              variant="masonic"
              size="xl"
              className="w-full"
              onClick={() => navigate("/login")}
            >
              Ir al Login
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export default EmailVerified;
