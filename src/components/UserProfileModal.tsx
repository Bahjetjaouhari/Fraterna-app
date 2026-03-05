import React, { useEffect, useState } from "react";
import { X, Building2, MapPin, Phone, Shield, Mail, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

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

export const UserProfileModal: React.FC<UserProfileModalProps> = ({ userId, onClose }) => {
    const [profile, setProfile] = useState<PublicProfile | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!userId) return;
        setLoading(true);

        (async () => {
            const { data, error } = await supabase
                .from("profiles")
                .select("id, full_name, city, country, lodge, phone, photo_url, is_verified, email")
                .eq("id", userId)
                .maybeSingle();

            if (error) console.error("Error fetching user profile:", error);
            setProfile(data as PublicProfile | null);
            setLoading(false);
        })();
    }, [userId]);

    if (!userId) return null;

    const initials = (() => {
        const name = profile?.full_name || "";
        const parts = name.trim().split(/\s+/).filter(Boolean);
        const a = parts[0]?.[0] ?? "?";
        const b = parts.length > 1 ? parts[parts.length - 1]?.[0] : "";
        return (a + b).toUpperCase();
    })();

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

                            <h2 className="font-display text-lg text-ivory mt-3 text-center flex items-center gap-2">
                                {profile.full_name || "Sin nombre"}
                                {profile.is_verified && (
                                    <span className="inline-flex w-5 h-5 rounded-full bg-success items-center justify-center">
                                        <Shield size={10} className="text-white" />
                                    </span>
                                )}
                            </h2>

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
                    </>
                )}
            </div>
        </div>
    );
};

export default UserProfileModal;
