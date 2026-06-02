// Meta WhatsApp Cloud API integration
// Actions: verify | send | send_media
// Each tenant stores its own meta_access_token + meta_phone_number_id in wa_provider_config
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const GRAPH = "https://graph.facebook.com/v21.0";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface MetaCfg {
  meta_access_token: string;
  meta_phone_number_id: string;
}

async function loadCfg(supabase: any, tenantId: string): Promise<MetaCfg | null> {
  const { data } = await supabase
    .from("wa_provider_config")
    .select("meta_access_token,meta_phone_number_id,provider")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return null;
  if (!data.meta_access_token || !data.meta_phone_number_id) return null;
  return data as MetaCfg;
}

function onlyDigits(s: string) {
  return String(s || "").replace(/\D/g, "");
}

function inferMediaType(mediaType: string): "image" | "audio" | "video" | "document" {
  if (mediaType === "image" || mediaType === "audio" || mediaType === "video") return mediaType;
  return "document";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const action: string = body?.action || new URL(req.url).searchParams.get("action") || "";
    const tenantId: string = body?.tenant_id || "";

    if (!tenantId) return json({ error: "tenant_id required" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const cfg = await loadCfg(supabase, tenantId);
    if (!cfg) {
      return json({ error: "Credenciais Meta não configuradas (token e Phone Number ID obrigatórios)" }, 400);
    }

    const authHeaders = {
      Authorization: `Bearer ${cfg.meta_access_token}`,
      "Content-Type": "application/json",
    };

    if (action === "verify") {
      const r = await fetch(`${GRAPH}/${cfg.meta_phone_number_id}?fields=display_phone_number,verified_name,quality_rating`, {
        headers: { Authorization: `Bearer ${cfg.meta_access_token}` },
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        await supabase.from("wa_provider_config").update({
          status: "error",
          status_message: `Meta: ${data?.error?.message || r.statusText}`,
        }).eq("tenant_id", tenantId);
        return json({ error: data?.error?.message || `HTTP ${r.status}` }, 400);
      }
      await supabase.from("wa_provider_config").update({
        status: "connected",
        status_message: "Conectado à Meta WhatsApp Cloud API",
        phone_number: data?.display_phone_number || "",
        last_connected_at: new Date().toISOString(),
        last_event_at: new Date().toISOString(),
      }).eq("tenant_id", tenantId);
      return json({ ok: true, ...data });
    }

    if (action === "send") {
      const phone = onlyDigits(body?.phone || "");
      const text = String(body?.text || "");
      if (!phone || !text) return json({ error: "phone and text required" }, 400);
      const r = await fetch(`${GRAPH}/${cfg.meta_phone_number_id}/messages`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: phone,
          type: "text",
          text: { preview_url: false, body: text },
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return json({ error: data?.error?.message || `HTTP ${r.status}`, raw: data }, 400);
      const externalId = data?.messages?.[0]?.id || "";
      return json({ ok: true, externalId });
    }

    if (action === "send_media") {
      const phone = onlyDigits(body?.phone || "");
      const mediaUrl: string = body?.media_url || "";
      const mediaType = inferMediaType(String(body?.media_type || "document"));
      const caption: string = body?.caption || "";
      const fileName: string = body?.file_name || "";
      if (!phone || !mediaUrl) return json({ error: "phone and media_url required" }, 400);

      const payload: any = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phone,
        type: mediaType,
      };
      const mediaObj: any = { link: mediaUrl };
      if ((mediaType === "image" || mediaType === "video" || mediaType === "document") && caption) {
        mediaObj.caption = caption;
      }
      if (mediaType === "document" && fileName) mediaObj.filename = fileName;
      payload[mediaType] = mediaObj;

      const r = await fetch(`${GRAPH}/${cfg.meta_phone_number_id}/messages`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return json({ error: data?.error?.message || `HTTP ${r.status}`, raw: data }, 400);
      const externalId = data?.messages?.[0]?.id || "";

      // If there is a caption with audio (which doesn't accept it), send a follow-up text
      if (mediaType === "audio" && caption) {
        await fetch(`${GRAPH}/${cfg.meta_phone_number_id}/messages`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: phone,
            type: "text",
            text: { body: caption },
          }),
        }).catch(() => {});
      }
      return json({ ok: true, externalId });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("[wa-meta] error", e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
