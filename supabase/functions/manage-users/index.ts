// manage-users — admin-only user management for the ChlorTainer Inventory app.
// Actions: list, invite, remove, set_admin. Caller must have app_metadata.role === "admin".
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Identify the caller from their JWT, then re-read their record server-side
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user: caller }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !caller) return json({ error: "Not signed in" }, 401);
    const { data: fresh } = await admin.auth.admin.getUserById(caller.id);
    if (fresh?.user?.app_metadata?.role !== "admin") return json({ error: "Admins only" }, 403);

    const { action, email, userId, isAdmin, redirectTo } = await req.json();

    if (action === "list") {
      const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
      if (error) throw error;
      const users = data.users.map((u) => ({
        id: u.id,
        email: u.email,
        isAdmin: u.app_metadata?.role === "admin",
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at,
        invitedAt: u.invited_at,
        confirmed: !!u.email_confirmed_at,
      })).sort((a, b) => (a.email || "").localeCompare(b.email || ""));
      return json({ users });
    }

    if (action === "invite") {
      const clean = String(email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return json({ error: "Enter a valid email" }, 400);
      const { data, error } = await admin.auth.admin.inviteUserByEmail(clean, redirectTo ? { redirectTo } : undefined);
      if (error) {
        const msg = /already|registered|exists/i.test(error.message) ? "That email already has access" : error.message;
        return json({ error: msg }, 400);
      }
      return json({ ok: true, id: data.user?.id });
    }

    if (action === "remove") {
      if (!userId) return json({ error: "Missing user" }, 400);
      if (userId === caller.id) return json({ error: "You can't remove yourself" }, 400);
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "set_admin") {
      if (!userId) return json({ error: "Missing user" }, 400);
      if (userId === caller.id && !isAdmin) return json({ error: "You can't remove your own admin rights" }, 400);
      const { data: target, error: gErr } = await admin.auth.admin.getUserById(userId);
      if (gErr) throw gErr;
      const meta = { ...(target.user.app_metadata || {}) };
      if (isAdmin) meta.role = "admin"; else delete meta.role;
      const { error } = await admin.auth.admin.updateUserById(userId, { app_metadata: meta });
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
