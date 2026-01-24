import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, MapPin, Users } from "lucide-react";
import { toast } from "sonner";

type EmergencyRow = {
  available: boolean;
  others_count: number;
};

export default function Emergency() {
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [othersCount, setOthersCount] = useState(0);

  const RADIUS_KM = 5;
  const FRESH_MINUTES = 5;

  useEffect(() => {
    let mounted = true;

    const check = async () => {
      setLoading(true);

      const { data, error } = await supabase.rpc("emergency_status", {
        radius_km: RADIUS_KM,
        fresh_minutes: FRESH_MINUTES,
      });

      if (!mounted) return;

      if (error) {
        console.error("emergency_status error:", error);
        setAllowed(false);
        setOthersCount(0);
        setLoading(false);
        return;
      }

      const row = (Array.isArray(data) ? (data[0] as EmergencyRow | undefined) : undefined) ?? undefined;
      const ok = row?.available === true;
      const count = typeof row?.others_count === "number" ? row.others_count : 0;

      setAllowed(ok);
      setOthersCount(count);
      setLoading(false);
    };

    check();

    return () => {
      mounted = false;
    };
  }, []);

  const handleShareLocation = () => {
    // Mañana lo conectamos al GPS real y al envío al chat.
    toast.message("Compartir ubicación: Próximamente");
  };

  if (loading) {
    return (
      <div className="p-4">
        <div className="rounded-xl border bg-white/60 p-4">
          <div className="text-sm text-muted-foreground">Verificando canal de emergencia…</div>
        </div>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="p-4">
        <div className="rounded-xl border bg-white/60 p-4">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-5 w-5" />
            Emergencia no disponible
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Este canal solo se habilita cuando hay al menos 2 Q∴H∴ dentro del radio configurado.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="rounded-xl border bg-white/60 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-5 w-5" />
            Chat de Emergencia
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Users className="h-4 w-4" />
            <span>{othersCount + 1}</span>
          </div>
        </div>

        <p className="mt-2 text-sm text-muted-foreground">
          Canal local habilitado. (Hoy dejamos la pantalla lista; mañana conectamos chat + integrantes + GPS)
        </p>

        <button
          type="button"
          onClick={handleShareLocation}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gold px-3 py-2 text-navy text-sm font-semibold"
        >
          <MapPin className="h-4 w-4" />
          Compartir mi ubicación
        </button>
      </div>

      <div className="rounded-xl border bg-white/60 p-4">
        <div className="text-sm font-semibold">Integrantes (próximamente)</div>
        <p className="mt-2 text-sm text-muted-foreground">
          Mañana aquí mostraremos la lista de Q∴H∴ dentro del radio.
        </p>
      </div>

      <div className="rounded-xl border bg-white/60 p-4">
        <div className="text-sm font-semibold">Mensajes (próximamente)</div>
        <p className="mt-2 text-sm text-muted-foreground">
          Mañana conectamos este canal a la tabla de mensajes (similar al chat global).
        </p>
      </div>
    </div>
  );
}
