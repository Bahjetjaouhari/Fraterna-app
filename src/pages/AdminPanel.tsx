import React, { useEffect, useMemo, useState } from "react";
import {
  Shield,
  Users,
  MessageCircle,
  AlertTriangle,
  Clock,
  ChevronDown,
  RefreshCcw,
  Search,
  UserX,
  UserCheck,
  UserPlus,
  UserMinus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppLayout } from "@/components/layout/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string | null;
  is_active: boolean | null;
  created_at: string | null;
};

const SUPER_ADMIN_IDS = (import.meta.env.VITE_SUPER_ADMIN_IDS ?? "")
  .split(",")
  .map((s: string) => s.trim())
  .filter(Boolean);

type AdminUserBody = {
  action: "ban" | "unban";
  targetUserId: string;
};

type AdminRoleBody = {
  action: "grant" | "revoke";
  targetUserId: string;
};

export const AdminPanel: React.FC = () => {
  const { isAdmin } = useAuth();

  const [activeTab, setActiveTab] = useState<"users" | "reports" | "chat">("users");

  // Users state
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersRefreshing, setUsersRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const isProtectedUser = (userId: string) => SUPER_ADMIN_IDS.includes(userId);

  const getAccessTokenOrThrow = async (): Promise<string> => {
    // 1) intenta leer sesión
    const { data: s1, error: e1 } = await supabase.auth.getSession();
    if (e1) throw e1;

    if (s1.session?.access_token) return s1.session.access_token;

    // 2) si no hay, intenta refrescar
    const { data: s2, error: e2 } = await supabase.auth.refreshSession();
    if (e2) throw e2;

    const token = s2.session?.access_token;
    if (!token) throw new Error("No hay sesión activa (sin access_token). Vuelve a iniciar sesión.");
    return token;
  };

  /**
   * ✅ FIX 401:
   * Supabase Edge Functions requiere:
   * - Authorization: Bearer <token>
   * - apikey: <anon key>
   */
  const invokeWithAuth = async <TBody extends object, TResp = any>(
    functionName: string,
    body: TBody
  ) => {
    const token = await getAccessTokenOrThrow();

    const { data, error } = await supabase.functions.invoke(functionName, {
      body,
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
    });

    if (error) {
      console.error(`[${functionName}] invoke error:`, error);
      throw new Error(`${functionName}: ${(error as any)?.message ?? "Edge Function error"}`);
    }

    if ((data as any)?.error) {
      console.error(`[${functionName}] response error:`, data);
      throw new Error(`${functionName}: ${(data as any).error}`);
    }

    return data as TResp;
  };

  const loadUsers = async (opts?: { silent?: boolean }) => {
    if (!isAdmin) return;

    const silent = opts?.silent ?? false;

    if (!silent) setUsersLoading(true);
    else setUsersRefreshing(true);

    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,email,full_name,role,is_active,created_at")
        .order("created_at", { ascending: false });

      if (error) {
        console.error(error);
        toast.error("No se pudieron cargar los usuarios");
        return;
      }

      setUsers((data ?? []) as ProfileRow[]);
    } finally {
      setUsersLoading(false);
      setUsersRefreshing(false);
    }
  };

  const banUnbanUser = async (targetUserId: string, shouldBan: boolean) => {
    if (!isAdmin) return;

    if (isProtectedUser(targetUserId)) {
      toast.error("Este usuario está protegido y no puede ser modificado.");
      return;
    }

    const confirmText = shouldBan
      ? "⚠️ ¿Seguro que quieres BANEAR este usuario?\nNo podrá iniciar sesión."
      : "¿Seguro que quieres DESBANEAR este usuario?\nPodrá iniciar sesión nuevamente.";

    const ok = confirm(confirmText);
    if (!ok) return;

    try {
      toast.loading(shouldBan ? "Baneando usuario..." : "Desbaneando usuario...", {
        id: "ban-unban",
      });

      const body: AdminUserBody = {
        action: shouldBan ? "ban" : "unban",
        targetUserId,
      };

      await invokeWithAuth<AdminUserBody>("admin-user", body);

      toast.success(shouldBan ? "Usuario baneado" : "Usuario desbaneado", {
        id: "ban-unban",
      });

      await loadUsers({ silent: true });
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Ocurrió un error inesperado";
      toast.error(msg, { id: "ban-unban" });
    }
  };

  const setAdminRole = async (targetUserId: string, makeAdmin: boolean) => {
    if (!isAdmin) return;

    if (isProtectedUser(targetUserId)) {
      toast.error("Este usuario está protegido y no puede ser modificado.");
      return;
    }

    const confirmText = makeAdmin
      ? "¿Seguro que quieres DAR admin a este usuario?"
      : "¿Seguro que quieres QUITAR admin a este usuario?";

    const ok = confirm(confirmText);
    if (!ok) return;

    try {
      toast.loading(makeAdmin ? "Dando admin..." : "Quitando admin...", {
        id: "admin-role",
      });

      const body: AdminRoleBody = {
        action: makeAdmin ? "grant" : "revoke",
        targetUserId,
      };

      await invokeWithAuth<AdminRoleBody>("admin-role", body);

      toast.success(makeAdmin ? "Admin asignado" : "Admin removido", { id: "admin-role" });
      await loadUsers({ silent: true });
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "No se pudo cambiar el rol (Edge Function)";
      toast.error(msg, { id: "admin-role" });
    }
  };

  const handleClearChat = async () => {
    if (!isAdmin) return;

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

  useEffect(() => {
    if (activeTab === "users" && isAdmin) loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isAdmin]);

  const filteredUsers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return users;

    return users.filter((u) => {
      const name = (u.full_name ?? "").toLowerCase();
      const email = (u.email ?? "").toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [users, searchTerm]);

  return (
    <AppLayout showNav isAdmin>
      <div className="min-h-screen bg-background pb-24">
        {/* Header */}
        <div className="bg-navy pt-12 pb-6 px-6 safe-area-top">
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8 text-gold" />
            <div>
              <h1 className="font-display text-xl text-ivory">Panel de Administración</h1>
              <p className="text-ivory/60 text-sm">Control y moderación</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-6">
          {!isAdmin ? (
            <div className="card-masonic p-4">
              <h3 className="font-medium mb-2">Acceso restringido</h3>
              <p className="text-sm text-muted-foreground">
                No tienes permisos de administrador para ver este panel.
              </p>
            </div>
          ) : (
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
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

              {/* USERS TAB */}
              <TabsContent value="users">
                <div className="card-masonic p-4 mb-6">
                  <div className="flex items-start sm:items-center justify-between gap-3 flex-col sm:flex-row">
                    <div>
                      <h3 className="font-medium">Usuarios registrados</h3>
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <div className="flex items-center gap-2 bg-muted px-3 py-2 rounded-lg w-full sm:w-[320px]">
                        <Search size={16} className="text-muted-foreground" />
                        <input
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          placeholder="Buscar por nombre o email..."
                          className="bg-transparent outline-none text-sm w-full"
                        />
                      </div>

                      <Button
                        variant="secondary"
                        onClick={() => loadUsers({ silent: true })}
                        disabled={usersRefreshing}
                        className="shrink-0"
                      >
                        <RefreshCcw
                          size={16}
                          className={`mr-2 ${usersRefreshing ? "animate-spin" : ""}`}
                        />
                        Actualizar
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="card-masonic p-4">
                  {usersLoading ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      Cargando usuarios...
                    </p>
                  ) : filteredUsers.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No hay usuarios para mostrar.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {filteredUsers.map((u) => {
                        const active = u.is_active !== false;
                        const isAdminRole = (u.role ?? "") === "admin";
                        const protectedUser = isProtectedUser(u.id);

                        return (
                          <div
                            key={u.id}
                            className="flex items-center justify-between gap-3 border border-border rounded-xl p-3 bg-background/50"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-medium truncate max-w-[280px]">
                                  {u.full_name?.trim() || "Sin nombre"}
                                </p>

                                <span
                                  className={`text-xs px-2 py-0.5 rounded-full border ${
                                    active
                                      ? "border-green-500/30 text-green-600"
                                      : "border-red-500/30 text-red-600"
                                  }`}
                                >
                                  {active ? "Activo" : "Baneado"}
                                </span>

                                <span className="text-xs px-2 py-0.5 rounded-full border border-border text-muted-foreground">
                                  {isAdminRole ? "admin" : "user"}
                                </span>

                                {protectedUser ? (
                                  <span className="text-xs px-2 py-0.5 rounded-full border border-gold/40 text-gold">
                                    Protegido
                                  </span>
                                ) : null}
                              </div>

                              <p className="text-sm text-muted-foreground truncate">
                                {u.email || "Sin email"}
                              </p>
                              <p className="text-xs text-muted-foreground/80 truncate">
                                ID: {u.id}
                              </p>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {/* Ban / Unban */}
                              {active ? (
                                <Button
                                  variant="destructive"
                                  onClick={() => banUnbanUser(u.id, true)}
                                  disabled={protectedUser}
                                >
                                  <UserX size={16} className="mr-2" />
                                  Ban
                                </Button>
                              ) : (
                                <Button
                                  variant="secondary"
                                  onClick={() => banUnbanUser(u.id, false)}
                                  disabled={protectedUser}
                                >
                                  <UserCheck size={16} className="mr-2" />
                                  Unban
                                </Button>
                              )}

                              {/* Admin role */}
                              {!isAdminRole ? (
                                <Button
                                  variant="secondary"
                                  onClick={() => setAdminRole(u.id, true)}
                                  disabled={protectedUser}
                                >
                                  <UserPlus size={16} className="mr-2" />
                                  Dar admin
                                </Button>
                              ) : (
                                <Button
                                  variant="secondary"
                                  onClick={() => setAdminRole(u.id, false)}
                                  disabled={protectedUser}
                                >
                                  <UserMinus size={16} className="mr-2" />
                                  Quitar admin
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* REPORTS TAB */}
              <TabsContent value="reports">
                <div className="card-masonic p-4">
                  <h3 className="font-medium mb-2">Reportes</h3>
                  <p className="text-sm text-muted-foreground">
                    Aquí vamos a mostrar mensajes reportados y acciones de moderación.
                  </p>
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No hay reportes todavía.
                  </p>
                </div>
              </TabsContent>

              {/* CHAT TAB */}
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

                  <div className="mt-4 flex justify-end">
                    <Button variant="destructive" onClick={handleClearChat}>
                      Vaciar chat
                    </Button>
                  </div>
                </div>

                <div className="card-masonic p-4">
                  <h3 className="font-medium mb-4">Mensajes Recientes</h3>
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No hay mensajes reportados
                  </p>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </AppLayout>
  );
};

export default AdminPanel;
