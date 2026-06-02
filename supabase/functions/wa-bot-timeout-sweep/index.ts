// Sweeps active chatbot sessions and forces handoff when the customer has
// been inactive for longer than the flow's configured timeout.
// Designed to be invoked by pg_cron every minute.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Pull active sessions
    const { data: sessions, error: sErr } = await admin
      .from("chatbot_sessions")
      .select("id, tenant_id, conversation_id, flow_id, updated_at")
      .eq("status", "active")
      .limit(500);

    if (sErr) return json({ error: sErr.message }, 500);
    if (!sessions || sessions.length === 0) return json({ ok: true, processed: 0 });

    // Pull related flows once
    const flowIds = Array.from(new Set(sessions.map((s) => s.flow_id).filter(Boolean)));
    const { data: flows } = await admin
      .from("chatbot_flows")
      .select("id, inactivity_timeout_enabled, inactivity_timeout_minutes, inactivity_handoff_department_id")
      .in("id", flowIds);
    const flowsById = new Map((flows || []).map((f: any) => [f.id, f]));

    let handed = 0;
    const now = Date.now();

    for (const s of sessions) {
      const flow: any = flowsById.get(s.flow_id);
      if (!flow || !flow.inactivity_timeout_enabled) continue;
      const timeoutMin = Number(flow.inactivity_timeout_minutes) || 10;
      const thresholdMs = timeoutMin * 60 * 1000;

      // Find last inbound message of this conversation
      const { data: lastIn } = await admin
        .from("wa_messages")
        .select("created_at")
        .eq("conversation_id", s.conversation_id)
        .eq("direction", "in")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const lastInbound = lastIn?.created_at
        ? new Date(lastIn.created_at).getTime()
        : new Date(s.updated_at).getTime();

      if (now - lastInbound < thresholdMs) continue;

      // Time to hand off
      const update: Record<string, unknown> = {
        status: "em_atendimento",
        bot_paused: true,
      };
      if (flow.inactivity_handoff_department_id) {
        update.department_id = flow.inactivity_handoff_department_id;
      }
      await admin.from("wa_conversations").update(update).eq("id", s.conversation_id);

      // End the bot session
      await admin
        .from("chatbot_sessions")
        .update({ status: "timeout", ended_at: new Date().toISOString() })
        .eq("id", s.id);

      // System message in the chat
      const { data: conv } = await admin
        .from("wa_conversations")
        .select("contact_id")
        .eq("id", s.conversation_id)
        .maybeSingle();

      if (conv?.contact_id) {
        await admin.from("wa_messages").insert({
          tenant_id: s.tenant_id,
          conversation_id: s.conversation_id,
          contact_id: conv.contact_id,
          direction: "out",
          type: "system",
          body: `Cliente inativo por ${timeoutMin} min. Conversa encaminhada para atendimento humano.`,
          status: "sent",
        });
      }

      handed++;
    }

    return json({ ok: true, processed: sessions.length, handed_off: handed });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
