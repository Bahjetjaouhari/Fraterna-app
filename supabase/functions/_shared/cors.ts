// supabase/functions/_shared/cors.ts

export const getCorsHeaders = (req: Request) => {
  const allowedOrigins = [
    "https://fraterna.lovable.app",
    "http://localhost:8080",
    "https://localhost:8080",
    "http://127.0.0.1:8080",
    "https://127.0.0.1:8080"
  ];

  const origin = req.headers.get("Origin") || "";
  // Si el origen de la request está en la lista de permitidos, devolver ese origen.
  // De lo contrario, devolver por defecto el dominio en producción (bloqueará browsers no autorizados).
  const allowOrigin = allowedOrigins.includes(origin) ? origin : "https://fraterna.lovable.app";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
};
