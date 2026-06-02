// Cron-driven processor for scheduled messages.
// Picks pending messages whose scheduled_at <= now(), marks them as processing,
// sends via the appropriate channel, and updates status with a log entry.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supaUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });

  // Atomically pick a small batch of due messages and mark them as processing.
  // Postgres-side: use a CTE with FOR UPDATE SKIP LOCKED via RPC fallback to two-step.
  const { data: dueRows, error: dueErr } = await admin
    .from('scheduled_messages')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(20);

  if (dueErr) {
    return new Response(JSON.stringify({ error: dueErr.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const results: any[] = [];
  for (const m of dueRows || []) {
    // Conditional update to claim the row (idempotency)
    const { data: claimed, error: claimErr } = await admin
      .from('scheduled_messages')
      .update({ status: 'processing', attempts: (m.attempts || 0) + 1 })
      .eq('id', m.id).eq('status', 'pending')
      .select('id').maybeSingle();
    if (claimErr || !claimed) continue;

    let ok = false;
    let errorMessage = '';
    let providerId = '';
    try {
      if (m.channel === 'whatsapp') {
        if (!m.contact_phone) throw new Error('Telefone obrigatório.');
        const evoUrl = (Deno.env.get('EVOLUTION_API_URL') || '').replace(/\/+$/, '');
        const evoKey = Deno.env.get('EVOLUTION_API_KEY');
        if (!evoUrl || !evoKey) throw new Error('Evolution API não configurada.');

        // Resolve per-tenant instance name from wa_provider_config
        const { data: cfg } = await admin
          .from('wa_provider_config')
          .select('evolution_instance_name, status')
          .eq('tenant_id', m.tenant_id)
          .maybeSingle();
        const instance = cfg?.evolution_instance_name;
        if (!instance) throw new Error('WhatsApp não configurado para este tenant.');

        // Substitute variables — datas/horas em horário de Brasília (America/Sao_Paulo).
        const tz = 'America/Sao_Paulo';
        const now = new Date();
        const dateBR = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(now);
        const timeBR = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
        const subs: Record<string, string> = {
          nome_contato: m.contact_name || '',
          telefone_contato: m.contact_phone || '',
          email_contato: '',
          data_atual: dateBR,
          hora_atual: timeBR,
        };
        const finalText = String(m.content || '').replace(/\{([a-z_]+)\}/gi, (full, raw) => {
          const k = String(raw).toLowerCase();
          const v = subs[k];
          return v != null && v !== '' ? v : full;
        });

        if (finalText.trim()) {
          const res = await fetch(`${evoUrl}/message/sendText/${instance}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: evoKey },
            body: JSON.stringify({ number: m.contact_phone, text: finalText }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(`Evolution: ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
          providerId = json?.key?.id || '';
        }
        // Send attachments (if any) — each via the matching Evolution endpoint.
        const atts: any[] = Array.isArray(m.attachments) ? m.attachments : [];
        for (const a of atts) {
          if (!a?.url) continue;
          const isPtt = a.kind === 'ptt' || (a.kind === 'audio' && /\.(ogg|opus)$/i.test(a.url));
          let endpoint = `${evoUrl}/message/sendMedia/${instance}`;
          let body: any;
          if (isPtt) {
            endpoint = `${evoUrl}/message/sendWhatsAppAudio/${instance}`;
            body = { number: m.contact_phone, audio: a.url };
          } else {
            const mediatype = a.kind === 'image' ? 'image' : a.kind === 'video' ? 'video' : a.kind === 'audio' ? 'audio' : 'document';
            body = {
              number: m.contact_phone,
              mediatype,
              media: a.url,
              fileName: a.name || 'arquivo',
              ...(atts.length === 1 && !m.content ? {} : {}),
            };
          }
          const ar = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: evoKey },
            body: JSON.stringify(body),
          });
          if (!ar.ok) {
            const j = await ar.json().catch(() => ({}));
            throw new Error(`Anexo "${a.name || a.url}": ${ar.status} ${JSON.stringify(j).slice(0, 200)}`);
          }
        }
        ok = true;
      } else {
        throw new Error(`Canal ${m.channel} ainda não configurado.`);
      }
    } catch (e: any) {
      errorMessage = e?.message || String(e);
    }

    if (ok) {
      await admin.from('scheduled_messages').update({
        status: 'sent', sent_at: new Date().toISOString(), error_message: '',
      }).eq('id', m.id);
    } else {
      await admin.from('scheduled_messages').update({
        status: 'failed', failed_at: new Date().toISOString(), error_message: errorMessage,
      }).eq('id', m.id);
    }

    await admin.from('message_logs').insert({
      tenant_id: m.tenant_id,
      template_id: m.template_id,
      scheduled_message_id: m.id,
      contact_phone: m.contact_phone,
      contact_name: m.contact_name,
      ticket_id: m.ticket_id,
      channel: m.channel,
      content: m.content,
      status: ok ? 'sent' : 'failed',
      provider_message_id: providerId,
      error_message: errorMessage,
      sent_by: m.created_by,
    });

    results.push({ id: m.id, ok, error: errorMessage });
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
