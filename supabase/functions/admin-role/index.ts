// supabase/functions/admin-role/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Body = {
  action?: "grant" | "revoke";
  targetUserId?: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  // ✅ CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
      return json(500, {
        error:
          "Missing env vars. Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY",
      });
    }

    // Token del usuario que llama (tu admin)
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return json(401, { error: "Missing Authorization header" });
    }

    // Cliente con permisos de admin (service role) para escribir user_roles/profiles
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Cliente “normal” para validar el JWT del usuario que llama
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json(401, { error: "Invalid user token", details: userErr?.message });
    }

    const callerId = userData.user.id;

    // ✅ Verifica que el que llama es admin (user_roles.role = 'admin')
    const { data: callerRole, error: callerRoleErr } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId)
      .maybeSingle();

    if (callerRoleErr) {
      return json(500, {
        error: "Failed checking caller role",
        details: callerRoleErr.message,
      });
    }

    const isAdmin = callerRole?.role === "admin";
    if (!isAdmin) {
      return json(403, { error: "Forbidden: admin only" });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const action = body.action;
    const targetUserId = body.targetUserId;

    if (!action || (action !== "grant" && action !== "revoke")) {
      return json(400, { error: "Invalid action. Use 'grant' or 'revoke'." });
    }
    if (!targetUserId) {
      return json(400, { error: "Missing targetUserId" });
    }

    // Opcional: evitar que te quites admin a ti mismo
    if (action === "revoke" && targetUserId === callerId) {
      return json(400, { error: "No puedes quitarte admin a ti mismo." });
    }

    if (action === "grant") {
      // UPSERT en user_roles
      const { error: upErr } = await adminClient
        .from("user_roles")
        .upsert({ user_id: targetUserId, role: "admin" }, { onConflict: "user_id" });

      if (upErr) {
        return json(500, { error: "Failed to grant admin", details: upErr.message });
      }

      // Sincroniza profiles.role si lo usas en UI (opcional pero útil)
      await adminClient.from("profiles").update({ role: "admin" }).eq("id", targetUserId);

      return json(200, { ok: true, action: "grant", targetUserId });
    }

    if (action === "revoke") {
      // Si solo manejas un rol por usuario, puedes borrar la fila:
      const { error: delErr } = await adminClient
        .from("user_roles")
        .delete()
        .eq("user_id", targetUserId);

      if (delErr) {
        return json(500, { error: "Failed to revoke admin", details: delErr.message });
      }

      // Sincroniza profiles.role (opcional)
      await adminClient.from("profiles").update({ role: "user" }).eq("id", targetUserId);

      return json(200, { ok: true, action: "revoke", targetUserId });
    }

    return json(400, { error: "Unhandled action" });
  } catch (e) {
    return json(500, { error: "Unexpected error", details: String(e) });
  }
});
