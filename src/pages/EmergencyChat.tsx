import { useEffect, useMemo, useRef, useState } from "react";
import { Send, AlertTriangle, Clock, Loader2, Users, Camera, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { MasonicSymbol } from "@/components/icons/MasonicSymbol";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { UserProfileModal } from "@/components/UserProfileModal";
import { resizeImageForAvatar } from "@/utils/resizeImage";

type ProfileMini = { id: string; full_name: string | null; photo_url: string | null };

function AvatarMini({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = !!avatarUrl && !imgFailed;
  return (
    <div className="w-8 h-8 rounded-full overflow-hidden border border-red-900/30 bg-navy flex items-center justify-center shrink-0">
      {showImage ? (
        <img src={avatarUrl!} alt={name} className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={() => setImgFailed(true)} />
      ) : (
        <MasonicSymbol size={18} className="text-gold" />
      )}
    </div>
  );
}

interface EmergencyMessage {
  id: string;
  message: string;
  user_id: string;
  city: string | null;
  created_at: string;
  expires_at: string | null;
  media_url?: string | null;
  media_type?: string | null;
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
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [profilesById, setProfilesById] = useState<Record<string, ProfileMini>>({});
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [profileModalUserId, setProfileModalUserId] = useState<string | null>(null);
  const [activeUsersCount, setActiveUsersCount] = useState(0);

  // Nuevo estado para visor fullscreen de fotos/videos
  const [selectedMediaUrl, setSelectedMediaUrl] = useState<string | null>(null);
  const [selectedMediaType, setSelectedMediaType] = useState<string | null>(null);

  const fetchProfilesForMessages = async (list: EmergencyMessage[]) => {
    const ids = Array.from(new Set(list.map((m) => m.user_id))).filter(Boolean);
    const missing = ids.filter((id) => !profilesById[id]);
    if (missing.length === 0) return;
    const { data } = await supabase.from("profiles").select("id,full_name,photo_url").in("id", missing);
    if (!data) return;
    const next: Record<string, ProfileMini> = {};
    for (const p of data as ProfileMini[]) next[p.id] = p;
    setProfilesById((prev) => ({ ...prev, ...next }));
  };
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Ciudad del usuario actual (del perfil) — normalizada para matching preciso
  const myCity = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (profile as any)?.city?.trim() || null;
    return raw;
  }, [profile]);

  // Normalized city for case-insensitive comparison
  const myCityNormalized = useMemo(() => {
    return myCity ? myCity.toLowerCase() : null;
  }, [myCity]);

  const fetchMessages = async () => {
    // Traer solo mensajes no expirados
    const query = supabase
      .from("emergency_messages")
      .select("id, message, user_id, city, created_at, expires_at, media_url, media_type, profiles(full_name, city)")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(100);

    // Filtrar por ciudad de forma case-insensitive si el usuario tiene ciudad
    if (myCity) {
      query.ilike("city", myCity);
    }

    const { data, error } = await query;

    if (error) {
      console.error(error);
      toast.error("Error cargando mensajes de emergencia");
      return;
    }

    const list = (data as EmergencyMessage[]) || [];
    setMessages(list);
    fetchProfilesForMessages(list);
    setLoading(false);
  };

  // Count active users in same city
  const fetchActiveUsers = async () => {
    if (!myCity) {
      setActiveUsersCount(0);
      return;
    }
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { count, error } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .ilike("city", myCity)
      .gt("last_seen_at", fiveMinAgo);
    if (!error && count != null) setActiveUsersCount(count);
  };

  useEffect(() => {
    if (!profile) return;
    fetchMessages();
    fetchActiveUsers();

    // Refresh active count every 30 seconds
    const interval = setInterval(fetchActiveUsers, 30000);

    const channel = supabase
      .channel("emergency-messages-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "emergency_messages" },
        (payload) => {
          const newMsg = payload.new as EmergencyMessage;
          // Solo agregar si es de mi ciudad (case-insensitive) o si no tengo ciudad
          const msgCityNorm = newMsg.city?.toLowerCase() || null;
          if (!myCityNormalized || msgCityNorm === myCityNormalized) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });
            fetchProfilesForMessages([newMsg]);
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
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, myCity, myCityNormalized]);

  // Auto-scroll al último mensaje
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Límite de 50MB
    if (file.size > 50 * 1024 * 1024) {
      toast.error("El archivo es demasiado grande (máx 50MB)");
      return;
    }

    setMediaFile(file);
    const url = URL.createObjectURL(file);
    setMediaPreview(url);
  };

  const clearMedia = () => {
    setMediaFile(null);
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    setMediaPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const sendMessage = async () => {
    if ((!text.trim() && !mediaFile) || !user || isSending) return;

    setIsSending(true);
    const messageText = text.trim();

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    
    let uploadedMediaUrl: string | null = null;
    let uploadedMediaType: string | null = null;

    if (mediaFile) {
      setIsUploadingMedia(true);
      let fileToUpload = mediaFile;
      
      if (mediaFile.type.startsWith("image/")) {
        try {
          fileToUpload = await resizeImageForAvatar(mediaFile, 1280, 0.90);
        } catch (e) {
          console.error("Error resizing media image", e);
        }
      }

      const fileExt = fileToUpload.name.split('.').pop() || 'tmp';
      const filePath = `${user.id}/${crypto.randomUUID()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from("emergency_chat_media")
        .upload(filePath, fileToUpload, { cacheControl: "3600", upsert: false });

      if (uploadError) {
        toast.error("Error al subir el archivo multimedia");
        setIsSending(false);
        setIsUploadingMedia(false);
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from("emergency_chat_media")
        .getPublicUrl(filePath);
        
      uploadedMediaUrl = publicUrlData.publicUrl;
      uploadedMediaType = fileToUpload.type;
    }

    const { error } = await supabase.from("emergency_messages").insert({
      message: messageText,
      user_id: user.id,
      city: myCity,
      expires_at: expiresAt,
      media_url: uploadedMediaUrl,
      media_type: uploadedMediaType,
    });

    if (error) {
      console.error(error);
      toast.error("No se pudo enviar el mensaje");
    } else {
      setText("");
      clearMedia();
    }

    setIsUploadingMedia(false);
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
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-xs bg-green-900/30 text-green-400 border border-green-700/30 rounded-full px-2.5 py-1">
                  <Users size={12} />
                  <span className="font-semibold">{activeUsersCount}</span>
                  <span className="hidden sm:inline">activos</span>
                </div>
                <div className="flex items-center gap-1 text-ivory/50 text-xs">
                  <Clock size={14} />
                  <span>24h</span>
                </div>
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
                const p = profilesById[msg.user_id];
                const displayName = p?.full_name
                  ? `Q∴H∴ ${p.full_name}`
                  : msg.profiles?.full_name
                    ? `Q∴H∴ ${msg.profiles.full_name}`
                    : "Q∴H∴";
                const avatarUrl = p?.photo_url ?? null;

                return (
                  <div key={msg.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                    {!isMine && (
                      <div className="mr-2 mt-1">
                        <AvatarMini name={displayName} avatarUrl={avatarUrl} />
                      </div>
                    )}

                    <div className="max-w-[80%]">
                      <div
                        className={`text-xs font-bold mb-1 cursor-pointer hover:underline ${isMine ? "text-right text-gold" : "text-gold"}`}
                        onClick={() => !isMine && setSelectedUserId(msg.user_id)}
                      >
                        {displayName}
                      </div>

                      <div
                        className={[
                          "rounded-lg px-3 py-2 text-sm break-words",
                          isMine
                            ? "bg-gold text-navy rounded-br-md"
                            : "bg-navy/80 text-ivory border border-red-900/20 rounded-bl-md",
                        ].join(" ")}
                      >
                        {msg.media_url && (
                          <div 
                            className="mb-2 rounded-md overflow-hidden bg-black/20 flex flex-col items-center cursor-pointer"
                            onClick={() => {
                              setSelectedMediaUrl(msg.media_url || null);
                              setSelectedMediaType(msg.media_type || null);
                            }}
                          >
                            {msg.media_type?.startsWith("video/") ? (
                              <video src={msg.media_url} className="max-w-full max-h-[300px] object-contain rounded pointer-events-none" />
                            ) : (
                              <img src={msg.media_url} alt="Adjunto" className="max-w-full max-h-[300px] object-contain rounded" />
                            )}
                          </div>
                        )}
                        {msg.message && <p>{msg.message}</p>}
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
                  </div>
                );
              })
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="px-3 py-3 border-t border-white/10 flex flex-col gap-2">
            {mediaPreview && (
              <div className="relative w-fit">
                {mediaFile?.type.startsWith("video/") ? (
                  <video src={mediaPreview} className="h-20 w-20 object-cover rounded-md border border-white/20" />
                ) : (
                  <img src={mediaPreview} alt="Preview" className="h-20 w-20 object-cover rounded-md border border-white/20" />
                )}
                <button
                  onClick={clearMedia}
                  className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full p-1 shadow-md hover:bg-red-700"
                >
                  <X size={14} />
                </button>
              </div>
            )}
            
            <div className="flex gap-2 items-end">
              <input
                type="file"
                accept="image/*,video/*"
                ref={fileInputRef}
                onChange={handleFileSelect}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSending}
                className="shrink-0 bg-transparent border-white/20 text-ivory/70 hover:bg-white/10 hover:text-ivory rounded-md h-[42px] w-[42px]"
              >
                <Camera size={20} />
              </Button>
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Mensaje de emergencia…"
                className="flex-1 rounded-md px-3 py-2 h-[42px] bg-navy/80 text-ivory placeholder:text-ivory/40 outline-none focus:ring-2 focus:ring-red-500/40"
                disabled={isSending}
              />
              <Button
                onClick={sendMessage}
                disabled={(!text.trim() && !mediaFile) || isSending}
                className="h-[42px] bg-red-600 hover:bg-red-700 text-white font-semibold px-4 rounded-md shrink-0"
              >
                {isSending || isUploadingMedia ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Visor Multimedia a Pantalla Completa */}
      {selectedMediaUrl && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-sm p-4"
          onClick={() => {
            setSelectedMediaUrl(null);
            setSelectedMediaType(null);
          }}
        >
          <button 
            className="absolute top-safe right-4 p-2 bg-white/10 rounded-full text-white hover:bg-white/20 transition-colors z-50 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedMediaUrl(null);
              setSelectedMediaType(null);
            }}
          >
            <X size={24} />
          </button>
          
          <div 
            className="max-w-full max-h-full overflow-hidden flex items-center justify-center"
            onClick={(e) => e.stopPropagation()} // Evitar cerrar al tocar la foto en sí
          >
            {selectedMediaType?.startsWith("video/") ? (
              <video 
                src={selectedMediaUrl} 
                controls 
                autoPlay
                className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl" 
              />
            ) : (
              <img 
                src={selectedMediaUrl} 
                alt="Imagen expandida" 
                className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl" 
              />
            )}
          </div>
        </div>
      )}

      <UserProfileModal userId={selectedUserId} onClose={() => setSelectedUserId(null)} />
    </AppLayout>
  );
};

export default EmergencyChat;
