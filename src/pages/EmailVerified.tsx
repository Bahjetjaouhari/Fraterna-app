import { Button } from "@/components/ui/button";
import { CheckCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function EmailVerified() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="max-w-md w-full text-center space-y-6">
        <CheckCircle className="mx-auto h-16 w-16 text-green-500" />

        <h1 className="text-2xl font-display text-foreground">
          Correo verificado
        </h1>

        <p className="text-muted-foreground">
          Tu correo electrónico ya fue verificado correctamente.
          Ya puedes continuar con Fraterna.
        </p>

        <Button
          variant="masonic"
          className="w-full"
          onClick={() => navigate("/login")}
        >
          Ir a iniciar sesión
        </Button>
      </div>
    </div>
  );
}
