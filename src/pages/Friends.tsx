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
  status: "pending" | "accepted" | "blocked";
  created_at: string;
  updated_at: string;
};

type ProfileRow = {
  id: string;
  full_name: string;
  city: string;
  email?: string;
  lodge?: string;
  photo_url?: string | null;
};

type AllowlistRow = {
  id: string;
  owner_id: string;
  allowed_user_id: string;
  created_at: string;
};

const getKey = (a: string, b: string) => [a, b].sort().join("|");

const AvatarInitials: React.FC<{ name?: string | null }> = ({ name }) => {
  const letters = useMemo(() => {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] ?? "?";
    const b = parts.length > 1 ? parts[parts.length - 1]?.[0] : "";
    return (a + b).toUpperCase();
  }, [name]);

  return (
    <div className="w-10 h-10 rounded-xl bg-gold/15 border border-gold/25 flex items-center justify-center text-gold font-bold">
      {letters}
    </div>
  );
};

const Friends: React.FC = () => {
  const { user, isAdmin } = useAuth();
  const myId = user?.id ?? null;

  const [isLoading, setIsLoading] = useState(false);
  const [query, setQuery] = useState("");

  const [incoming, setIncoming] = useState<FriendshipRow[]>([]);
  const [outgoing, setOutgoing] = useState<FriendshipRow[]>([]);
  const [accepted, setAccepted] = useState<FriendshipRow[]>([]);

  const [profilesById, setProfilesById] = useState<Record<string, ProfileRow>>({});
  const [allowlist, setAllowlist] = useState<AllowlistRow[]>([]);

  const [searchResults, setSearchResults] = useState<ProfileRow[]>([]);

  const acceptedFriendIds = useMemo(() => {
    if (!myId) return new Set<string>();
    const ids = new Set<string>();
    accepted.forEach((r) => {
      const other = r.requester_id === myId ? r.addressee_id : r.requester_id;
      ids.add(other);
    });
    return ids;
  }, [accepted, myId]);

  const pendingIncomingIds = useMemo(() => {
    const ids = new Set<string>();
    incoming.forEach((r) => ids.add(r.requester_id));
    return ids;
  }, [incoming]);

  const pendingOutgoingIds = useMemo(() => {
    const ids = new Set<string>();
    outgoing.forEach((r) => ids.add(r.addressee_id));
    return ids;
  }, [outgoing]);

  const existingRelationKey = useMemo(() => {
    const map = new Map<string, FriendshipRow>();
    accepted.concat(incoming, outgoing).forEach((r) => {
      const key = getKey(r.requester_id, r.addressee_id);
      map.set(key, r);
    });
    return map;
  }, [accepted, incoming, outgoing]);

  const fetchFriendships = useCallback(async () => {
    if (!myId) return;

    const { data, error } = await supabase
      .from("friendships")
      .select("id,requester_id,addressee_id,status,created_at,updated_at")
      .or(`requester_id.eq.${myId},addressee_id.eq.${myId}`)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error(error);
      toast.error(`No se pudieron cargar los amigos: ${error.message}`);
      return;
    }

    const rows = (data ?? []) as FriendshipRow[];

    // OJO: aquí ignoramos blocked para que no se muestre
    setIncoming(rows.filter((r) => r.addressee_id === myId && r.status === "pending"));
    setOutgoing(rows.filter((r) => r.requester_id === myId && r.status === "pending"));
    setAccepted(rows.filter((r) => r.status === "accepted"));
  }, [myId]);

  const fetchAllowlist = useCallback(async () => {
    if (!myId) return;
    const { data, error } = await supabase
      .from("friends_allowlist")
      .select("id,owner_id,allowed_user_id,created_at")
      .eq("owner_id", myId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      return;
    }
    setAllowlist((data ?? []) as AllowlistRow[]);
  }, [myId]);

  const fetchProfilesForRows = useCallback(
    async (rows: FriendshipRow[]) => {
      const ids = new Set<string>();
      rows.forEach((r) => {
        ids.add(r.requester_id);
        ids.add(r.addressee_id);
      });
      if (myId) ids.add(myId);

      const missing = Array.from(ids).filter((id) => !profilesById[id]);
      if (missing.length === 0) return;

      const { data, error } = await supabase
        .from("profiles")
        .select("id,full_name,city,email,lodge,photo_url")
        .in("id", missing);

      if (error) {
        console.error(error);
        return;
      }

      const list = (data ?? []) as ProfileRow[];
      setProfilesById((prev) => {
        const next = { ...prev };
        list.forEach((p) => {
          next[p.id] = p;
        });
        return next;
      });
    },
    [myId, profilesById]
  );

  const refreshAll = useCallback(async () => {
    if (!myId) return;
    setIsLoading(true);
    try {
      await Promise.all([fetchFriendships(), fetchAllowlist()]);
    } finally {
      setIsLoading(false);
    }
  }, [fetchAllowlist, fetchFriendships, myId]);

  useEffect(() => {
    if (!myId) return;
    refreshAll();
  }, [myId, refreshAll]);

  useEffect(() => {
    if (!myId) return;
    const combined = [...incoming, ...outgoing, ...accepted];
    fetchProfilesForRows(combined);
  }, [accepted, fetchProfilesForRows, incoming, myId, outgoing]);

  const runSearch = useCallback(async () => {
    if (!myId) return;
    const q = query.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,full_name,city,email,lodge,photo_url")
        .neq("id", myId)
        .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
        .limit(25);

      if (error) {
        console.error(error);
        toast.error(`No se pudo buscar: ${error.message}`);
        return;
      }

      setSearchResults((data ?? []) as ProfileRow[]);
    } finally {
      setIsLoading(false);
    }
  }, [myId, query]);

  // Alias para mantener tu UI como está (botón Buscar usa doSearch)
  const doSearch = runSearch;

  const sendRequest = useCallback(
    async (otherId: string) => {
      if (!myId) return;

      try {
        // Buscar si ya existe relación (evita unique constraint)
        const { data: existingRows, error: findErr } = await supabase
          .from("friendships")
          .select("id,status,requester_id,addressee_id")
          .or(
            `and(requester_id.eq.${myId},addressee_id.eq.${otherId}),and(requester_id.eq.${otherId},addressee_id.eq.${myId})`
          )
          .limit(1);

        if (findErr) throw findErr;

        const existing = (existingRows ?? [])[0] as any;

        if (existing && existing.status === "blocked") {
          const { error: upErr } = await supabase
            .from("friendships")
            .update({
              status: "pending",
              requester_id: myId,
              addressee_id: otherId,
            })
            .eq("id", existing.id);

          if (upErr) throw upErr;

          toast.success("Solicitud enviada");
          await refreshAll();
          return;
        }

        if (existing) {
          toast.message("Ya existe una solicitud o amistad con este usuario.");
          return;
        }

        const { error } = await supabase.from("friendships").insert({
          requester_id: myId,
          addressee_id: otherId,
          status: "pending",
        });

        if (error) throw error;

        toast.success("Solicitud enviada");
        await refreshAll();
      } catch (e: any) {
        console.error(e);
        toast.error(`No se pudo enviar la solicitud: ${e?.message ?? "revisa consola"}`);
      }
    },
    [myId, refreshAll]
  );

  // ✅ FIX: aceptar solo si yo soy el addressee y el status es pending
  const acceptRequest = useCallback(
    async (rowId: string) => {
      if (!myId) return;

      try {
        const { data, error } = await supabase
          .from("friendships")
          .update({ status: "accepted" })
          .eq("id", rowId)
          .eq("addressee_id", myId)
          .eq("status", "pending")
          .select("id");

        if (error) throw error;

        if (!data || data.length === 0) {
          toast.error("No se pudo aceptar (no autorizado o ya no está pendiente).");
          await refreshAll();
          return;
        }

        toast.success("Solicitud aceptada");
        await refreshAll();
      } catch (e: any) {
        console.error(e);
        toast.error(`No se pudo aceptar: ${e?.message ?? "revisa consola"}`);
        await refreshAll();
      }
    },
    [myId, refreshAll]
  );

  const rejectRequest = useCallback(
    async (requestId: string) => {
      try {
        setIsLoading(true);

        // Si tu constraint no permite "rejected", usamos "blocked"
        const { error } = await supabase.from("friendships").update({ status: "blocked" }).eq("id", requestId);
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
    [refreshAll, doSearch]
  );

  const cancelRequest = useCallback(
    async (requestId: string) => {
      try {
        setIsLoading(true);

        // Cancelar = marcar como blocked para poder re-enviar luego
        const { error } = await supabase.from("friendships").update({ status: "blocked" }).eq("id", requestId);
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
    [refreshAll, doSearch]
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
    [refreshAll, doSearch]
  );

  const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") doSearch();
  };

  // Helpers para UI (evita romper tu render)
  const friends = accepted.map((r: any) => {
    const otherId = r.requester_id === myId ? r.addressee_id : r.requester_id;
    return { ...r, friend: profilesById[otherId] };
  });

  const incomingRows = incoming.map((r: any) => ({ ...r, requester: profilesById[r.requester_id] }));
  const outgoingRows = outgoing.map((r: any) => ({ ...r, addressee: profilesById[r.addressee_id] }));

  return (
    <AppLayout isAdmin={isAdmin}>
      {/* ✅ wrapper para fondo azul igual a la barra inferior */}
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
                {searchResults.map((p: any) => {
                  // Best-effort para no romper tu UI si ya tenías relation/requestId
                  const rel = p.relation ?? "none";
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg bg-navy/50 border border-gold/15 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-ivory truncate">{p.full_name || "Sin nombre"}</div>
                        <div className="text-xs text-ivory/60 truncate">
                          {(p.lodge_name ? p.lodge_name : p.lodge ? p.lodge : "Sin logia") + (p.city ? ` • ${p.city}` : "")}
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
              {incomingRows.length === 0 ? (
                <div className="text-xs text-ivory/60">No tienes solicitudes pendientes.</div>
              ) : (
                <div className="space-y-2">
                  {incomingRows.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg bg-navy/50 border border-gold/15 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-ivory truncate">{r.requester?.full_name || "Sin nombre"}</div>
                        <div className="text-xs text-ivory/60 truncate">
                          {(r.requester?.lodge_name ? r.requester?.lodge_name : r.requester?.lodge ? r.requester?.lodge : "Sin logia") +
                            (r.requester?.city ? ` • ${r.requester?.city}` : "")}
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
              {outgoingRows.length === 0 ? (
                <div className="text-xs text-ivory/60">No tienes solicitudes enviadas.</div>
              ) : (
                <div className="space-y-2">
                  {outgoingRows.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg bg-navy/50 border border-gold/15 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-ivory truncate">{r.addressee?.full_name || "Sin nombre"}</div>
                        <div className="text-xs text-ivory/60 truncate">
                          {(r.addressee?.lodge_name ? r.addressee?.lodge_name : r.addressee?.lodge ? r.addressee?.lodge : "Sin logia") +
                            (r.addressee?.city ? ` • ${r.addressee?.city}` : "")}
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
                          {(r.friend?.lodge_name ? r.friend?.lodge_name : r.friend?.lodge ? r.friend?.lodge : "Sin logia") + (r.friend?.city ? ` • ${r.friend?.city}` : "")}
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
