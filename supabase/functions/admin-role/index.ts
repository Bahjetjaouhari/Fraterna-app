// supabase/functions/admin-role/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Body = {
  action?: "grant" | "revoke";
  targetUserId?: string;
};

// CORS
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
  // Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    console.log("admin-role function invoked");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
      console.error("Missing env vars!");
      return json(500, {
        error:
          "Missing env vars. Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY",
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      console.error("Missing Authorization header");
      return json(401, { error: "Missing Authorization header" });
    }

    // Cliente admin (bypassa RLS) para realizar las acciones reales (grant/revoke)
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Cliente "normal" para validar quién está llamando a la función
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    // Validar JWT del que llama
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      console.error("Auth error validating user:", userErr);
      return json(401, {
        error: "Invalid user token",
        details: userErr?.message ?? null,
      });
    }

    const callerId = userData.user.id;
    console.log("Caller ID identified:", callerId);

    // ✨ CORRECCIÓN CRÍTICA DE SEGURIDAD ✨
    // Chequear explícitamente si quien llama a esta función es "admin" o "ceo"
    const { data: callerRole, error: callerRoleErr } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId)
      .in("role", ["admin", "ceo"])
      .maybeSingle();

    if (callerRoleErr) {
      console.error("Error checking caller role in user_roles table:", callerRoleErr);
      return json(500, {
        error: "Failed checking caller role",
        details: callerRoleErr.message,
      });
    }

    if (!callerRole) {
      console.warn(`User ${callerId} attempted admin-role action without admin/ceo role`);
      return json(403, { error: "Forbidden: You must be an admin to perform this action" });
    }

    console.log(`Caller ${callerId} authorized with role ${callerRole.role}`);

    // Parse payload
    let bodyText = "";
    try {
      bodyText = await req.text();
      console.log("Raw payload:", bodyText);
    } catch (e) {
      console.error("Failed to read body format", e);
    }

    let parsedBody: Body = {};
    if (bodyText) {
      try {
        parsedBody = JSON.parse(bodyText);
      } catch (e) {
        console.error("Failed to parse JSON", e);
      }
    }

    const { action, targetUserId } = parsedBody;

    if (!action || !targetUserId) {
      console.error("Missing parameters in payload:", parsedBody);
      return json(400, { error: "Missing parameters: 'action' and 'targetUserId' are required." });
    }

    if (action !== "grant" && action !== "revoke") {
      console.error("Invalid action:", action);
      return json(400, { error: "Invalid action. Use 'grant' or 'revoke'." });
    }

    console.log(`Executing ${action} for target ${targetUserId}`);

    // ===== GRANT ADMIN =====
    if (action === "grant") {
      const { error: grantErr } = await adminClient
        .from("user_roles")
        .upsert({ user_id: targetUserId, role: "admin" });

      if (grantErr) {
        console.error("Error granting admin role:", grantErr);
        return json(500, { error: "Failed to grant admin", details: grantErr.message });
      }

      console.log(`Role assigned to user_roles for ${targetUserId}`);

      const { error: profilesErr } = await adminClient
        .from("profiles")
        .update({ role: "admin" })
        .eq("id", targetUserId);

      if (profilesErr) {
        // En tu DB remota de Supabase SÍ existe profiles "role". Si en el local falla el types no afecta aquí.
        console.error("Warning: Could not update profile role", profilesErr);
      }

      return json(200, { ok: true, action: "grant", targetUserId });
    }

    // ===== REVOKE ADMIN =====
    if (action === "revoke") {
      // Prevención: evitar revocarse a sí mismo el admin? (Puntual, preferiblemente)
      if (targetUserId === callerId) {
        return json(400, { error: "Cannot revoke your own admin access here." });
      }

      const { error: revokeErr } = await adminClient
        .from("user_roles")
        .delete()
        .eq("user_id", targetUserId)
        .eq("role", "admin"); // Solo revocar el admin, no user o ceo accidentalmente.

      if (revokeErr) {
        console.error("Error revoking admin role:", revokeErr);
        return json(500, { error: "Failed to revoke admin", details: revokeErr.message });
      }

      const { error: profilesErr } = await adminClient
        .from("profiles")
        .update({ role: "user" })
        .eq("id", targetUserId);

      if (profilesErr) {
        console.error("Warning: Could not update profile role", profilesErr);
      }

      return json(200, { ok: true, action: "revoke", targetUserId });
    }

  } catch (e) {
    console.error("Unhandled top-level error:", e);
    return json(500, { error: "Unexpected error", details: String(e) });
  }
});

