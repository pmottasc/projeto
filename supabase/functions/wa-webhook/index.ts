// WhatsApp inbound webhook (Mock / Baileys / Meta / Evolution).
// Auth: tenant-scoped via webhook_secret in URL path: /wa-webhook/<tenant_id>?secret=<secret>
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { qrcode } from "https://deno.land/x/qrcode@v2.0.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

interface NormalizedMsg {
  from: string;
  name?: string;
  type?: "text" | "image" | "audio" | "video" | "document";
  body?: string;
  media_url?: string;
  media_mime?: string;
  external_id?: string;
  fromMe?: boolean;
}

interface NormalizedContact {
  phone: string;
  name?: string;
  avatar_url?: string;
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const normalizeQr = async (qr: string): Promise<string> => {
  if (!qr) return "";
  if (qr.startsWith("data:")) return qr;
  if (qr.startsWith("iVBOR") || qr.startsWith("/9j/") || qr.startsWith("base64,")) {
    return `data:image/png;base64,${qr.replace(/^base64,/, "")}`;
  }
  return String(await qrcode(qr));
};

// Normalize Evolution API webhook event to a generic message
async function parseEvolution(event: any): Promise<{ kind: string; messages: NormalizedMsg[]; contacts?: NormalizedContact[]; connectionState?: string; qr?: string }> {
  const e = event?.event || event?.type || "";
  const data = event?.data || event;

  // QR Code update
  if (e === "qrcode.updated" || e === "QRCODE_UPDATED") {
    const qr = await normalizeQr(data?.qrcode?.base64 || data?.base64 || data?.qr || "");
    return { kind: "qr", messages: [], qr };
  }

  // Connection update
  if (e === "connection.update" || e === "CONNECTION_UPDATE") {
    const state = data?.state || data?.connection || "";
    return { kind: "connection", messages: [], connectionState: state };
  }

  // Messages upsert
  if (e === "messages.upsert" || e === "MESSAGES_UPSERT") {
    const arr = Array.isArray(data?.messages) ? data.messages : (data?.key ? [data] : []);
    const msgs: NormalizedMsg[] = [];
    for (const m of arr) {
      const key = m?.key || {};
      const fromMe = !!key.fromMe;
      const remoteJid: string = key.remoteJid || "";
      if (!remoteJid || remoteJid.endsWith("@g.us")) continue; // skip groups for now
      const phone = remoteJid.split("@")[0].replace(/\D/g, "");
      const msg = m?.message || {};
      let body = "";
      let type: NormalizedMsg["type"] = "text";
      let media_url = "";
      let media_mime = "";
      if (msg.conversation) { body = msg.conversation; type = "text"; }
      else if (msg.extendedTextMessage?.text) { body = msg.extendedTextMessage.text; type = "text"; }
      else if (msg.imageMessage) { type = "image"; body = msg.imageMessage.caption || ""; media_mime = msg.imageMessage.mimetype || "image/jpeg"; }
      else if (msg.audioMessage) { type = "audio"; media_mime = msg.audioMessage.mimetype || "audio/ogg"; }
      else if (msg.videoMessage) { type = "video"; body = msg.videoMessage.caption || ""; media_mime = msg.videoMessage.mimetype || "video/mp4"; }
      else if (msg.documentMessage) { type = "document"; body = msg.documentMessage.fileName || ""; media_mime = msg.documentMessage.mimetype || ""; }
      else { body = "[mídia não suportada]"; }

      msgs.push({
        from: phone,
        name: m?.pushName || "",
        type, body, media_url, media_mime,
        external_id: key.id || "",
        fromMe,
      });
    }
    return { kind: "messages", messages: msgs };
  }

  if (["contacts.update", "contacts.upsert", "CONTACTS_UPDATE", "CONTACTS_UPSERT", "chats.update", "CHATS_UPDATE", "messaging-history.set", "MESSAGING_HISTORY_SET"].includes(e)) {
    const source = Array.isArray(data) ? data : Array.isArray(data?.contacts) ? data.contacts : Array.isArray(data?.chats) ? data.chats : Array.isArray(data?.data) ? data.data : [];
    const contacts: NormalizedContact[] = [];
    for (const c of source) {
      const jid = String(c?.remoteJid || c?.id || c?.jid || c?.owner || c?.key?.remoteJid || "");
      if (!jid || jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid.endsWith("@lid") || jid.includes("status@") || jid.includes("@newsletter")) continue;
      const phone = jid.split("@")[0].replace(/\D/g, "");
      if (!phone || phone.length < 10 || phone.length > 15) continue;
      contacts.push({
        phone,
        name: String(c?.pushName || c?.name || c?.verifiedName || c?.notify || c?.profileName || ""),
        avatar_url: String(c?.profilePicUrl || c?.profilePictureUrl || c?.profilePicture || ""),
      });
    }
    return { kind: "contacts", messages: [], contacts };
  }

  // Presence update (typing/recording/online)
  if (e === "presence.update" || e === "PRESENCE_UPDATE") {
    const id = String(data?.id || data?.remoteJid || data?.jid || "");
    const phone = id.split("@")[0].replace(/\D/g, "");
    const presences = data?.presences || {};
    let state = "available";
    for (const k of Object.keys(presences)) {
      const p = presences[k];
      state = String(p?.lastKnownPresence || p?.presence || "available");
      break;
    }
    if (!Object.keys(presences).length && data?.lastKnownPresence) {
      state = String(data.lastKnownPresence);
    }
    return { kind: "presence", messages: [], presence: { phone, state } } as any;
  }

  // Message status update (ack: sent/delivered/read)
  if (e === "messages.update" || e === "MESSAGES_UPDATE" || e === "send.message.update" || e === "SEND_MESSAGE_UPDATE" || e === "messages.ack" || e === "MESSAGES_ACK") {
    const arr = Array.isArray(data) ? data : Array.isArray(data?.messages) ? data.messages : (data?.key || data?.keyId ? [data] : []);
    const updates: { external_id: string; status: string }[] = [];
    for (const u of arr) {
      const id = u?.key?.id || u?.keyId || u?.id || u?.messageId || "";
      const rawStatus = String(u?.status || u?.update?.status || u?.ack || "").toUpperCase();
      let status = "";
      if (["READ", "PLAYED", "READ_BY_RECIPIENT", "4", "5"].includes(rawStatus)) status = "read";
      else if (["DELIVERY_ACK", "DELIVERED", "SERVER_ACK", "2", "3"].includes(rawStatus)) status = "delivered";
      else if (["PENDING", "0", "1"].includes(rawStatus)) status = "sent";
      if (id && status) updates.push({ external_id: id, status });
    }
    return { kind: "ack", messages: [], acks: updates } as any;
  }

  return { kind: "unknown", messages: [] };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const tenantId = parts[parts.length - 1];
    const secret = url.searchParams.get("secret") || req.headers.get("x-webhook-secret") || "";

    if (!tenantId || tenantId === "wa-webhook") {
      return json({ error: "tenant_id required in path" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: cfg, error: cfgErr } = await supabase
      .from("wa_provider_config")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (cfgErr || !cfg) return json({ error: "tenant config not found" }, 404);
    if (cfg.webhook_secret && cfg.webhook_secret !== secret) {
      return json({ error: "invalid secret" }, 401);
    }

    if (req.method === "GET") {
      // Meta webhook verification: requires hub.verify_token to match webhook_secret
      const mode = url.searchParams.get("hub.mode");
      const verifyToken = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode === "subscribe" && challenge) {
        if (verifyToken && cfg.webhook_secret && verifyToken !== cfg.webhook_secret) {
          return json({ error: "verify_token mismatch" }, 403);
        }
        return new Response(challenge, { status: 200, headers: corsHeaders });
      }
      if (challenge) return new Response(challenge, { status: 200, headers: corsHeaders });
      return json({ ok: true, status: cfg.status, provider: cfg.provider });
    }

    const raw = await req.json().catch(() => ({}));

    // Audit all events; presence is logged with a trimmed payload so we can diagnose typing indicators.
    const evType = raw?.event || raw?.type || "unknown";
    const isPresence = evType === "presence.update" || evType === "PRESENCE_UPDATE";
    await supabase.from("wa_webhook_events").insert({
      tenant_id: tenantId,
      provider: cfg.provider,
      event_type: evType,
      payload: isPresence ? { id: raw?.data?.id, presences: raw?.data?.presences } as any : raw as any,
      processed: false,
    });

    // Detect Evolution payload (has "event" string + "data" object)
    const isEvolution = typeof raw?.event === "string" && raw?.data;

    if (isEvolution) {
      const parsed = await parseEvolution(raw);

      if (parsed.kind === "qr" && parsed.qr) {
        await supabase.from("wa_provider_config").update({
          qr_code: parsed.qr,
          last_qr_at: new Date().toISOString(),
          status: "qr_required",
          status_message: "Escaneie o QR Code com seu WhatsApp",
          last_event_at: new Date().toISOString(),
        }).eq("tenant_id", tenantId);
        return json({ ok: true, kind: "qr" });
      }

      if (parsed.kind === "connection") {
        const map: Record<string, string> = { open: "connected", connecting: "connecting", close: "disconnected" };
        const newStatus = map[parsed.connectionState || ""] || cfg.status;
        const keepQrError = cfg.status === "error" && newStatus === "connecting" && !cfg.qr_code;
        const upd: any = {
          status: keepQrError ? "error" : newStatus,
          status_message:
            keepQrError ? cfg.status_message :
            newStatus === "connected" ? "WhatsApp conectado" :
            newStatus === "connecting" ? "Conectando..." : "Desconectado",
          last_event_at: new Date().toISOString(),
        };
        if (newStatus === "connected") { upd.last_connected_at = new Date().toISOString(); upd.qr_code = ""; }
        await supabase.from("wa_provider_config").update(upd).eq("tenant_id", tenantId);
        return json({ ok: true, kind: "connection", state: parsed.connectionState });
      }

      if (parsed.kind === "contacts") {
        const contacts = parsed.contacts || [];
        for (const c of contacts) {
          const { data: existing } = await supabase
            .from("wa_contacts")
            .select("id,name,avatar_url")
            .eq("tenant_id", tenantId)
            .eq("phone", c.phone)
            .maybeSingle();
          if (existing) {
            const patch: Record<string, string> = {};
            if (c.name && !existing.name) patch.name = c.name;
            if (c.avatar_url && !existing.avatar_url) patch.avatar_url = c.avatar_url;
            if (Object.keys(patch).length) await supabase.from("wa_contacts").update(patch).eq("id", existing.id);
          } else {
            await supabase.from("wa_contacts").insert({ tenant_id: tenantId, phone: c.phone, name: c.name || c.phone, avatar_url: c.avatar_url || "" });
          }
        }
        return json({ ok: true, kind: "contacts", count: contacts.length });
      }

      // Process ack/status updates
      if (parsed.kind === "ack") {
        const acks = (parsed as any).acks as { external_id: string; status: string }[];
        for (const a of acks) {
          if (!a.external_id) continue;
          // Only upgrade status (sent < delivered < read), never downgrade
          const rank: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 0 };
          const { data: existing } = await supabase
            .from("wa_messages").select("id,status")
            .eq("tenant_id", tenantId).eq("external_id", a.external_id).maybeSingle();
          if (existing && (rank[a.status] || 0) > (rank[existing.status as string] || 0)) {
            await supabase.from("wa_messages").update({ status: a.status }).eq("id", existing.id);
          }
        }
        return json({ ok: true, kind: "ack", count: acks.length });
      }

      // Broadcast presence (typing/recording) to clients via Realtime
      if (parsed.kind === "presence") {
        const pres = (parsed as any).presence as { phone: string; state: string };
        if (pres?.phone) {
          try {
            await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                apikey: serviceKey,
                Authorization: `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({
                messages: [{
                  topic: `wa-typing-${tenantId}`,
                  event: "presence",
                  payload: { phone: pres.phone, state: pres.state, ts: Date.now() },
                }],
              }),
            });
          } catch (e) {
            console.error("[wa-webhook] presence broadcast failed", e);
          }
        }
        return json({ ok: true, kind: "presence" });
      }

      // Process messages, including outgoing messages sent directly from WhatsApp
      for (const m of parsed.messages) {
        const saved = await persistMessage(supabase, tenantId, m);
        if (saved?.direction === "in") {
          await runBotEngine(supabaseUrl, serviceKey, tenantId, saved);
        }
      }
      return json({ ok: true, kind: parsed.kind, count: parsed.messages.length });
    }

    // Detect Meta WhatsApp Cloud API payload
    if (raw?.object === "whatsapp_business_account" && Array.isArray(raw?.entry)) {
      const parsed = await parseMeta(raw, cfg, supabase, tenantId);
      // ack updates
      for (const a of parsed.acks) {
        if (!a.external_id) continue;
        const rank: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 0 };
        const { data: existing } = await supabase
          .from("wa_messages").select("id,status")
          .eq("tenant_id", tenantId).eq("external_id", a.external_id).maybeSingle();
        if (existing && (rank[a.status] || 0) > (rank[existing.status as string] || 0)) {
          await supabase.from("wa_messages").update({ status: a.status }).eq("id", existing.id);
        }
      }
      for (const m of parsed.messages) {
        const saved = await persistMessage(supabase, tenantId, m);
        if (saved?.direction === "in") {
          await runBotEngine(supabaseUrl, serviceKey, tenantId, saved);
        }
      }
      await supabase.from("wa_provider_config").update({
        last_event_at: new Date().toISOString(),
      }).eq("tenant_id", tenantId);
      return json({ ok: true, kind: "meta", messages: parsed.messages.length, acks: parsed.acks.length });
    }

    // Generic / mock payload (legacy)
    const payload = raw as NormalizedMsg & { provider?: string };
    if (!payload?.from) return json({ error: "from is required" }, 400);
    const saved = await persistMessage(supabase, tenantId, payload);
    if (saved?.direction === "in") {
      await runBotEngine(supabaseUrl, serviceKey, tenantId, saved);
    }
    return json({ ok: true });
  } catch (e) {
    console.error("[wa-webhook] error", e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

async function persistMessage(supabase: any, tenantId: string, payload: NormalizedMsg): Promise<{ id: string; direction: "in" | "out"; conversation_id: string; contact_id: string; body: string } | null> {
  const phone = String(payload.from).replace(/\D/g, "");
  if (!phone) return null;
  const direction = payload.fromMe ? "out" : "in";

  // Find/create contact
  let { data: contact } = await supabase
    .from("wa_contacts").select("*")
    .eq("tenant_id", tenantId).eq("phone", phone).maybeSingle();
  if (!contact) {
    const { data: created } = await supabase
      .from("wa_contacts")
      .insert({ tenant_id: tenantId, phone, name: payload.name || "" })
      .select("*").maybeSingle();
    contact = created;
  } else if (payload.name && !contact.name) {
    await supabase.from("wa_contacts").update({ name: payload.name }).eq("id", contact.id);
  }

  // Find/create conversation — always reuse the most recent conversation for this contact.
  // If the latest one is "finalizado" and a new inbound message arrives, reopen it instead
  // of creating a duplicate, so the full history stays in a single thread.
  let { data: conv } = await supabase
    .from("wa_conversations").select("*")
    .eq("tenant_id", tenantId).eq("contact_id", contact.id)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1).maybeSingle();
  if (!conv) {
    const { data: created } = await supabase
      .from("wa_conversations")
      .insert({ tenant_id: tenantId, contact_id: contact.id, status: "novo" })
      .select("*").maybeSingle();
    conv = created;
  } else if (conv.status === "finalizado" && direction === "in") {
    // Reabre a conversa e reativa o fluxo do bot: limpa pausa, atendente e
    // departamento para que o wa-bot-engine inicie um novo fluxo do zero.
    const { data: reopened } = await supabase
      .from("wa_conversations")
      .update({
        status: "novo",
        archived_at: null,
        bot_paused: false,
        assignee_id: null,
        department_id: null,
      })
      .eq("id", conv.id)
      .select("*").maybeSingle();
    if (reopened) conv = reopened;
    // Encerra qualquer sessão antiga do chatbot para permitir nova inicialização
    await supabase
      .from("chatbot_sessions")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("conversation_id", conv.id)
      .eq("status", "active");
  }

  const body = payload.body || "";
  if (payload.external_id) {
    const { data: existingMsg } = await supabase
      .from("wa_messages")
      .select("id,status,direction")
      .eq("tenant_id", tenantId)
      .eq("external_id", payload.external_id)
      .maybeSingle();
    if (existingMsg) {
      if (direction === "out" && existingMsg.direction === "out" && existingMsg.status === "pending") {
        await supabase.from("wa_messages").update({ status: "sent" }).eq("id", existingMsg.id);
      }
      return null;
    }
  }

  // Dedup fallback: if same body+direction came in the last 15s for this conversation, skip.
  // Protects against duplicated webhook deliveries from Evolution that lack a stable external_id.
  if (body) {
    const since = new Date(Date.now() - 15_000).toISOString();
    const { data: recent } = await supabase
      .from("wa_messages")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("conversation_id", conv.id)
      .eq("direction", direction)
      .eq("body", body)
      .gte("created_at", since)
      .limit(1)
      .maybeSingle();
    if (recent) {
      console.log("[wa-webhook] dedup skipped duplicate inbound", { conv: conv.id, body: body.slice(0, 40) });
      return null;
    }
  }

  const { data: inserted, error: insertErr } = await supabase.from("wa_messages").insert({
    tenant_id: tenantId,
    conversation_id: conv.id,
    contact_id: contact.id,
    direction,
    type: payload.type || "text",
    body,
    media_url: payload.media_url || "",
    media_mime: payload.media_mime || "",
    external_id: payload.external_id || "",
    status: direction === "out" ? "sent" : "delivered",
    metadata: {},
  }).select("id").maybeSingle();

  if (insertErr || !inserted?.id) {
    console.log("[wa-webhook] skipped message insert", { code: insertErr?.code, message: insertErr?.message });
    return null;
  }

  const conversationUpdate: Record<string, unknown> = {
    last_message_preview: body.slice(0, 120) || `[${payload.type}]`,
    last_message_at: new Date().toISOString(),
  };
  if (direction === "in") {
    conversationUpdate.unread_count = (conv.unread_count || 0) + 1;
  }
  await supabase.from("wa_conversations").update(conversationUpdate).eq("id", conv.id);
  return { id: inserted.id, direction, conversation_id: conv.id, contact_id: contact.id, body };
}

async function runBotEngine(
  supabaseUrl: string,
  serviceKey: string,
  tenantId: string,
  saved: { id: string; conversation_id: string; contact_id: string; body: string },
) {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/wa-bot-engine`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": serviceKey,
      },
      body: JSON.stringify({
        tenant_id: tenantId,
        conversation_id: saved.conversation_id,
        contact_id: saved.contact_id,
        message_id: saved.id,
        body: saved.body,
      }),
    });
    if (!res.ok) console.error("[wa-webhook] bot engine failed", res.status, await res.text());
  } catch (e) {
    console.error("[wa-webhook] bot engine error", e);
  }
}

// ============================
// Meta WhatsApp Cloud API parsing
// ============================
const META_GRAPH = "https://graph.facebook.com/v21.0";

interface MetaParsed { messages: NormalizedMsg[]; acks: { external_id: string; status: string }[] }

async function metaDownloadMedia(
  supabase: any,
  tenantId: string,
  mediaId: string,
  accessToken: string,
  mimeType: string,
): Promise<{ url: string; mime: string } | null> {
  try {
    const r = await fetch(`${META_GRAPH}/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) return null;
    const meta = await r.json();
    const fileResp = await fetch(meta.url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!fileResp.ok) return null;
    const buf = new Uint8Array(await fileResp.arrayBuffer());
    const mime = meta.mime_type || mimeType || fileResp.headers.get("content-type") || "application/octet-stream";
    const ext = mime.split("/")[1]?.split(";")[0] || "bin";
    const path = `meta-in/${tenantId}/${mediaId}.${ext}`;
    const { error: upErr } = await supabase.storage.from("chat-attachments").upload(path, buf, {
      contentType: mime,
      upsert: true,
    });
    if (upErr) {
      console.error("[wa-webhook] meta media upload failed", upErr);
      return null;
    }
    const { data: pub } = supabase.storage.from("chat-attachments").getPublicUrl(path);
    return { url: pub.publicUrl, mime };
  } catch (e) {
    console.error("[wa-webhook] meta media download error", e);
    return null;
  }
}

async function parseMeta(event: any, cfg: any, supabase: any, tenantId: string): Promise<MetaParsed> {
  const messages: NormalizedMsg[] = [];
  const acks: { external_id: string; status: string }[] = [];
  const accessToken: string = cfg?.meta_access_token || "";

  for (const entry of event.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== "messages") continue;
      const value = change.value || {};
      const contacts = value.contacts || [];
      const contactName = contacts?.[0]?.profile?.name || "";

      // Status updates (sent/delivered/read/failed)
      for (const s of value.statuses || []) {
        const id = s.id || "";
        const st = String(s.status || "").toLowerCase();
        let mapped = "";
        if (st === "read") mapped = "read";
        else if (st === "delivered") mapped = "delivered";
        else if (st === "sent") mapped = "sent";
        else if (st === "failed") mapped = "failed";
        if (id && mapped) acks.push({ external_id: id, status: mapped });
      }

      // Inbound messages
      for (const m of value.messages || []) {
        const phone = String(m.from || "").replace(/\D/g, "");
        if (!phone) continue;
        const msgId = m.id || "";
        const type = String(m.type || "text");
        let body = "";
        let normType: NormalizedMsg["type"] = "text";
        let media_url = "";
        let media_mime = "";

        if (type === "text") {
          body = m.text?.body || "";
          normType = "text";
        } else if (type === "image" || type === "audio" || type === "video" || type === "document" || type === "sticker") {
          normType = (type === "sticker" ? "image" : type) as NormalizedMsg["type"];
          const mediaObj = m[type] || {};
          body = mediaObj.caption || mediaObj.filename || "";
          media_mime = mediaObj.mime_type || "";
          if (mediaObj.id && accessToken) {
            const dl = await metaDownloadMedia(supabase, tenantId, mediaObj.id, accessToken, media_mime);
            if (dl) {
              media_url = dl.url;
              media_mime = dl.mime;
            }
          }
        } else if (type === "button") {
          body = m.button?.text || "";
          normType = "text";
        } else if (type === "interactive") {
          body = m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || "";
          normType = "text";
        } else {
          body = `[${type} não suportado]`;
          normType = "text";
        }

        messages.push({
          from: phone,
          name: contactName,
          type: normType,
          body,
          media_url,
          media_mime,
          external_id: msgId,
          fromMe: false,
        });
      }
    }
  }
  return { messages, acks };
}
