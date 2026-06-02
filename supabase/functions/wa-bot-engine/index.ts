// Bot engine: processes an inbound message, runs the active flow for the tenant,
// advances the session, and writes outbound messages. Internal use (called by
// wa-mock-inject and wa-webhook). Service role only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Node = {
  id: string;
  kind: "start" | "message" | "question" | "menu" | "condition" | "action" | "handoff" | "end";
  label: string;
  config: Record<string, unknown>;
};
type Edge = {
  id: string;
  source_node_id: string;
  target_node_id: string;
  source_handle: string;
  label: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const internalSecret = req.headers.get("x-internal-secret");
    if (internalSecret !== Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
      return json({ error: "forbidden" }, 403);
    }
    const { tenant_id, conversation_id, contact_id, message_id, body } = await req.json();
    if (!tenant_id || !conversation_id || !contact_id) {
      return json({ error: "missing fields" }, 400);
    }
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (message_id) {
      const { data: locked, error: lockErr } = await admin
        .from("wa_messages")
        .update({ bot_processed_at: new Date().toISOString() })
        .eq("id", message_id)
        .is("bot_processed_at", null)
        .select("id")
        .maybeSingle();
      if (lockErr || !locked) return json({ ok: true, skipped: "already_processed" });
    }

    // Skip if bot is paused on this conversation
    const { data: conv } = await admin.from("wa_conversations")
      .select("bot_paused,status").eq("id", conversation_id).maybeSingle();
    if (!conv || conv.bot_paused) return json({ ok: true, skipped: "paused" });

    // Find existing session, or pick a flow to start
    let { data: session } = await admin.from("chatbot_sessions")
      .select("*").eq("conversation_id", conversation_id).eq("status", "active")
      .maybeSingle();

    let flowId = session?.flow_id as string | undefined;
    let nodes: Node[] = [];
    let edges: Edge[] = [];

    let matchedFlow: any = null;
    if (!flowId) {
      const { data: flows } = await admin.from("chatbot_flows")
        .select("*").eq("tenant_id", tenant_id).eq("active", true);
      const text = String(body || "").toLowerCase();
      matchedFlow = (flows || []).find((f) => {
        if (f.trigger_kind === "first_contact") return true;
        if (f.trigger_kind === "any_message") return true;
        if (f.trigger_kind === "keyword") {
          return (f.trigger_keywords || []).some((k: string) => text.includes(k.toLowerCase()));
        }
        return false;
      });
      if (!matchedFlow) return json({ ok: true, skipped: "no_flow" });
      flowId = matchedFlow.id;
    } else {
      const { data: f } = await admin.from("chatbot_flows").select("*").eq("id", flowId).maybeSingle();
      matchedFlow = f;
    }

    // If flow is in agent mode, delegate to wa-agent-loop and stop here.
    if (matchedFlow?.mode === "agent") {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const r = await fetch(`${supabaseUrl}/functions/v1/wa-agent-loop`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ tenant_id, conversation_id, contact_id, message_id, body, flow: matchedFlow }),
      });
      const out = await r.json().catch(() => ({}));
      return json({ ok: true, agent: out });
    }

    const [{ data: nodesData }, { data: edgesData }] = await Promise.all([
      admin.from("chatbot_nodes").select("*").eq("flow_id", flowId),
      admin.from("chatbot_edges").select("*").eq("flow_id", flowId),
    ]);
    nodes = (nodesData || []) as Node[];
    edges = (edgesData || []) as Edge[];

    if (!session) {
      const start = nodes.find((n) => n.kind === "start");
      if (!start) return json({ ok: true, skipped: "no_start" });
      const { data: created } = await admin.from("chatbot_sessions").insert({
        tenant_id, conversation_id, flow_id: flowId,
        current_node_id: start.id, variables: {}, status: "active",
      }).select("*").maybeSingle();
      session = created;
    }

    let variables = (session!.variables || {}) as Record<string, unknown>;
    let currentId = session!.current_node_id as string;
    let currentNode = nodes.find((n) => n.id === currentId);
    if (!currentNode) return json({ ok: true, skipped: "no_node" });

    const sent: string[] = [];

    // If we are waiting on a question/menu, capture the user's answer and advance.
    // Otherwise (start node, etc.) re-execute the current node so it sends a reply.
    if (currentNode.kind === "question") {
      const varName = String(currentNode.config?.variable || "answer");
      variables[varName] = body;
      currentId = pickNext(edges, currentNode.id);
      currentNode = nodes.find((n) => n.id === currentId);
    } else if (currentNode.kind === "menu") {
      const opts = Array.isArray(currentNode.config?.options)
        ? (currentNode.config!.options as Array<{ label: string; prefix?: string }>)
        : [];
      const varName = String(currentNode.config?.variable || "menu_choice");
      const rawUser = String(body || "").trim();
      const userText = rawUser.toLowerCase();
      let chosenIdx = -1;

      // 1) try numeric (1, 2, ...) — also handles "1️⃣ " -> "1"
      const normalized = rawUser
        .replace(/([0-9])\uFE0F?\u20E3/g, "$1") // strip keycap emoji combiners
        .replace(/🔟/g, "10")
        .trim();
      const numMatch = normalized.match(/^\s*(\d+)/);
      if (numMatch) {
        const n = parseInt(numMatch[1], 10) - 1;
        if (n >= 0 && n < opts.length) chosenIdx = n;
      }
      // 2) try letter (A, B, ...)
      if (chosenIdx === -1 && /^[a-z]\b/i.test(rawUser)) {
        const n = rawUser.toUpperCase().charCodeAt(0) - 65;
        if (n >= 0 && n < opts.length) chosenIdx = n;
      }
      // 3) try exact prefix match (custom prefix)
      if (chosenIdx === -1) {
        chosenIdx = opts.findIndex((o) => o.prefix && rawUser.startsWith(o.prefix.trim()));
      }
      // 4) try keyword match against option labels
      if (chosenIdx === -1) {
        chosenIdx = opts.findIndex((o) =>
          userText && (o.label || "").toLowerCase().includes(userText)
        );
      }
      const handle = chosenIdx >= 0 ? `opt-${chosenIdx}` : "fallback";
      variables[varName] = chosenIdx >= 0 ? (opts[chosenIdx].label || String(chosenIdx + 1)) : body;
      currentId = pickNext(edges, currentNode.id, handle);
      // If fallback has no edge, repeat the menu
      if (!currentId && chosenIdx === -1) {
        const text = renderMenu(currentNode);
        if (text) { await sendOut(admin, tenant_id, conversation_id, contact_id, text); sent.push(text); }
        await admin.from("chatbot_sessions").update({
          current_node_id: currentNode.id, variables, updated_at: new Date().toISOString(),
        }).eq("id", session!.id);
        return json({ ok: true, sent, repeated_menu: true });
      }
      currentNode = nodes.find((n) => n.id === currentId);
    } else if (currentNode.kind === "start") {
      currentId = pickNext(edges, currentNode.id);
      currentNode = nodes.find((n) => n.id === currentId);
    }

    let safety = 20;
    while (currentNode && safety-- > 0) {
      if (currentNode.kind === "message") {
        const text = interpolate(String(currentNode.config?.text || ""), variables);
        if (text) {
          await sendOut(admin, tenant_id, conversation_id, contact_id, text);
          sent.push(text);
        }
        currentId = pickNext(edges, currentNode.id);
        currentNode = nodes.find((n) => n.id === currentId);
        continue;
      }
      if (currentNode.kind === "question") {
        const text = interpolate(String(currentNode.config?.text || currentNode.config?.question || ""), variables);
        if (text) {
          await sendOut(admin, tenant_id, conversation_id, contact_id, text);
          sent.push(text);
        }
        // Pause here, wait for next inbound to capture variable
        break;
      }
      if (currentNode.kind === "menu") {
        const text = renderMenu(currentNode);
        if (text) {
          await sendOut(admin, tenant_id, conversation_id, contact_id, text);
          sent.push(text);
        }
        // Pause and wait for the user's choice
        break;
      }
      if (currentNode.kind === "condition") {
        const varName = String(currentNode.config?.variable || "answer");
        const op = String(currentNode.config?.operator || "contains");
        const value = String(currentNode.config?.value || "").toLowerCase();
        const v = String(variables[varName] ?? "").toLowerCase();
        const truthy = op === "equals" ? v === value : v.includes(value);
        currentId = pickNext(edges, currentNode.id, truthy ? "true" : "false");
        currentNode = nodes.find((n) => n.id === currentId);
        continue;
      }
      if (currentNode.kind === "action") {
        const action = String(currentNode.config?.action || "");
        if (action === "add_tag") {
          const tag = String(currentNode.config?.tag || "");
          if (tag) {
            await admin.rpc("noop").catch(() => {});
            const { data: c } = await admin.from("wa_conversations")
              .select("tags").eq("id", conversation_id).maybeSingle();
            const tags = Array.from(new Set([...(c?.tags || []), tag]));
            await admin.from("wa_conversations").update({ tags }).eq("id", conversation_id);
          }
        } else if (action === "create_ticket") {
          // Mark for human; create_ticket requires a created_by user — skipped in bot flow
        }
        currentId = pickNext(edges, currentNode.id);
        currentNode = nodes.find((n) => n.id === currentId);
        continue;
      }
      if (currentNode.kind === "handoff") {
        const departmentId = (currentNode.config?.department_id as string) || null;
        const assigneeId = (currentNode.config?.assignee_id as string) || null;
        const update: Record<string, unknown> = {
          bot_paused: true, status: "em_atendimento",
        };
        if (departmentId) update.department_id = departmentId;
        if (assigneeId) update.assignee_id = assigneeId;
        await admin.from("wa_conversations").update(update).eq("id", conversation_id);
        const msg = interpolate(String(currentNode.config?.text || "Encaminhando para um atendente humano..."), variables);
        await sendOut(admin, tenant_id, conversation_id, contact_id, msg);
        sent.push(msg);
        await admin.from("chatbot_sessions").update({
          status: "handoff", ended_at: new Date().toISOString(),
        }).eq("id", session!.id);
        return json({ ok: true, sent, handoff: true, department_id: departmentId, assignee_id: assigneeId });
      }
      if (currentNode.kind === "end") {
        const farewell = interpolate(String(currentNode.config?.text || ""), variables);
        if (farewell) {
          await sendOut(admin, tenant_id, conversation_id, contact_id, farewell);
          sent.push(farewell);
        }
        await admin.from("chatbot_sessions").update({
          status: "ended", ended_at: new Date().toISOString(),
        }).eq("id", session!.id);
        return json({ ok: true, sent, ended: true });
      }
      // start or unknown — advance
      currentId = pickNext(edges, currentNode.id);
      currentNode = nodes.find((n) => n.id === currentId);
    }

    await admin.from("chatbot_sessions").update({
      current_node_id: currentNode?.id || null,
      variables,
      updated_at: new Date().toISOString(),
    }).eq("id", session!.id);

    return json({ ok: true, sent });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

