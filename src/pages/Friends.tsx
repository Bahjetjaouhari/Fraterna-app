import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, Loader2, Search, UserPlus, UserX, Users, X } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type FriendshipRow = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted" | "rejected";
  created_at: string;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  lodge_name: string | null;
  degree: string | null;
  city: string | null;
  created_at: string;
  is_active?: boolean | null;
};

type SearchResult = ProfileRow & {
  relation?: "none" | "incoming" | "outgoing" | "friend";
  requestId?: string;
};

const Friends: React.FC = () => {
  const { user, profile, isAdmin } = useAuth();

  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [incoming, setIncoming] = useState<(FriendshipRow & { requester?: ProfileRow })[]>([]);
  const [outgoing, setOutgoing] = useState<(FriendshipRow & { addressee?: ProfileRow })[]>([]);
  const [friends, setFriends] = useState<(FriendshipRow & { friend?: ProfileRow })[]>([]);

  const me = user?.id ?? null;

  const loadIncoming = useCallback(async () => {
    if (!me) return;

    const { data, error } = await supabase
      .from("friendships")
      .select("*, requester:profiles!friendships_requester_id_fkey(*)")
      .eq("addressee_id", me)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) throw error;
    setIncoming((data ?? []) as any);
  }, [me]);

  const loadOutgoing = useCallback(async () => {
    if (!me) return;

    const { data, error } = await supabase
      .from("friendships")
      .select("*, addressee:profiles!friendships_addressee_id_fkey(*)")
      .eq("requester_id", me)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) throw error;
    setOutgoing((data ?? []) as any);
  }, [me]);

  const loadFriends = useCallback(async () => {
    if (!me) return;

    const { data, error } = await supabase
      .from("friendships")
      .select(
        "*, requester:profiles!friendships_requester_id_fkey(*), addressee:profiles!friendships_addressee_id_fkey(*)",
      )
      .or(`requester_id.eq.${me},addressee_id.eq.${me}`)
      .eq("status", "accepted")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const normalized =
      (data ?? []).map((row: any) => {
        const friendProfile = row.requester_id === me ? row.addressee : row.requester;
        return { ...row, friend: friendProfile };
      }) ?? [];

    setFriends(normalized as any);
  }, [me]);

  const refreshAll = useCallback(async () => {
    try {
      setIsLoading(true);
      await Promise.all([loadIncoming(), loadOutgoing(), loadFriends()]);
    } catch (e: any) {
      console.error(e);
      toast.error("Error cargando amigos");
    } finally {
      setIsLoading(false);
    }
  }, [loadIncoming, loadOutgoing, loadFriends]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const relationMap = useMemo(() => {
    const map = new Map<string, { relation: SearchResult["relation"]; requestId?: string }>();

    for (const r of incoming) {
      map.set((r as any).requester_id, { relation: "incoming", requestId: (r as any).id });
    }
    for (const r of outgoing) {
      map.set((r as any).addressee_id, { relation: "outgoing", requestId: (r as any).id });
    }
    for (const r of friends) {
      const friendId = (r as any).requester_id === me ? (r as any).addressee_id : (r as any).requester_id;
      map.set(friendId, { relation: "friend", requestId: (r as any).id });
    }

    return map;
  }, [incoming, outgoing, friends, me]);

  const doSearch = useCallback(async () => {
    if (!me) return;
    const q = query.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }

    try {
      setIsLoading(true);

      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .neq("id", me)
        .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
        .limit(15);

      if (error) throw error;

      const enriched =
        (data ?? []).map((p: any) => {
          const rel = relationMap.get(p.id);
          return {
            ...p,
            relation: rel?.relation ?? "none",
            requestId: rel?.requestId,
          } as SearchResult;
        }) ?? [];

      setSearchResults(enriched);
    } catch (e: any) {
      console.error(e);
      toast.error("Error buscando usuarios");
    } finally {
      setIsLoading(false);
    }
  }, [me, query, relationMap]);

  const sendRequest = useCallback(
    async (targetId: string) => {
      if (!me) return;
      try {
        setIsLoading(true);
        const { error } = await supabase.from("friendships").insert({
          requester_id: me,
          addressee_id: targetId,
          status: "pending",
        });
        if (error) throw error;

        toast.success("Solicitud enviada");
        await refreshAll();
        await doSearch();
      } catch (e: any) {
        console.error(e);
        toast.error("No se pudo enviar la solicitud");
      } finally {
        setIsLoading(false);
      }
    },
    [me, refreshAll, doSearch],
  );

  const acceptRequest = useCallback(
    async (requestId: string) => {
      try {
        setIsLoading(true);
        const { error } = await supabase.from("friendships").update({ status: "accepted" }).eq("id", requestId);
        if (error) throw error;

        toast.success("Solicitud aceptada");
        await refreshAll();
        await doSearch();
      } catch (e: any) {
        console.error(e);
        toast.error("No se pudo aceptar");
      } finally {
        setIsLoading(false);
      }
    },
    [refreshAll, doSearch],
  );

  const rejectRequest = useCallback(
    async (requestId: string) => {
      try {
        setIsLoading(true);
        const { error } = await supabase.from("friendships").update({ status: "rejected" }).eq("id", requestId);
        if (error) throw error;

        toast.success("Solicitud rechazada");
        await refreshAll();
        await doSearch();
      } catch (e: any) {
        console.error(e);
        toast.error("No se pudo rechazar");
      } finally {
        setIsLoading(false);
      }
    },
    [refreshAll, doSearch],
  );

  const cancelRequest = useCallback(
    async (requestId: string) => {
      try {
        setIsLoading(true);
        const { error } = await supabase.from("friendships").delete().eq("id", requestId);
        if (error) throw error;

        toast.success("Solicitud cancelada");
        await refreshAll();
        await doSearch();
      } catch (e: any) {
        console.error(e);
        toast.error("No se pudo cancelar");
      } finally {
        setIsLoading(false);
      }
    },
    [refreshAll, doSearch],
  );

  const removeFriend = useCallback(
    async (friendshipId: string) => {
      try {
        setIsLoading(true);
        const { error } = await supabase.from("friendships").delete().eq("id", friendshipId);
        if (error) throw error;

        toast.success("Amigo eliminado");
        await refreshAll();
        await doSearch();
      } catch (e: any) {
        console.error(e);
        toast.error("No se pudo eliminar");
      } finally {
        setIsLoading(false);
      }
    },
    [refreshAll, doSearch],
  );

  const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") doSearch();
  };

  return (
    <AppLayout isAdmin={isAdmin}>
      {/* ✅ CAMBIO ÚNICO: wrapper para fondo azul igual a la barra inferior */}
      <div className="min-h-screen bg-[hsl(var(--navy))]">
        <div className="p-4 max-w-3xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-navy/60 border border-gold/30 flex items-center justify-center">
              <Users className="text-gold" size={22} />
            </div>
            <div>
              <div className="text-lg font-bold text-ivory">Amigos</div>
              <div className="text-xs text-ivory/60">Solicitudes, lista de amigos y permitidos</div>
            </div>
            <div className="ml-auto">
              <Button variant="outline" onClick={refreshAll} disabled={isLoading}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Actualizar"}
              </Button>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card-masonic-dark p-4 mb-4">
            <div className="text-sm font-semibold text-ivory mb-2">Buscar hermanos</div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ivory/50" size={16} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onEnter}
                  placeholder="Nombre o email"
                  className="w-full pl-9 pr-3 py-2 rounded-md bg-navy/60 border border-gold/20 text-ivory placeholder:text-ivory/40 focus:outline-none focus:ring-2 focus:ring-gold/40"
                />
              </div>
              <Button onClick={doSearch} disabled={isLoading} className="btn-masonic">
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buscar"}
              </Button>
            </div>

            {searchResults.length > 0 && (
              <div className="mt-4 space-y-2">
                {searchResults.map((p) => {
                  const rel = p.relation ?? "none";
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg bg-navy/50 border border-gold/15 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-ivory truncate">{p.full_name || "Sin nombre"}</div>
                        <div className="text-xs text-ivory/60 truncate">
                          {(p.lodge_name ? p.lodge_name : "Sin logia") + (p.city ? ` • ${p.city}` : "")}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {rel === "none" && (
                          <Button size="sm" onClick={() => sendRequest(p.id)} disabled={isLoading} className="btn-masonic">
                            <UserPlus className="h-4 w-4 mr-2" /> Enviar
                          </Button>
                        )}

                        {rel === "incoming" && p.requestId && (
                          <>
                            <Button size="sm" onClick={() => acceptRequest(p.requestId!)} disabled={isLoading} className="btn-masonic">
                              <Check className="h-4 w-4 mr-2" /> Aceptar
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => rejectRequest(p.requestId!)} disabled={isLoading}>
                              <X className="h-4 w-4 mr-2" /> Rechazar
                            </Button>
                          </>
                        )}

                        {rel === "outgoing" && p.requestId && (
                          <Button size="sm" variant="outline" onClick={() => cancelRequest(p.requestId!)} disabled={isLoading}>
                            <UserX className="h-4 w-4 mr-2" /> Cancelar
                          </Button>
                        )}

                        {rel === "friend" && p.requestId && (
                          <Button size="sm" variant="outline" onClick={() => removeFriend(p.requestId!)} disabled={isLoading}>
                            <UserX className="h-4 w-4 mr-2" /> Quitar
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>

          <div className="space-y-6">
            <div>
              <div className="text-sm font-semibold text-ivory mb-2">Solicitudes recibidas</div>
              {incoming.length === 0 ? (
                <div className="text-xs text-ivory/60">No tienes solicitudes pendientes.</div>
              ) : (
                <div className="space-y-2">
                  {incoming.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg bg-navy/50 border border-gold/15 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-ivory truncate">{r.requester?.full_name || "Sin nombre"}</div>
                        <div className="text-xs text-ivory/60 truncate">
                          {(r.requester?.lodge_name ? r.requester?.lodge_name : "Sin logia") + (r.requester?.city ? ` • ${r.requester?.city}` : "")}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={() => acceptRequest(r.id)} disabled={isLoading} className="btn-masonic">
                          <Check className="h-4 w-4 mr-2" /> Aceptar
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => rejectRequest(r.id)} disabled={isLoading}>
                          <X className="h-4 w-4 mr-2" /> Rechazar
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="text-sm font-semibold text-ivory mb-2">Solicitudes enviadas</div>
              {outgoing.length === 0 ? (
                <div className="text-xs text-ivory/60">No tienes solicitudes enviadas.</div>
              ) : (
                <div className="space-y-2">
                  {outgoing.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg bg-navy/50 border border-gold/15 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-ivory truncate">{r.addressee?.full_name || "Sin nombre"}</div>
                        <div className="text-xs text-ivory/60 truncate">
                          {(r.addressee?.lodge_name ? r.addressee?.lodge_name : "Sin logia") + (r.addressee?.city ? ` • ${r.addressee?.city}` : "")}
                        </div>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => cancelRequest(r.id)} disabled={isLoading}>
                        <UserX className="h-4 w-4 mr-2" /> Cancelar
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="text-sm font-semibold text-ivory mb-2">Mis amigos</div>
              {friends.length === 0 ? (
                <div className="text-xs text-ivory/60">Aún no tienes amigos aceptados.</div>
              ) : (
                <div className="space-y-2">
                  {friends.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg bg-navy/50 border border-gold/15 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-ivory truncate">{r.friend?.full_name || "Sin nombre"}</div>
                        <div className="text-xs text-ivory/60 truncate">
                          {(r.friend?.lodge_name ? r.friend?.lodge_name : "Sin logia") + (r.friend?.city ? ` • ${r.friend?.city}` : "")}
                        </div>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => removeFriend(r.id)} disabled={isLoading}>
                        <UserX className="h-4 w-4 mr-2" /> Quitar
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 text-[11px] text-ivory/55">
                Tip: el botón <span className="text-gold">Permitir</span> controla tu lista de “Amigos permitidos” (para el modo “Amigos seleccionados”).
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Friends;
