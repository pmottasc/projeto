// Test helper to inject a fake inbound WhatsApp message (Mock provider).
// Requires authenticated user belonging to the tenant.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "missing auth" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );

    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "unauthorized" }, 401);

    const { tenant_id, phone, body, name } = await req.json();
    if (!tenant_id || !phone || !body) return json({ error: "missing fields" }, 400);

    const { data: member } = await supabase
      .from("tenant_members")
      .select("id")
      .eq("user_id", user.id)
      .eq("tenant_id", tenant_id)
      .maybeSingle();
    if (!member) return json({ error: "forbidden" }, 403);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const cleanPhone = String(phone).replace(/\D/g, "");
    let { data: contact } = await admin.from("wa_contacts")
      .select("*").eq("tenant_id", tenant_id).eq("phone", cleanPhone).maybeSingle();
    if (!contact) {
      const { data: c } = await admin.from("wa_contacts")
        .insert({ tenant_id, phone: cleanPhone, name: name || "" }).select("*").maybeSingle();
      contact = c;
    }
    let { data: conv } = await admin.from("wa_conversations")
      .select("*").eq("tenant_id", tenant_id).eq("contact_id", contact!.id)
      .neq("status", "finalizado").order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1).maybeSingle();
    if (!conv) {
      const { data: c } = await admin.from("wa_conversations")
        .insert({ tenant_id, contact_id: contact!.id, status: "novo" }).select("*").maybeSingle();
      conv = c;
    }
    await admin.from("wa_messages").insert({
      tenant_id, conversation_id: conv!.id, contact_id: contact!.id,
      direction: "in", type: "text", body, status: "delivered",
    });
    await admin.from("wa_conversations").update({
      last_message_preview: body.slice(0, 120),
      last_message_at: new Date().toISOString(),
      unread_count: (conv!.unread_count || 0) + 1,
    }).eq("id", conv!.id);

    // Trigger bot engine (fire-and-forget but awaited so logs flush)
    try {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-bot-engine`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        },
        body: JSON.stringify({
          tenant_id, conversation_id: conv!.id, contact_id: contact!.id, body,
        }),
      });
    } catch (_) { /* ignore */ }

    return json({ ok: true, conversation_id: conv!.id });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
