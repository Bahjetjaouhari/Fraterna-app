import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { toast } from "sonner";

interface EmergencyMessage {
  id: string; // uuid
  message: string;
  user_id: string;
  created_at: string;
  profiles?: {
    full_name: string | null;
    city: string | null;
  } | null;
}

const EmergencyChat = () => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<EmergencyMessage[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchMessages = async () => {
    const { data, error } = await supabase
      .from("emergency_messages")
      .select("id, message, user_id, created_at, profiles(full_name, city)")
      .order("created_at", { ascending: true });

    if (error) {
      console.error(error);
      toast.error("Error cargando mensajes de emergencia");
      return;
    }

    setMessages((data as EmergencyMessage[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchMessages();

    const channel = supabase
      .channel("emergency-messages-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "emergency_messages" },
        () => {
          // refrescamos para traer el join de profiles
          fetchMessages();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendMessage = async () => {
    if (!text.trim()) return;
    if (!user) return;

    const { error } = await supabase.from("emergency_messages").insert({
      message: text.trim(),
      user_id: user.id,
    });

    if (error) {
      console.error(error);
      toast.error("No se pudo enviar el mensaje");
      return;
    }

    setText("");
  };

  return (
    <AppLayout showNav={true} darkMode={true}>
      {/* Esto pinta también el padding-bottom que agrega AppLayout (para que no quede blanco) */}
      <div
          className="bg-map-bg"
          style={{
           position: "fixed",
                 inset: 0,
            overflow: "hidden",
          }}
>

        {/* NO usamos paddingBottom aquí (AppLayout ya lo hace). 
            Definimos altura exacta hasta la BottomNav. */}
        <div
          className="flex flex-col bg-map-bg"
          style={{
            height:
              "calc(100dvh - var(--bottom-nav-h, 5rem) - env(safe-area-inset-bottom, 0px))",
          }}
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-white/10">
            <h1 className="text-ivory font-semibold text-lg">
              Chat de Emergencia
            </h1>
            <p className="text-ivory/60 text-sm">
              Canal local entre Q∴H∴ cercanos
            </p>
          </div>

          {/* Mensajes */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
            {loading && (
              <p className="text-ivory/60 text-sm">Cargando mensajes…</p>
            )}

            {!loading && messages.length === 0 && (
              <p className="text-ivory/60 text-sm">
                Aún no hay mensajes de emergencia.
              </p>
            )}

            {messages.map((msg) => {
              const isMine = msg.user_id === user?.id;
              const name = msg.profiles?.full_name || "Q∴H∴";

              return (
                <div
                  key={msg.id}
                  className={isMine ? "text-right" : "text-left"}
                >
                  <div
                    className={[
                      // CLAVE: inline-block/w-fit para que NO ocupe todo el ancho
                      "inline-block w-fit max-w-[80%] rounded-lg px-3 py-2 text-sm break-words",
                      isMine
                        ? "ml-auto bg-gold text-navy"
                        : "mr-auto bg-navy/80 text-ivory",
                    ].join(" ")}
                  >
                    {!isMine && (
                      <p className="text-xs font-semibold opacity-80 mb-1">
                        {name}
                      </p>
                    )}
                    <p>{msg.message}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Input */}
          <div className="px-4 py-3 border-t border-white/10 flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Mensaje de emergencia…"
              className="flex-1 rounded-md px-3 py-2 bg-navy/80 text-ivory placeholder:text-ivory/40 outline-none"
            />
            <button
              onClick={sendMessage}
              className="bg-gold text-navy font-semibold px-4 rounded-md"
            >
              Enviar
            </button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default EmergencyChat;
