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
  Building2,
  Filter,
  Flag,
  CheckCircle2,
  XCircle,
  Loader2,
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
  lodge: string | null;
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

type ReportRow = {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  reason: string;
  details: string | null;
  status: string;
  created_at: string;
  reporter_name: string | null;
  reported_name: string | null;
};

export const AdminPanel: React.FC = () => {
  const { isAdmin } = useAuth();

  const [activeTab, setActiveTab] = useState<"users" | "reports" | "chat">("users");

  // Users state
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersRefreshing, setUsersRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [lodgeFilter, setLodgeFilter] = useState("");

  // Reports state
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);

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
        .select("id,email,full_name,role,is_active,created_at,lodge")
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

    toast.success("Chat global vaciado exitosamente");
  };

  const handleClearReports = async () => {
    if (!isAdmin) return;

    const ok = confirm(
      "⚠️ ¿Estás seguro de vaciar todos los reportes de usuarios?\nEsta acción no se puede deshacer."
    );
    if (!ok) return;

    const { error } = await supabase.rpc("admin_clear_reports");

    if (error) {
      toast.error("No se pudo vaciar los reportes");
      console.error(error);
      return;
    }

    toast.success("Reportes vaciados exitosamente");
    await loadReports();
  };

  const loadReports = async () => {
    if (!isAdmin) return;
    setReportsLoading(true);
    try {
      const { data, error } = await supabase
        .from("user_reports")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error(error);
        toast.error("No se pudieron cargar los reportes");
        return;
      }

      // Fetch profile names for reporter and reported
      const allIds = new Set<string>();
      (data || []).forEach((r: any) => {
        allIds.add(r.reporter_id);
        allIds.add(r.reported_user_id);
      });

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", Array.from(allIds));

      const nameMap = new Map<string, string>();
      (profiles || []).forEach((p: any) => nameMap.set(p.id, p.full_name || "Sin nombre"));

      const enriched: ReportRow[] = (data || []).map((r: any) => ({
        ...r,
        reporter_name: nameMap.get(r.reporter_id) || "Desconocido",
        reported_name: nameMap.get(r.reported_user_id) || "Desconocido",
      }));

      setReports(enriched);
    } finally {
      setReportsLoading(false);
    }
  };

  const updateReportStatus = async (reportId: string, newStatus: "resolved" | "dismissed") => {
    try {
      const { error } = await supabase
        .from("user_reports")
        .update({ status: newStatus })
        .eq("id", reportId);

      if (error) throw error;

      toast.success(newStatus === "resolved" ? "Reporte marcado como resuelto" : "Reporte desestimado");
      await loadReports();
    } catch (e) {
      console.error(e);
      toast.error("No se pudo actualizar el reporte");
    }
  };

  useEffect(() => {
    if (activeTab === "users" && isAdmin) loadUsers();
    if (activeTab === "reports" && isAdmin) loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isAdmin]);

  const uniqueLodges = useMemo(() => {
    const lodgeMap = new Map<string, number>();
    users.forEach((u) => {
      const l = (u.lodge ?? "").trim();
      if (l) lodgeMap.set(l, (lodgeMap.get(l) ?? 0) + 1);
    });
    return Array.from(lodgeMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [users]);

  const filteredUsers = useMemo(() => {
    let list = users;

    // Lodge filter
    if (lodgeFilter) {
      list = list.filter((u) => (u.lodge ?? "").trim().toLowerCase() === lodgeFilter.toLowerCase());
    }

    // Search term
    const q = searchTerm.trim().toLowerCase();
    if (q) {
      list = list.filter((u) => {
        const name = (u.full_name ?? "").toLowerCase();
        const email = (u.email ?? "").toLowerCase();
        const lodge = (u.lodge ?? "").toLowerCase();
        return name.includes(q) || email.includes(q) || lodge.includes(q);
      });
    }

    return list;
  }, [users, searchTerm, lodgeFilter]);

  return (
    <AppLayout showNav isAdmin>
      <div className="min-h-screen bg-map-bg pb-24">
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
                      <div className="flex items-center gap-2 bg-muted px-3 py-2 rounded-lg w-full sm:w-[280px]">
                        <Search size={16} className="text-muted-foreground" />
                        <input
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          placeholder="Nombre, email o logia..."
                          className="bg-transparent outline-none text-sm w-full"
                        />
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <Building2 size={16} className="text-gold" />
                        <select
                          value={lodgeFilter}
                          onChange={(e) => setLodgeFilter(e.target.value)}
                          className="bg-muted text-sm rounded-lg px-2 py-2 outline-none border-none max-w-[160px]"
                        >
                          <option value="">Todas las logias</option>
                          {uniqueLodges.map(([name, count]) => (
                            <option key={name} value={name}>
                              {name} ({count})
                            </option>
                          ))}
                        </select>
                      </div>

                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => loadUsers({ silent: true })}
                        disabled={usersRefreshing}
                        className="shrink-0 text-xs"
                      >
                        <RefreshCcw
                          size={14}
                          className={`mr-1 ${usersRefreshing ? "animate-spin" : ""}`}
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
                                  className={`text-xs px-2 py-0.5 rounded-full border ${active
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
                              {u.lodge && (
                                <p className="text-xs text-gold/70 truncate flex items-center gap-1">
                                  <Building2 size={10} /> {u.lodge}
                                </p>
                              )}
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
                <div className="card-masonic p-4 mb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium">Reportes de usuarios</h3>
                      <p className="text-sm text-muted-foreground">
                        {reports.filter(r => r.status === "pending").length} pendiente(s)
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="destructive"
                        onClick={handleClearReports}
                        className="shrink-0"
                      >
                        Vaciar reportes
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => loadReports()}
                        disabled={reportsLoading}
                        className="shrink-0"
                      >
                        <RefreshCcw
                          size={16}
                          className={`mr-2 ${reportsLoading ? "animate-spin" : ""}`}
                        />
                        Actualizar
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="card-masonic p-4">
                  {reportsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 text-gold animate-spin" />
                    </div>
                  ) : reports.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No hay reportes todavía.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {reports.map((r) => {
                        const reasonLabels: Record<string, string> = {
                          spam: "Spam",
                          inappropriate: "Comportamiento Inadecuado",
                          other: "Otro",
                        };
                        const statusStyles: Record<string, string> = {
                          pending: "border-yellow-500/30 text-yellow-500",
                          resolved: "border-green-500/30 text-green-600",
                          dismissed: "border-gray-500/30 text-gray-500",
                        };

                        return (
                          <div
                            key={r.id}
                            className="border border-border rounded-xl p-4 bg-background/50 space-y-2"
                          >
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-2">
                                <Flag size={14} className="text-red-400" />
                                <span className="text-sm font-medium">
                                  {r.reporter_name}
                                </span>
                                <span className="text-muted-foreground text-xs">reportó a</span>
                                <span className="text-sm font-medium text-red-400">
                                  {r.reported_name}
                                </span>
                              </div>
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full border ${statusStyles[r.status] || statusStyles.pending
                                  }`}
                              >
                                {r.status === "pending" ? "Pendiente" : r.status === "resolved" ? "Resuelto" : "Desestimado"}
                              </span>
                            </div>

                            <div className="text-sm">
                              <span className="text-muted-foreground">Razón: </span>
                              <span>{reasonLabels[r.reason] || r.reason}</span>
                            </div>

                            {r.details && (
                              <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
                                {r.details}
                              </p>
                            )}

                            <p className="text-xs text-muted-foreground">
                              {new Date(r.created_at).toLocaleString("es")}
                            </p>

                            {r.status === "pending" && (
                              <div className="flex gap-2 pt-1">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => updateReportStatus(r.id, "resolved")}
                                >
                                  <CheckCircle2 size={14} className="mr-1" />
                                  Resolver
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => updateReportStatus(r.id, "dismissed")}
                                >
                                  <XCircle size={14} className="mr-1" />
                                  Desestimar
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => {
                                    updateReportStatus(r.id, "resolved");
                                    banUnbanUser(r.reported_user_id, true);
                                  }}
                                >
                                  <UserX size={14} className="mr-1" />
                                  Banear
                                </Button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
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

                  <div className="mt-6 flex justify-end border-t border-border pt-4">
                    <Button variant="destructive" onClick={handleClearChat}>
                      Vaciar chat global
                    </Button>
                  </div>
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