function pickNext(edges: Edge[], from: string, handle?: string): string {
  const candidates = edges.filter((e) => e.source_node_id === from);
  if (handle) {
    const match = candidates.find((e) => e.source_handle === handle);
    if (match) return match.target_node_id;
  }
  return candidates[0]?.target_node_id || "";
}

function interpolate(text: string, vars: Record<string, unknown>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(vars[k] ?? ""));
}

function renderMenu(node: Node): string {
  const question = String(node.config?.question || "Escolha uma opção:");
  const opts = Array.isArray(node.config?.options)
    ? (node.config!.options as Array<{ label: string; prefix?: string }>)
    : [];
  const style = String(node.config?.numbering_style || "number");
  const presets: Record<string, (i: number) => string> = {
    number: (i) => `${i + 1}.`,
    emoji: (i) => ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"][i] || `${i + 1}️⃣`,
    letter: (i) => `${String.fromCharCode(65 + i)})`,
    arrow: (i) => `▶️ ${i + 1}`,
    bullet: () => "•",
    none: () => "",
    custom: () => "",
  };
  const fn = presets[style] || presets.number;
  const lines = opts.map((o, i) => {
    const prefix = (o.prefix && o.prefix.trim()) || fn(i);
    const label = o.label || `Opção ${i + 1}`;
    return prefix ? `${prefix} ${label}` : label;
  });
  return `${question}\n\n${lines.join("\n")}`;
}

