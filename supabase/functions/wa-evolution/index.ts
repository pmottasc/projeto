// Evolution API integration: connect, status, disconnect, restart, send
// Actions via ?action= or body.action: connect | status | disconnect | restart | send | logout
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { qrcode } from "https://deno.land/x/qrcode@v2.0.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const isAlreadyExists = (data: any) => {
  const text = JSON.stringify(data || {}).toLowerCase();
  return text.includes("already") || text.includes("existe") || text.includes("duplic") || text.includes("unique");
};

const EVOLUTION_EVENTS = [
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "SEND_MESSAGE_UPDATE",
  "PRESENCE_UPDATE",
  "CONNECTION_UPDATE",
  "QRCODE_UPDATED",
  "CONTACTS_UPDATE",
  "CHATS_UPDATE",
  "MESSAGES_SET",
];

const QR_TROUBLESHOOTING =
  "A Evolution está respondendo {count:0}, ou seja: a instância foi criada, mas a própria API não gerou o QR. No Railway, não use atendai/evolution-api:latest porque ele volta para v2.2.3. Troque a imagem para evoapicloud/evolution-api:v2.3.7 ou evoapicloud/evolution-api:v2.3.6, remova/deixe vazia a variável CONFIG_SESSION_PHONE_VERSION se o QR continuar falhando, mantenha QRCODE_LIMIT=30 e faça redeploy.";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const extractQr = (data: any): string => {
  const fromKnownShape =
    data?.base64 ||
    data?.code ||
    data?.qr ||
    data?.qrcode?.base64 ||
    data?.qrcode?.code ||
    data?.qrcode?.qr ||
    data?.data?.base64 ||
    data?.data?.code ||
    data?.data?.qrcode?.base64 ||
    data?.data?.qrcode?.code ||
    "";
  if (typeof fromKnownShape === "string" && fromKnownShape.trim()) return fromKnownShape.trim();

  const seen = new WeakSet<object>();
  const scan = (value: any, keyHint = ""): string => {
    if (!value) return "";
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) return "";
      const key = keyHint.toLowerCase();
      const isQrField = key.includes("qr") || key.includes("qrcode") || key.includes("base64") || key === "code";
      const looksLikeQr = text.startsWith("data:image/") || text.startsWith("iVBOR") || text.startsWith("/9j/") || text.startsWith("base64,") || text.startsWith("2@");
      return isQrField || looksLikeQr ? text : "";
    }
    if (typeof value !== "object" || seen.has(value)) return "";
    seen.add(value);

    for (const key of ["base64", "code", "qr", "qrcode"]) {
      const found = scan(value[key], key);
      if (found) return found;
    }
    for (const [key, child] of Object.entries(value)) {
      const found = scan(child, key);
      if (found) return found;
    }
    return "";
  };

  return scan(data);
};

const normalizeQr = async (qr: any): Promise<string> => {
  if (!qr || typeof qr !== "string") return "";
  if (qr.startsWith("data:")) return qr;
  if (qr.startsWith("iVBOR") || qr.startsWith("/9j/") || qr.startsWith("base64,")) {
    return `data:image/png;base64,${qr.replace(/^base64,/, "")}`;
  }
  return String(await qrcode(qr));
};

// Gera um nome de instância único e estável por tenant.
// IMPORTANTE: cada tenant DEVE ter sua própria instância na Evolution para que
// um tenant não use o número de WhatsApp de outro. Não compartilhar instâncias.
const instanceName = (base: string, tenantId: string) => {
  const clean = (base || "hub").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24) || "hub";
  // Estável por tenant (não muda a cada chamada) — evita criar instâncias duplicadas.
  return `${clean}_t_${tenantId.replace(/-/g, "").slice(0, 16)}`;
};

