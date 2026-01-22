import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error("Missing Supabase env vars");
      return json(500, { error: "Server misconfigured" });
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return json(401, { error: "Missing Authorization header" });
    }

    // Cliente ADMIN (service role)
    const adminClient = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    // Validar que el request venga de un usuario autenticado
    const token = authHeader.replace("Bearer ", "");

    const {
      data: { user },
      error: authError,
    } = await adminClient.auth.getUser(token);

    if (authError || !user) {
      console.error("Auth error:", authError);
      return json(401, { error: "Invalid token" });
    }

    const body: Body = await req.json();

    const { action, targetUserId } = body;

    if (!action || !targetUserId) {
      return json(400, { error: "Missing parameters" });
    }

    // ===== GRANT ADMIN =====
    if (action === "grant") {
      const { error } = await adminClient
        .from("user_roles")
        .upsert({
          user_id: targetUserId,
          role: "admin",
        });

      if (error) {
        console.error(error);
        return json(500, { error: "Failed to grant admin" });
      }

      await adminClient
        .from("profiles")
        .update({ role: "admin" })
        .eq("id", targetUserId);

      return json(200, { ok: true, action: "grant", targetUserId });
    }

    // ===== REVOKE ADMIN =====
    if (action === "revoke") {
      const { error } = await adminClient
        .from("user_roles")
        .delete()
        .eq("user_id", targetUserId);

      if (error) {
        console.error(error);
        return json(500, { error: "Failed to revoke admin" });
      }

      await adminClient
        .from("profiles")
        .update({ role: "user" })
        .eq("id", targetUserId);

      return json(200, { ok: true, action: "revoke", targetUserId });
    }

    return json(400, { error: "Invalid action" });
  } catch (e) {
    console.error("Unhandled error:", e);
    return json(500, { error: "Unexpected error" });
  }
});