async function sendOut(
  admin: ReturnType<typeof createClient>,
  tenant_id: string, conversation_id: string, contact_id: string, body: string,
) {
  const { data: inserted } = await admin.from("wa_messages").insert({
    tenant_id, conversation_id, contact_id,
    direction: "out", type: "text", body, status: "pending",
  }).select("id").maybeSingle();

  const delivery = await sendTextViaProvider(admin, tenant_id, contact_id, body);
  if (inserted?.id) {
    await admin.from("wa_messages").update({
      status: delivery.ok ? "sent" : "failed",
      external_id: delivery.externalId || "",
    }).eq("id", inserted.id);
  }

  await admin.from("wa_conversations").update({
    last_message_preview: body.slice(0, 120),
    last_message_at: new Date().toISOString(),
  }).eq("id", conversation_id);
}

async function sendTextViaProvider(
  admin: ReturnType<typeof createClient>,
  tenant_id: string,
  contact_id: string,
  body: string,
): Promise<{ ok: boolean; externalId?: string }> {
  const [{ data: cfg }, { data: contact }] = await Promise.all([
    admin.from("wa_provider_config").select("provider,evolution_instance_name,evolution_api_url,evolution_api_key").eq("tenant_id", tenant_id).maybeSingle(),
    admin.from("wa_contacts").select("phone").eq("id", contact_id).maybeSingle(),
  ]);

  if (cfg?.provider !== "evolution") return { ok: true };
  // API global compartilhada por todos os tenants (URL e Key vêm dos secrets).
  // Apenas a instância (número/conexão) é por tenant.
  let evoUrl = (Deno.env.get("EVOLUTION_API_URL") || "").trim().replace(/\/+$/, "");
  if (evoUrl && !/^https?:\/\//i.test(evoUrl)) evoUrl = `https://${evoUrl}`;
  const evoKey = Deno.env.get("EVOLUTION_API_KEY") || "";
  // Cada tenant tem sua própria instância. Não usar fallback compartilhado:
  // se o tenant não tem instance configurada, abortamos para evitar enviar pelo número de outro tenant.
  const instance = cfg.evolution_instance_name || "";
  const phone = String(contact?.phone || "").replace(/\D/g, "");
  if (!evoUrl || !evoKey || !phone || !instance) return { ok: false };

  const res = await fetch(`${evoUrl}/message/sendText/${instance}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: evoKey },
    body: JSON.stringify({
      number: phone,
      text: body,
      options: { delay: 0, presence: "composing" },
    }),
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) console.error("[wa-bot-engine] send failed", res.status, JSON.stringify(data).slice(0, 500));
  return { ok: res.ok, externalId: data?.key?.id || undefined };
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
