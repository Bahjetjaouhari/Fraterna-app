import React, { useState } from "react";
import {
  Shield,
  Users,
  MessageCircle,
  AlertTriangle,
  Clock,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppLayout } from "@/components/layout/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

export const AdminPanel: React.FC = () => {
  const { isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState("chat");

  const handleClearChat = async () => {
    const ok = confirm(
      "⚠️ ¿Estás seguro de vaciar todo el chat global?\nEsta acción no se puede deshacer."
    );
    if (!ok) return;

    const { error } = await supabase.rpc("admin_clear_chat");

    if (error) {
      toast.error("No se pudo vaciar el chat");
      console.error(error);
      return;
    }

    toast.success("Chat vaciado correctamente");
  };

  return (
    <AppLayout showNav isAdmin>
      <div className="min-h-screen bg-background pb-24">
        <div className="bg-navy pt-12 pb-6 px-6 safe-area-top">
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8 text-gold" />
            <div>
              <h1 className="font-display text-xl text-ivory">
                Panel de Administración
              </h1>
              <p className="text-ivory/60 text-sm">Control y moderación</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full mb-6">
              <TabsTrigger value="users" className="flex-1">
                <Users size={16} className="mr-2" />
                Usuarios
              </TabsTrigger>
              <TabsTrigger value="reports" className="flex-1">
                <AlertTriangle size={16} className="mr-2" />
                Reportes
              </TabsTrigger>
              <TabsTrigger value="chat" className="flex-1">
                <MessageCircle size={16} className="mr-2" />
                Chat
              </TabsTrigger>
            </TabsList>

            <TabsContent value="chat">
              <div className="card-masonic p-4 mb-6">
                <h3 className="font-medium mb-4">Configuración del Chat</h3>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Auto-eliminación</p>
                    <p className="text-sm text-muted-foreground">
                      Tiempo antes de eliminar mensajes
                    </p>
                  </div>
                  <div className="flex items-center gap-2 bg-muted px-3 py-2 rounded-lg">
                    <Clock size={16} className="text-gold" />
                    <span>24 horas</span>
                    <ChevronDown size={16} />
                  </div>
                </div>

                {isAdmin && (
                  <div className="mt-4 flex justify-end">
                    <Button variant="destructive" onClick={handleClearChat}>
                      Vaciar chat
                    </Button>
                  </div>
                )}
              </div>

              <div className="card-masonic p-4">
                <h3 className="font-medium mb-4">Mensajes Recientes</h3>
                <p className="text-sm text-muted-foreground text-center py-6">
                  No hay mensajes reportados
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
};

export default AdminPanel;
