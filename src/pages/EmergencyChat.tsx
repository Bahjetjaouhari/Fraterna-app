import { useEffect, useMemo, useRef, useState } from "react";
import { Send, AlertTriangle, Clock, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { MasonicSymbol } from "@/components/icons/MasonicSymbol";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface EmergencyMessage {
  id: string;
  message: string;
  user_id: string;
  city: string | null;
  created_at: string;
  expires_at: string | null;
  profiles?: {
    full_name: string | null;
    city: string | null;
  } | null;
}

const EmergencyChat = () => {
  const { user, profile, isAdmin } = useAuth();
  const [messages, setMessages] = useState<EmergencyMessage[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Ciudad del usuario actual (del perfil)
  const myCity = useMemo(() => {
    return (profile as any)?.city?.trim() || null;
  }, [profile]);

  const fetchMessages = async () => {
    // Traer solo mensajes no expirados
    const query = supabase
      .from("emergency_messages")
      .select("id, message, user_id, city, created_at, expires_at, profiles(full_name, city)")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(100);

    // Filtrar por ciudad si el usuario tiene ciudad
    if (myCity) {
      query.eq("city", myCity);
    }

    const { data, error } = await query;

    if (error) {
      console.error(error);
      toast.error("Error cargando mensajes de emergencia");
      return;
    }

    setMessages((data as EmergencyMessage[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    if (!profile) return;
    fetchMessages();

    const channel = supabase
      .channel("emergency-messages-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "emergency_messages" },
        (payload) => {
          const newMsg = payload.new as EmergencyMessage;
          // Solo agregar si es de mi ciudad (o si no tengo ciudad)
          if (!myCity || newMsg.city === myCity) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "emergency_messages" },
        () => fetchMessages()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, myCity]);

  // Auto-scroll al último mensaje
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!text.trim() || !user || isSending) return;

    setIsSending(true);
    const messageText = text.trim();
    setText("");

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { error } = await supabase.from("emergency_messages").insert({
      message: messageText,
      user_id: user.id,
      city: myCity,
      expires_at: expiresAt,
    });

    if (error) {
      console.error(error);
      toast.error("No se pudo enviar el mensaje");
      setText(messageText);
    }

    setIsSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") sendMessage();
  };

  const formatTime = (dateStr: string) =>
    new Date(dateStr).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

  const getTimeRemaining = (expiresAt: string | null) => {
    if (!expiresAt) return "";
    const diff = new Date(expiresAt).getTime() - Date.now();
    const hours = Math.max(0, Math.floor(diff / 3600000));
    return `${hours}h`;
  };

  return (
    <AppLayout showNav={true} isAdmin={isAdmin}>
      <div
        className="bg-map-bg"
        style={{ position: "fixed", inset: 0, overflow: "hidden" }}
      >
        <div
          className="flex flex-col bg-map-bg"
          style={{
            height: "calc(100dvh - var(--bottom-nav-h, 5rem) - env(safe-area-inset-bottom, 0px))",
          }}
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-red-900/30 bg-red-950/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-900/30 border border-red-500/30 flex items-center justify-center">
                  <AlertTriangle className="text-red-400" size={22} />
                </div>
                <div>
                  <h1 className="text-ivory font-semibold text-lg">
                    Emergencia Local
                  </h1>
                  <p className="text-ivory/60 text-xs">
                    {myCity ? `📍 ${myCity}` : "Canal local"} · {messages.length} mensajes
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-ivory/50 text-xs">
                <Clock size={14} />
                <span>24h</span>
              </div>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
            {/* Aviso */}
            <div className="flex items-center justify-center py-2">
              <div className="flex items-center gap-2 text-red-300/80 text-xs bg-red-950/30 rounded-full px-3 py-1 border border-red-900/20">
                <AlertTriangle size={12} />
                <span>Solo para emergencias reales entre Q∴H∴ de {myCity || "tu ciudad"}</span>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 text-red-400 animate-spin" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-center">
                <div>
                  <MasonicSymbol size={48} className="text-gold/40 mx-auto mb-4" />
                  <p className="text-muted-foreground">No hay alertas de emergencia</p>
                  <p className="text-sm text-muted-foreground">Este canal es solo para emergencias reales</p>
                </div>
              </div>
            ) : (
              messages.map((msg) => {
                const isMine = msg.user_id === user?.id;
                const name = msg.profiles?.full_name
                  ? `Q∴H∴ ${msg.profiles.full_name}`
                  : "Q∴H∴";

                return (
                  <div key={msg.id} className={isMine ? "text-right" : "text-left"}>
                    <div
                      className={[
                        "inline-block w-fit max-w-[80%] rounded-lg px-3 py-2 text-sm break-words",
                        isMine
                          ? "ml-auto bg-gold text-navy"
                          : "mr-auto bg-navy/80 text-ivory border border-red-900/20",
                      ].join(" ")}
                    >
                      {!isMine && (
                        <p className="text-xs font-semibold opacity-80 mb-1">
                          {name}
                        </p>
                      )}
                      <p>{msg.message}</p>
                      <div className="flex items-center justify-end gap-2 mt-1">
                        <span className="text-[10px] opacity-50">
                          {formatTime(msg.created_at)}
                        </span>
                        {msg.expires_at && (
                          <span className="text-[10px] opacity-30">
                            · {getTimeRemaining(msg.expires_at)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="px-4 py-3 border-t border-white/10 flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Mensaje de emergencia…"
              className="flex-1 rounded-md px-3 py-2 bg-navy/80 text-ivory placeholder:text-ivory/40 outline-none focus:ring-2 focus:ring-red-500/40"
              disabled={isSending}
            />
            <Button
              onClick={sendMessage}
              disabled={!text.trim() || isSending}
              className="bg-red-600 hover:bg-red-700 text-white font-semibold px-4 rounded-md"
            >
              {isSending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default EmergencyChat;
