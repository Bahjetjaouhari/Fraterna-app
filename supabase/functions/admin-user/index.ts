// supabase/functions/admin-user/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Body = {
  action?: "ban" | "unban";
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
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
      return json(500, {
        error:
          "Missing env vars. Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY",
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return json(401, { error: "Missing Authorization header" });
    }

    // Cliente admin (bypassa RLS + Auth admin)
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Cliente “normal” para validar JWT del que llama
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json(401, {
        error: "Invalid user token",
        details: userErr?.message ?? null,
      });
    }

    const callerId = userData.user.id;

    // Verifica que el que llama sea admin (user_roles.role='admin')
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

    if (callerRole?.role !== "admin") {
      return json(403, { error: "Forbidden: admin only" });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const action = body.action;
    const targetUserId = body.targetUserId;

    if (!action || (action !== "ban" && action !== "unban")) {
      return json(400, { error: "Invalid action. Use 'ban' or 'unban'." });
    }
    if (!targetUserId) {
      return json(400, { error: "Missing targetUserId" });
    }

    // Evitar banearte a ti mismo (opcional pero recomendado)
    if (action === "ban" && targetUserId === callerId) {
      return json(400, { error: "No puedes banearte a ti mismo." });
    }

    if (action === "ban") {
      // Ban en Auth (GoTrue)
      const { error: banErr } = await adminClient.auth.admin.updateUserById(
        targetUserId,
        { ban_duration: "876000h" } // ~100 años (práctico “perma-ban”)
      );

      if (banErr) {
        return json(500, { error: "Failed to ban user", details: banErr.message });
      }

      // Sync en profiles (para tu UI)
      await adminClient
        .from("profiles")
        .update({ is_active: false })
        .eq("id", targetUserId);

      return json(200, { ok: true, action: "ban", targetUserId });
    }

    if (action === "unban") {
      // Unban en Auth (GoTrue)
      const { error: unbanErr } = await adminClient.auth.admin.updateUserById(
        targetUserId,
        { ban_duration: "none" }
      );

      if (unbanErr) {
        return json(500, {
          error: "Failed to unban user",
          details: unbanErr.message,
        });
      }

      // Sync en profiles (para tu UI)
      await adminClient
        .from("profiles")
        .update({ is_active: true })
        .eq("id", targetUserId);

      return json(200, { ok: true, action: "unban", targetUserId });
    }

    return json(400, { error: "Unhandled action" });
  } catch (e) {
    return json(500, { error: "Unexpected error", details: String(e) });
  }
});
