import React, { useEffect, useState } from "react";
import { X, Building2, MapPin, Phone, Shield, Mail, Loader2, Flag, Crown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface UserProfileModalProps {
    userId: string | null;
    onClose: () => void;
}

interface PublicProfile {
    id: string;
    full_name: string | null;
    city: string | null;
    country: string | null;
    lodge: string | null;
    phone: string | null;
    photo_url: string | null;
    is_verified: boolean;
    email: string | null;
}

type ReportReason = "spam" | "inappropriate" | "other";

export const UserProfileModal: React.FC<UserProfileModalProps> = ({ userId, onClose }) => {
    const { user } = useAuth();
    const [profile, setProfile] = useState<PublicProfile | null>(null);
    const [loading, setLoading] = useState(true);

    // Report state
    const [showReport, setShowReport] = useState(false);
    const [reportReason, setReportReason] = useState<ReportReason>("spam");
    const [reportDetails, setReportDetails] = useState("");
    const [sending, setSending] = useState(false);
    const [isProfileAdmin, setIsProfileAdmin] = useState(false);

    useEffect(() => {
        if (!userId) return;
        setLoading(true);
        setShowReport(false);
        setReportReason("spam");
        setReportDetails("");

        (async () => {
            const { data, error } = await supabase
                .from("profiles")
                .select("id, full_name, city, country, lodge, phone, photo_url, is_verified, email")
                .eq("id", userId)
                .maybeSingle();

            if (error) console.error("Error fetching user profile:", error);
            setProfile(data as PublicProfile | null);

            // Check if this user is admin
            const { data: adminData } = await supabase
                .from("admin_users")
                .select("user_id")
                .eq("user_id", userId)
                .maybeSingle();
            
            if (!adminData) {
                // Also check user_roles for admin/ceo
                const { data: roleData } = await supabase
                    .from("user_roles")
                    .select("role")
                    .eq("user_id", userId)
                    .in("role", ["admin", "ceo"])
                    .maybeSingle();
                setIsProfileAdmin(!!roleData);
            } else {
                setIsProfileAdmin(true);
            }

            setLoading(false);
        })();
    }, [userId]);

    if (!userId) return null;

    const isOwnProfile = user?.id === userId;

    const initials = (() => {
        const name = profile?.full_name || "";
        const parts = name.trim().split(/\s+/).filter(Boolean);
        const a = parts[0]?.[0] ?? "?";
        const b = parts.length > 1 ? parts[parts.length - 1]?.[0] : "";
        return (a + b).toUpperCase();
    })();

    const handleReport = async () => {
        if (!user?.id || !userId) return;
        setSending(true);
        try {
            const { error } = await supabase.from("user_reports").insert({
                reporter_id: user.id,
                reported_user_id: userId,
                reason: reportReason,
                details: reportDetails.trim() || null,
            });

            if (error) throw error;

            toast.success("Reporte enviado al administrador");
            setShowReport(false);
            setReportReason("spam");
            setReportDetails("");
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        catch (e: any) {
            console.error("Error sending report:", e);
            toast.error(e?.message || "No se pudo enviar el reporte");
        } finally {
            setSending(false);
        }
    };

    const reasonLabels: Record<ReportReason, string> = {
        spam: "Spam",
        inappropriate: "Comportamiento Inadecuado",
        other: "Otro",
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="relative bg-navy border border-gold/20 rounded-2xl w-[90vw] max-w-sm overflow-hidden shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Close button */}
                <button
                    onClick={onClose}
                    className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/40 flex items-center justify-center text-ivory/70 hover:text-ivory transition-colors"
                >
                    <X size={18} />
                </button>

                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <Loader2 className="w-8 h-8 text-gold animate-spin" />
                    </div>
                ) : !profile ? (
                    <div className="flex items-center justify-center py-16 text-ivory/50 text-sm">
                        Usuario no encontrado
                    </div>
                ) : (
                    <>
                        {/* Header with avatar */}
                        <div className="bg-navy-light pt-8 pb-6 px-6 flex flex-col items-center">
                            {profile.photo_url ? (
                                <img
                                    src={profile.photo_url}
                                    alt={profile.full_name || "Avatar"}
                                    className="w-24 h-24 rounded-full object-cover border-3 border-gold/40 shadow-lg"
                                />
                            ) : (
                                <div className="w-24 h-24 rounded-full bg-gold/15 border-3 border-gold/40 flex items-center justify-center shadow-lg">
                                    <span className="text-gold font-bold text-3xl">{initials}</span>
                                </div>
                            )}

                            <h2 className="font-display text-lg text-ivory mt-3 text-center flex items-center justify-center gap-2 flex-wrap">
                                {profile.full_name || "Sin nombre"}
                            </h2>
                            <div className="flex items-center justify-center gap-1.5 mt-1.5">
                                {profile.is_verified && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success/20 text-success text-[10px] font-semibold">
                                        <Shield size={10} />
                                        Verificado
                                    </span>
                                )}
                                {isProfileAdmin && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gold/20 text-gold text-[10px] font-semibold">
                                        <Crown size={10} />
                                        Admin
                                    </span>
                                )}
                            </div>

                            {profile.email && (
                                <p className="text-ivory/50 text-xs mt-0.5">{profile.email}</p>
                            )}
                        </div>

                        {/* Info rows */}
                        <div className="px-6 py-4 space-y-3">
                            {profile.lodge && (
                                <div className="flex items-center gap-3">
                                    <Building2 size={16} className="text-gold shrink-0" />
                                    <div>
                                        <p className="text-ivory/40 text-xs">Logia</p>
                                        <p className="text-ivory text-sm">{profile.lodge}</p>
                                    </div>
                                </div>
                            )}

                            {(profile.city || profile.country) && (
                                <div className="flex items-center gap-3">
                                    <MapPin size={16} className="text-gold shrink-0" />
                                    <div>
                                        <p className="text-ivory/40 text-xs">Ubicación</p>
                                        <p className="text-ivory text-sm">
                                            {[profile.city, profile.country].filter(Boolean).join(", ")}
                                        </p>
                                    </div>
                                </div>
                            )}

                            {profile.phone && (
                                <div className="flex items-center gap-3">
                                    <Phone size={16} className="text-gold shrink-0" />
                                    <div>
                                        <p className="text-ivory/40 text-xs">Teléfono</p>
                                        <p className="text-ivory text-sm">{profile.phone}</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Report section (only if not own profile) */}
                        {!isOwnProfile && user && (
                            <div className="px-6 pb-5">
                                {!showReport ? (
                                    <button
                                        onClick={() => setShowReport(true)}
                                        className="flex items-center gap-2 text-red-400/70 hover:text-red-400 transition-colors text-xs"
                                    >
                                        <Flag size={13} />
                                        <span>Reportar usuario</span>
                                    </button>
                                ) : (
                                    <div className="bg-black/30 rounded-xl p-4 border border-red-500/20 space-y-3">
                                        <p className="text-ivory text-sm font-medium">Reportar a {profile.full_name}</p>

                                        <div className="flex flex-col gap-2">
                                            {(Object.keys(reasonLabels) as ReportReason[]).map((key) => (
                                                <label
                                                    key={key}
                                                    className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg cursor-pointer border transition-colors ${reportReason === key
                                                            ? "border-gold/50 bg-gold/10 text-ivory"
                                                            : "border-transparent bg-white/5 text-ivory/60 hover:bg-white/10"
                                                        }`}
                                                >
                                                    <input
                                                        type="radio"
                                                        name="report-reason"
                                                        value={key}
                                                        checked={reportReason === key}
                                                        onChange={() => setReportReason(key)}
                                                        className="accent-gold"
                                                    />
                                                    {reasonLabels[key]}
                                                </label>
                                            ))}
                                        </div>

                                        <textarea
                                            value={reportDetails}
                                            onChange={(e) => setReportDetails(e.target.value)}
                                            placeholder="Detalles adicionales (opcional)..."
                                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-ivory text-sm placeholder:text-ivory/30 outline-none focus:border-gold/40 resize-none"
                                            rows={2}
                                        />

                                        <div className="flex gap-2 justify-end">
                                            <button
                                                onClick={() => setShowReport(false)}
                                                className="px-3 py-1.5 text-xs text-ivory/50 hover:text-ivory transition-colors"
                                                disabled={sending}
                                            >
                                                Cancelar
                                            </button>
                                            <button
                                                onClick={handleReport}
                                                disabled={sending}
                                                className="px-4 py-1.5 text-xs bg-red-500/80 hover:bg-red-500 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5"
                                            >
                                                {sending && <Loader2 size={12} className="animate-spin" />}
                                                Enviar Reporte
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default UserProfileModal;