// Detecta se o nome ainda é o padrão compartilhado (ex.: "tellcontab" puro vindo da env var).
const isSharedDefaultName = (name: string, defaultName: string) => {
  if (!name) return true;
  const n = name.trim().toLowerCase();
  const d = (defaultName || "").trim().toLowerCase();
  return !!d && n === d;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    let ENV_EVO_URL = (Deno.env.get("EVOLUTION_API_URL") || "").trim().replace(/\/+$/, "");
    if (ENV_EVO_URL && !/^https?:\/\//i.test(ENV_EVO_URL)) ENV_EVO_URL = `https://${ENV_EVO_URL}`;
    const ENV_EVO_KEY = Deno.env.get("EVOLUTION_API_KEY") || "";
    const DEFAULT_INSTANCE = Deno.env.get("EVOLUTION_INSTANCE_NAME") || "tellcontab";
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth: require user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supaUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await supaUser.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userErr || !userRes?.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = (url.searchParams.get("action") || body.action || "status") as string;
    const tenantId = (url.searchParams.get("tenant_id") || body.tenant_id) as string;
    if (!tenantId) return json({ error: "tenant_id required" }, 400);

    // Verify membership
    const { data: member } = await supabase
      .from("tenant_members")
      .select("role")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!member) return json({ error: "Forbidden" }, 403);

    // Fetch / create config
    let { data: cfg } = await supabase
      .from("wa_provider_config")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!cfg) {
      const { data: created, error: cErr } = await supabase
        .from("wa_provider_config")
        .insert({
          tenant_id: tenantId,
          provider: "evolution",
          status: "disconnected",
          status_message: "Aguardando conexão",
          display_name: "WhatsApp",
          // Nome único por tenant — nunca compartilhar a instância padrão entre tenants.
          evolution_instance_name: instanceName(DEFAULT_INSTANCE, tenantId),
        })
        .select("*")
        .maybeSingle();
      if (cErr) return json({ error: cErr.message }, 500);
      cfg = created;
    }

    let instance = cfg.evolution_instance_name || "";
    // Se a config legada tem o nome padrão compartilhado (ex.: "tellcontab"),
    // migramos para um nome único por tenant ANTES de qualquer chamada à Evolution.
    if (!instance || isSharedDefaultName(instance, DEFAULT_INSTANCE)) {
      instance = instanceName(DEFAULT_INSTANCE, tenantId);
      await supabase.from("wa_provider_config")
        .update({ evolution_instance_name: instance })
        .eq("tenant_id", tenantId);
      cfg.evolution_instance_name = instance;
    }
    const webhookUrl = `${SUPABASE_URL}/functions/v1/wa-webhook/${tenantId}?secret=${cfg.webhook_secret}`;

    // Tenant-first: usa credenciais do próprio cliente; cai para env global se vazio.
    let EVO_URL = (ENV_EVO_URL || "").trim().replace(/\/+$/, "");
    if (EVO_URL && !/^https?:\/\//i.test(EVO_URL)) EVO_URL = `https://${EVO_URL}`;
    const EVO_KEY = ENV_EVO_KEY || "";
    if (!EVO_URL || !EVO_KEY) {
      return json({ error: "Evolution API não configurada para este cliente. Preencha URL e API Key em Configurações > WhatsApp." }, 400);
    }

    const evoFetch = async (path: string, init: RequestInit = {}) => {
      const r = await fetch(`${EVO_URL}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          apikey: EVO_KEY,
          ...(init.headers || {}),
        },
      });
      const text = await r.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
      return { ok: r.ok, status: r.status, data };
    };

    const setWebhook = (name = instance) => evoFetch(`/webhook/set/${name}`, {
      method: "POST",
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: webhookUrl,
          byEvents: false,
          base64: true,
          events: EVOLUTION_EVENTS,
        },
      }),
    });

    const createInstance = (name: string, opts: { pairingPhone?: string } = {}) => evoFetch("/instance/create", {
      method: "POST",
      body: JSON.stringify({
        instanceName: name,
        qrcode: true,
        pairingCode: !!opts.pairingPhone,
        ...(opts.pairingPhone ? { number: opts.pairingPhone } : {}),
        integration: "WHATSAPP-BAILEYS",
        webhookUrl,
        webhookByEvents: false,
        webhookBase64: true,
        webhookEvents: EVOLUTION_EVENTS,
        rejectCall: false,
        groupsIgnore: true,
        alwaysOnline: false,
        readMessages: false,
        readStatus: false,
        syncFullHistory: true,
      }),
    });

    const connectInstance = (name: string, pairingPhone?: string) =>
      evoFetch(`/instance/connect/${name}${pairingPhone ? `?number=${encodeURIComponent(pairingPhone)}` : ""}`, { method: "GET" });

    const waitForStoredQr = async () => {
      for (let i = 0; i < 8; i++) {
        await sleep(1200);
        const { data: fresh } = await supabase
          .from("wa_provider_config")
          .select("qr_code,status,status_message")
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (fresh?.qr_code) return fresh;
      }
      return null;
    };

    // ---- Actions ----
    if (action === "connect") {
      // Modo: 'qr' (default) ou 'pairing' (código de 8 dígitos vinculado a um número)
      const connectMode: "qr" | "pairing" = body.mode === "pairing" ? "pairing" : "qr";
      const pairingPhoneRaw = String(body.phone || body.pairing_phone || "").replace(/\D/g, "");
      if (connectMode === "pairing" && pairingPhoneRaw.length < 10) {
        return json({ ok: false, error: "Informe o número completo com DDI e DDD (ex.: 5511999999999) para gerar o código de pareamento." }, 400);
      }
      const pairingPhone = connectMode === "pairing" ? pairingPhoneRaw : undefined;
      // Check if instance already exists; if so, check state. If not connected, delete to force fresh QR.
      const existing = await evoFetch(`/instance/connectionState/${instance}`, { method: "GET" });
      const existingState: string = existing.data?.instance?.state || existing.data?.state || "";
      console.log("[wa-evolution] existing state:", existingState);

      if (existing.ok && existingState === "open") {
        await supabase.from("wa_provider_config").update({
          status: "connected",
          status_message: "WhatsApp já conectado",
          qr_code: "",
          last_connected_at: new Date().toISOString(),
          last_event_at: new Date().toISOString(),
        }).eq("tenant_id", tenantId);
        return json({ ok: true, alreadyConnected: true, instance });
      }

      // If instance exists but not connected, delete it so we can create fresh and get a new QR
      if (existing.ok && existingState) {
        const delRes = await evoFetch(`/instance/delete/${instance}`, { method: "DELETE" });
        console.log("[wa-evolution] deleted existing instance status:", delRes.status);
      }

      // Try to create instance with webhook + QR (and pairing if requested) enabled in the same call.
      let createRes = await createInstance(instance, { pairingPhone });
      console.log("[wa-evolution] create status:", createRes.status, "mode:", connectMode, "data:", JSON.stringify(createRes.data).slice(0, 500));

      // If still "already exists" (delete failed silently), use a unique name
      if (!createRes.ok && (createRes.status === 403 || createRes.status === 409 || isAlreadyExists(createRes.data))) {
        instance = instanceName(DEFAULT_INSTANCE, tenantId);
        createRes = await createInstance(instance, { pairingPhone });
        console.log("[wa-evolution] recreate with unique name status:", createRes.status, "instance:", instance, "data:", JSON.stringify(createRes.data).slice(0, 500));
      }

      if (!createRes.ok && createRes.status !== 403 && createRes.status !== 409 && !isAlreadyExists(createRes.data)) {
        await supabase.from("wa_provider_config").update({
          status: "disconnected",
          status_message: "A Evolution API não conseguiu criar a instância",
          qr_code: "",
          last_event_at: new Date().toISOString(),
        }).eq("tenant_id", tenantId);
        return json({ ok: false, error: "A Evolution API não conseguiu criar a instância", details: createRes.data });
      }

      // Ensure webhook configured (best-effort, several Evolution variants)
      const whRes = await setWebhook();
      console.log("[wa-evolution] webhook/set status:", whRes.status);

      // Trigger connect. If pairing mode, pass number to force pairing-code flow.
      let connRes = await connectInstance(instance, pairingPhone);
      console.log("[wa-evolution] connect status:", connRes.status, "data keys:", connRes.data ? Object.keys(connRes.data) : null, "preview:", JSON.stringify(connRes.data).slice(0, 800));

      let qrBase64: string = connectMode === "pairing" ? "" : (extractQr(connRes.data) || extractQr(createRes.data));
      let pairingCode: string =
        connRes.data?.pairingCode ||
        connRes.data?.qrcode?.pairingCode ||
        connRes.data?.code ||
        createRes.data?.pairingCode ||
        createRes.data?.qrcode?.pairingCode ||
        "";

      // Pairing mode: try a few times to get the code if not returned immediately.
      if (connectMode === "pairing") {
        for (let i = 0; !pairingCode && i < 4; i++) {
          await sleep(1200);
          connRes = await connectInstance(instance, pairingPhone);
          pairingCode =
            connRes.data?.pairingCode ||
            connRes.data?.qrcode?.pairingCode ||
            connRes.data?.code || "";
          console.log("[wa-evolution] pairing retry", i + 1, "status:", connRes.status, "code?", !!pairingCode);
        }
      } else {
        // QR mode: retry to fetch QR
        for (let i = 0; !qrBase64 && i < 3; i++) {
          await sleep(1200);
          connRes = await connectInstance(instance);
          console.log("[wa-evolution] connect retry", i + 1, "status:", connRes.status, "preview:", JSON.stringify(connRes.data).slice(0, 800));
          qrBase64 = extractQr(connRes.data);
        }

        if (!qrBase64) {
          const qrAlt = await evoFetch(`/instance/qrcode/${instance}`, { method: "GET" });
          console.log("[wa-evolution] qrcode endpoint status:", qrAlt.status, "preview:", JSON.stringify(qrAlt.data).slice(0, 500));
          qrBase64 = extractQr(qrAlt.data);
        }

        if (!qrBase64) {
          const storedQr = await waitForStoredQr();
          qrBase64 = storedQr?.qr_code || "";
        }

        // Normalize: ensure it has data:image/png prefix
        qrBase64 = await normalizeQr(qrBase64);
      }

      console.log("[wa-evolution] final qr length:", qrBase64.length, "pairingCode:", pairingCode);

      if (!qrBase64 && !pairingCode) {
        const errMsg = connectMode === "pairing"
          ? "Não foi possível gerar o código de pareamento. Verifique se a versão da Evolution API suporta pairingCode (v2.x) e se o número está correto com DDI."
          : "QR não retornou: a Evolution API criou a instância, mas não gerou o QR. Troque a imagem Docker para evoapicloud/evolution-api:v2.3.7 ou v2.3.6.";
        await supabase.from("wa_provider_config").update({
          provider: "evolution",
          evolution_instance_name: instance,
          qr_code: "",
          status: "error",
          status_message: errMsg,
          last_event_at: new Date().toISOString(),
        }).eq("tenant_id", tenantId);
        return json({ ok: false, error: errMsg, hint: QR_TROUBLESHOOTING, details: { create: createRes.data, connect: connRes.data } });
      }

      const statusMsg = pairingCode && connectMode === "pairing"
        ? `Use o código ${pairingCode} no WhatsApp em "Aparelhos conectados → Conectar com número de telefone"`
        : qrBase64 ? "Escaneie o QR Code com seu WhatsApp" : "Conectando...";

      await supabase.from("wa_provider_config").update({
        provider: "evolution",
        evolution_instance_name: instance,
        qr_code: qrBase64,
        last_qr_at: new Date().toISOString(),
        status: (qrBase64 || pairingCode) ? "qr_required" : "connecting",
        status_message: statusMsg,
      }).eq("tenant_id", tenantId);

      return json({ ok: true, qr: qrBase64, pairingCode, mode: connectMode, instance });
    }

    if (action === "status") {
      const r = await evoFetch(`/instance/connectionState/${instance}`, { method: "GET" });
      const state: string = r.data?.instance?.state || r.data?.state || "close";
      // open | connecting | close
      const map: Record<string, string> = { open: "connected", connecting: "connecting", close: "disconnected" };
      const newStatus = map[state] || "disconnected";

      const upd: any = {
        status: cfg.status === "error" && newStatus === "connecting" && !cfg.qr_code ? "error" : newStatus,
        status_message:
          cfg.status === "error" && newStatus === "connecting" && !cfg.qr_code ? cfg.status_message :
          newStatus === "connected" ? "WhatsApp conectado" :
          newStatus === "connecting" ? "Conectando..." :
          "Desconectado",
        last_event_at: new Date().toISOString(),
      };
      if (newStatus === "connected") {
        upd.last_connected_at = new Date().toISOString();
        upd.qr_code = "";
      }
      await supabase.from("wa_provider_config").update(upd).eq("tenant_id", tenantId);
      return json({ ok: true, state, status: newStatus });
    }

    if (action === "disconnect" || action === "logout") {
      await evoFetch(`/instance/logout/${instance}`, { method: "DELETE" });
      await supabase.from("wa_provider_config").update({
        status: "disconnected",
        status_message: "Desconectado pelo usuário",
        qr_code: "",
      }).eq("tenant_id", tenantId);
      return json({ ok: true });
    }

    if (action === "restart") {
      await evoFetch(`/instance/restart/${instance}`, { method: "POST" });
      await supabase.from("wa_provider_config").update({
        status: "connecting",
        status_message: "Reiniciando instância...",
      }).eq("tenant_id", tenantId);
      return json({ ok: true });
    }

    if (action === "subscribe_presence") {
      const phone = String(body.phone || "").replace(/\D/g, "");
      if (!phone) return json({ error: "phone required" }, 400);
      const number = phone.includes("@") ? phone : `${phone}`;
      // Best-effort: tries common Evolution endpoints (varies by version)
      const tries = [
        { path: `/chat/presenceSubscribe/${instance}`, body: { number } },
        { path: `/chat/presence/${instance}`, body: { number, presence: "available" } },
      ];
      for (const t of tries) {
        try { await evoFetch(t.path, { method: "POST", body: JSON.stringify(t.body) }); } catch { /* ignore */ }
      }
      return json({ ok: true });
    }

    if (action === "send") {
      const phone = String(body.phone || "").replace(/\D/g, "");
      const text = String(body.text || "");
      if (!phone || !text) return json({ error: "phone and text required" }, 400);

      const number = phone.includes("@") ? phone : `${phone}`;
      const r = await evoFetch(`/message/sendText/${instance}`, {
        method: "POST",
        body: JSON.stringify({
          number,
          text,
          options: { delay: 0, presence: "composing" },
        }),
      });
      if (!r.ok) return json({ error: "Evolution send failed", details: r.data }, 502);
      return json({ ok: true, externalId: r.data?.key?.id || null });
    }

    if (action === "send_media") {
      const phone = String(body.phone || "").replace(/\D/g, "");
      const mediaUrl = String(body.media_url || "");
      const mediaType = String(body.media_type || "audio"); // audio | image | video | document
      const fileName = String(body.file_name || "");
      const caption = String(body.caption || "");
      if (!phone || !mediaUrl) return json({ error: "phone and media_url required" }, 400);

      const number = phone;

      // PTT/voice audio uses dedicated endpoint on Evolution
      if (mediaType === "audio") {
        let r = await evoFetch(`/message/sendWhatsAppAudio/${instance}`, {
          method: "POST",
          body: JSON.stringify({
            number,
            audio: mediaUrl,
            encoding: true,
            options: { delay: 0, presence: "recording" },
          }),
        });
        // Fallback to generic sendMedia if PTT endpoint not available
        if (!r.ok) {
          r = await evoFetch(`/message/sendMedia/${instance}`, {
            method: "POST",
            body: JSON.stringify({
              number,
              mediatype: "audio",
              media: mediaUrl,
              fileName: fileName || "audio.ogg",
              mimetype: "audio/ogg; codecs=opus",
            }),
          });
        }
        if (!r.ok) return json({ error: "Evolution audio send failed", details: r.data }, 502);
        return json({ ok: true, externalId: r.data?.key?.id || null });
      }

      // image | video | document via generic sendMedia
      const payload: Record<string, unknown> = {
        number,
        mediatype: mediaType,
        media: mediaUrl,
        fileName: fileName || `arquivo.${mediaType === 'image' ? 'jpg' : mediaType === 'video' ? 'mp4' : 'bin'}`,
      };
      if (caption) payload.caption = caption;
      const r = await evoFetch(`/message/sendMedia/${instance}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!r.ok) return json({ error: "Evolution media send failed", details: r.data }, 502);
      return json({ ok: true, externalId: r.data?.key?.id || null });
    }

    // Sync contacts: aggressively pulls EVERYTHING the Evolution API has —
    // saved address book (your 500 WhatsApp Business contacts) AND every chat
    // ever opened. Tries every known Evolution variant (v1/v2/v2.x), uses every
    // endpoint shape and payload combo, then merges all responses (not just the
    // first one that worked). This guarantees that even if one endpoint only
    // returns chat partners and another only returns the address book, the
    // user gets the full union.
    // "force_reload_contacts": before syncing, ask Evolution to refresh the
    // Baileys cache (restart + small wait + try refresh endpoints). Then run
    // sync_contacts up to N passes — each pass merges into the DB so even if
    // WhatsApp delivers contacts in chunks (which is common after first
    // connection or after a long offline period), we capture them all.
    if (action === "force_reload_contacts") {
      const passes = Math.max(1, Math.min(5, Number(body.passes) || 3));
      const waitMs = Math.max(500, Math.min(8000, Number(body.wait_ms) || 2500));

      // 1) Try every known "refresh contacts" endpoint (best-effort)
      const refreshEndpoints = [
        { url: `/chat/refreshContacts/${instance}`, method: "POST", body: JSON.stringify({}) },
        { url: `/chat/refreshContacts/${instance}`, method: "GET" },
        { url: `/chat/syncContacts/${instance}`, method: "POST", body: JSON.stringify({}) },
        { url: `/instance/refreshContacts/${instance}`, method: "POST", body: JSON.stringify({}) },
      ];
      for (const ep of refreshEndpoints) {
        try {
          const r = await evoFetch(ep.url, { method: ep.method as any, body: ep.body });
          console.log("[wa-evolution][force_reload]", ep.url, "status:", r.status);
        } catch (e) {
          console.log("[wa-evolution][force_reload] err", ep.url, String(e));
        }
      }

      // 2) Run multiple sync passes by recursively calling the same function
      const passResults: any[] = [];
      let totalInserted = 0;
      let totalUpdated = 0;
      for (let p = 0; p < passes; p++) {
        if (p > 0) await sleep(waitMs);
        const innerReq = new Request(req.url, {
          method: "POST",
          headers: req.headers,
          body: JSON.stringify({ action: "sync_contacts", tenant_id: tenantId }),
        });
        // Inline call: replicate sync_contacts via fetch to ourselves would
        // require auth; instead we set a flag and fall through. Simpler: just
        // re-invoke the handler logic by setting action and using a goto-like
        // pattern. Easiest: extract sync into a function — but to keep diff
        // minimal we POST to our own URL with the same auth header.
        try {
          const selfRes = await fetch(req.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: authHeader,
            },
            body: JSON.stringify({ action: "sync_contacts", tenant_id: tenantId }),
          });
          const selfData = await selfRes.json().catch(() => ({}));
          passResults.push(selfData);
          totalInserted += Number(selfData?.inserted || 0);
          totalUpdated += Number(selfData?.updated || 0);
          console.log("[wa-evolution][force_reload] pass", p + 1, "inserted:", selfData?.inserted, "updated:", selfData?.updated, "unique:", selfData?.unique);
        } catch (e) {
          console.error("[wa-evolution][force_reload] pass error:", String(e));
          passResults.push({ ok: false, error: String(e) });
        }
      }

      const last = passResults[passResults.length - 1] || {};
      return json({
        ok: true,
        passes: passResults.length,
        totalInserted,
        totalUpdated,
        lastPass: last,
      });
    }

    if (action === "sync_contacts") {
      const tryParse = (data: any): any[] => {
        if (Array.isArray(data)) return data;
        if (Array.isArray(data?.contacts)) return data.contacts;
        if (Array.isArray(data?.chats)) return data.chats;
        if (Array.isArray(data?.data)) return data.data;
        if (Array.isArray(data?.response)) return data.response;
        if (Array.isArray(data?.result)) return data.result;
        if (Array.isArray(data?.records)) return data.records;
        if (Array.isArray(data?.items)) return data.items;
        if (data && typeof data === "object") {
          // Sometimes Evolution returns { "<jid>": {...}, "<jid2>": {...} }
          const values = Object.values(data);
          if (values.length && values.every((v) => v && typeof v === "object" && !Array.isArray(v))) {
            return values as any[];
          }
        }
        return [];
      };

      // Hit ALL endpoints (don't stop at first success) and merge results.
      const fetchAllEndpoints = async (
        endpoints: Array<{ url: string; method: string; body?: string }>,
        label: string,
      ) => {
        const all: any[] = [];
        let lastResp: any = null;
        let lastStatus = 0;
        let okCount = 0;
        for (const ep of endpoints) {
          try {
            const r = await evoFetch(ep.url, { method: ep.method as any, body: ep.body });
            lastResp = r.data;
            lastStatus = r.status;
            const parsed = tryParse(r.data);
            console.log(`[wa-evolution][sync_contacts][${label}]`, ep.method, ep.url, "status:", r.status, "items:", parsed.length);
            if (parsed.length) {
              all.push(...parsed);
              okCount++;
            }
          } catch (err) {
            console.log(`[wa-evolution][sync_contacts][${label}] error on ${ep.url}:`, String(err));
          }
        }
        return { list: all, lastResp, lastStatus, okCount };
      };

      const pagedBodies = (where: Record<string, unknown> = {}) => {
        const bodies: string[] = [];
        for (let offset = 0; offset < 1000; offset += 100) {
          bodies.push(JSON.stringify({ where, limit: 100, offset, sort: { field: "pushName", order: "asc" } }));
          bodies.push(JSON.stringify({ where, take: 100, skip: offset, orderBy: { pushName: "asc" } }));
        }
        return bodies;
      };

      // 1) Saved address book — try every known variant
      const contactsRes = await fetchAllEndpoints([
        ...pagedBodies().map((body) => ({ url: `/chat/findContacts/${instance}`, method: "POST", body })),
        { url: `/chat/findContacts/${instance}`, method: "POST", body: JSON.stringify({ where: {} }) },
        { url: `/chat/findContacts/${instance}`, method: "POST", body: JSON.stringify({}) },
        { url: `/chat/findContacts/${instance}`, method: "GET" },
        { url: `/chat/fetchContacts/${instance}`, method: "POST", body: JSON.stringify({}) },
        { url: `/chat/fetchContacts/${instance}`, method: "GET" },
        { url: `/chat/whatsappContacts/${instance}`, method: "GET" },
        { url: `/chat/whatsappContacts/${instance}`, method: "POST", body: JSON.stringify({}) },
        { url: `/contacts/${instance}`, method: "GET" },
      ], "agenda");

      // 2) Active chats — every variant
      const chatsRes = await fetchAllEndpoints([
        ...pagedBodies().map((body) => ({ url: `/chat/findChats/${instance}`, method: "POST", body })),
        { url: `/chat/findChats/${instance}`, method: "POST", body: JSON.stringify({}) },
        { url: `/chat/findChats/${instance}`, method: "POST", body: JSON.stringify({ where: {} }) },
        { url: `/chat/findChats/${instance}`, method: "GET" },
        { url: `/chat/fetchChats/${instance}`, method: "GET" },
        { url: `/chat/fetchChats/${instance}`, method: "POST", body: JSON.stringify({}) },
        { url: `/chats/${instance}`, method: "GET" },
      ], "chats");

      const combined: Array<{ raw: any; source: "agenda" | "chat" }> = [
        ...contactsRes.list.map((raw) => ({ raw, source: "agenda" as const })),
        ...chatsRes.list.map((raw) => ({ raw, source: "chat" as const })),
      ];

      if (!combined.length) {
        return json({
          ok: false,
          error: `Não foi possível ler agenda nem conversas (status ${contactsRes.lastStatus || chatsRes.lastStatus}). Verifique se a instância está conectada.`,
          details: contactsRes.lastResp || chatsRes.lastResp,
        }, 200);
      }

      // DEBUG: log a few samples to understand the shape Evolution returns
      console.log(
        "[wa-evolution][sync_contacts][samples]",
        JSON.stringify(combined.slice(0, 5).map((it) => ({ source: it.source, raw: it.raw }))),
      );

      // Deduplicate by phone — agenda entries take precedence (better names).
      const byPhone = new Map<string, { name: string; avatar: string; source: "agenda" | "chat" }>();
      const skipReasons: Record<string, number> = {};
      let skipped = 0;
      const skipBecause = (reason: string) => {
        skipped++;
        skipReasons[reason] = (skipReasons[reason] || 0) + 1;
      };
      for (const item of combined) {
        const c = item.raw;
        // Try every plausible field that may carry the JID/phone identifier
        const remoteJid: string =
          c.id ||
          c.remoteJid ||
          c.remote_jid ||
          c.jid ||
          c.owner ||
          c.key?.remoteJid ||
          c.user ||
          c.number ||
          c.phone ||
          c.wuid ||
          c.contactId ||
          "";
        if (!remoteJid) { skipBecause("no_jid"); continue; }
        if (remoteJid.endsWith("@g.us")) { skipBecause("group"); continue; }
        if (remoteJid.endsWith("@broadcast")) { skipBecause("broadcast"); continue; }
        if (remoteJid.includes("status@")) { skipBecause("status"); continue; }
        if (remoteJid.includes("@newsletter")) { skipBecause("newsletter"); continue; }
        // @lid = privacy hash (contact hides their real number). Only keep if it has a usable name.
        const isLid = remoteJid.endsWith("@lid");
        const name = (c.pushName || c.name || c.verifiedName || c.notify || c.profileName || "").trim();
        if (isLid && !name) { skipBecause("lid_without_name"); continue; }
        const phone = String(remoteJid).split("@")[0].replace(/\D/g, "");
        if (!phone) { skipBecause("empty_phone"); continue; }
        if (phone.length < 8 || phone.length > 18) { skipBecause(`bad_length_${phone.length}`); continue; }
        const avatar = c.profilePicUrl || c.profilePictureUrl || c.profilePicture || "";

        const existing = byPhone.get(phone);
        if (!existing) {
          byPhone.set(phone, { name, avatar, source: item.source });
        } else {
          // Prefer agenda over chat; prefer non-empty name/avatar
          if (item.source === "agenda" && existing.source === "chat") {
            byPhone.set(phone, {
              name: name || existing.name,
              avatar: avatar || existing.avatar,
              source: "agenda",
            });
          } else {
            if (!existing.name && name) existing.name = name;
            if (!existing.avatar && avatar) existing.avatar = avatar;
          }
        }
      }

      // Batch fetch existing contacts (1 query instead of N)
      const phones = Array.from(byPhone.keys());
      let inserted = 0;
      let updated = 0;
      const CHUNK = 200;
      for (let i = 0; i < phones.length; i += CHUNK) {
        const chunk = phones.slice(i, i + CHUNK);
        const { data: existingRows } = await supabase
          .from("wa_contacts")
          .select("id,phone,name,avatar_url")
          .eq("tenant_id", tenantId)
          .in("phone", chunk);
        const existingMap = new Map<string, any>((existingRows || []).map((r: any) => [r.phone, r]));

        const toInsert: any[] = [];
        const toUpdate: Array<{ id: string; patch: any }> = [];
        for (const phone of chunk) {
          const entry = byPhone.get(phone)!;
          const finalName = entry.name || phone;
          const ex = existingMap.get(phone);
          if (ex) {
            const patch: any = {};
            if (entry.name && ex.name !== entry.name) patch.name = entry.name;
            if (entry.avatar && !ex.avatar_url) patch.avatar_url = entry.avatar;
            if (Object.keys(patch).length) toUpdate.push({ id: ex.id, patch });
          } else {
            toInsert.push({
              tenant_id: tenantId,
              phone,
              name: finalName,
              avatar_url: entry.avatar,
            });
          }
        }

        if (toInsert.length) {
          const { error: insErr } = await supabase.from("wa_contacts").insert(toInsert);
          if (insErr) {
            console.error("[wa-evolution][sync_contacts] bulk insert error:", insErr.message);
          } else {
            inserted += toInsert.length;
          }
        }
        // Updates still need to be per-row (different patch per id)
        for (const u of toUpdate) {
          const { error: uErr } = await supabase.from("wa_contacts").update(u.patch).eq("id", u.id);
          if (!uErr) updated++;
        }
      }

      return json({
        ok: true,
        synced: inserted + updated,
        inserted,
        updated,
        skipped,
        skipReasons,
        total: combined.length,
        unique: byPhone.size,
        sources: {
          agenda: contactsRes.list.length,
          chats: chatsRes.list.length,
          agenda_endpoints_ok: contactsRes.okCount,
          chats_endpoints_ok: chatsRes.okCount,
        },
      });
    }

    // Remove contacts that have no messages and no conversations (orphans / phone-book noise).
    if (action === "cleanup_orphans") {
      // Find contacts with at least one message OR conversation
      const { data: usedContacts } = await supabase
        .from("wa_messages").select("contact_id").eq("tenant_id", tenantId);
      const { data: convContacts } = await supabase
        .from("wa_conversations").select("contact_id").eq("tenant_id", tenantId);
      const used = new Set<string>([
        ...(usedContacts || []).map((r: any) => r.contact_id).filter(Boolean),
        ...(convContacts || []).map((r: any) => r.contact_id).filter(Boolean),
      ]);
      const { data: allContacts } = await supabase
        .from("wa_contacts").select("id").eq("tenant_id", tenantId);
      const orphans = (allContacts || []).filter((c: any) => !used.has(c.id)).map((c: any) => c.id);
      if (orphans.length === 0) return json({ ok: true, removed: 0 });
      const { error } = await supabase.from("wa_contacts").delete().in("id", orphans);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, removed: orphans.length });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("[wa-evolution] error", e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
