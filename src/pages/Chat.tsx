import React, { useEffect, useRef, useState } from "react";
import { Send, Mic, Clock, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppLayout } from "@/components/layout/AppLayout";
import { MasonicSymbol } from "@/components/icons/MasonicSymbol";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ChatMessage {
  id: string;
  user_id: string;
  content: string | null;
  created_at: string;
  expires_at: string;
  deleted_by_admin: boolean;
}

export default function Chat() {
  const { user, isAdmin } = useAuth();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchMessages = async () => {
    const { data, error } = await supabase
      .from("chat_messages")
      .select("id,user_id,content,created_at,expires_at,deleted_by_admin")
      .eq("deleted_by_admin", false)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(200);

    if (!error && data) setMessages(data as ChatMessage[]);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchMessages();

    const channel = supabase
      .channel("chat-global")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_messages" },
        () => {
          fetchMessages();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !user || isSending) return;

    setIsSending(true);
    const messageText = newMessage.trim();
    setNewMessage("");

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { error } = await supabase.from("chat_messages").insert({
      user_id: user.id,
      content: messageText,
      expires_at: expiresAt,
    });

    if (error) {
      toast.error("Error al enviar mensaje");
      setNewMessage(messageText);
    }

    setIsSending(false);
  };

  const formatTime = (dateStr: string) =>
    new Date(dateStr).toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });

  const getTimeRemaining = (expiresAt: string) => {
    const diff = new Date(expiresAt).getTime() - Date.now();
    const hours = Math.max(0, Math.floor(diff / 3600000));
    return `${hours}h`;
  };

  return (
    <AppLayout showNav={true} isAdmin={isAdmin}>
      <div className="h-screen flex flex-col bg-background">
        {/* Header (como antes) */}
        <div className="bg-navy px-4 pt-12 pb-4 safe-area-top">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MasonicSymbol size={32} className="text-gold" />
              <div>
                <h1 className="font-display text-lg text-ivory">Chat Global</h1>
                <p className="text-ivory/60 text-xs">
                  {messages.length} mensajes activos
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-ivory/60 text-xs">
              <Clock size={14} />
              <span>Auto-borrado: 24h</span>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scrollbar-masonic">
          <div className="flex items-center justify-center py-2">
            <div className="flex items-center gap-2 text-muted-foreground text-xs bg-muted rounded-full px-3 py-1">
              <AlertCircle size={12} />
              <span>Los mensajes se eliminan automáticamente después de 24h</span>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-gold animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-center">
              <div>
                <MasonicSymbol size={48} className="text-gold/40 mx-auto mb-4" />
                <p className="text-muted-foreground">No hay mensajes aún</p>
                <p className="text-sm text-muted-foreground">Sé el primero en saludar</p>
              </div>
            </div>
          ) : (
            messages.map((message) => {
              const isMe = message.user_id === user?.id;

              return (
                <div
                  key={message.id}
                  className={`flex ${isMe ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] ${
                      isMe
                        ? "bg-primary text-primary-foreground rounded-2xl rounded-br-md"
                        : "bg-card border border-border rounded-2xl rounded-bl-md"
                    } px-4 py-3`}
                  >
                    <p className="text-sm">{message.content ?? ""}</p>

                    <div className="flex items-center justify-end gap-2 mt-1">
                      <span className="text-[10px] opacity-50">
                        {formatTime(message.created_at)}
                      </span>
                      <span className="text-[10px] opacity-30">
                        · {getTimeRemaining(message.expires_at)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area (como antes) */}
        <div className="border-t border-border bg-card px-4 py-3 safe-area-bottom">
          <div className="flex items-center gap-2">
            <Input
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              placeholder="Escribe un mensaje..."
              className="flex-1 input-masonic"
              disabled={isSending}
            />

            {/* Voice (lo dejamos para mañana, pero queda el botón) */}
            <Button
              variant="masonic-dark"
              size="icon"
              onClick={() => toast.info("Mensajes de voz: lo activamos mañana")}
            >
              <Mic size={20} />
            </Button>

            <Button
              variant="masonic"
              size="icon"
              onClick={handleSendMessage}
              disabled={!newMessage.trim() || isSending}
            >
              {isSending ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <Send size={20} />
              )}
            </Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
