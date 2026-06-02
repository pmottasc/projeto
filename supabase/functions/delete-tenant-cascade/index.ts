// Delete a tenant and ALL its data. Requires:
// 1. The caller is a platform admin
// 2. The caller re-confirms their own password (re-authentication)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Order matters: child tables first, then parents.
const TABLES_IN_ORDER = [
  'wa_webhook_events',
  'wa_messages',
  'wa_conversations',
  'wa_contact_cnpjs',
  'wa_contacts',
  'wa_provider_config',
  'document_delivery_log',
  'chatbot_sessions',
  'chatbot_agent_memory',
  'chatbot_edges',
  'chatbot_nodes',
  'chatbot_flows',
  'chat_messages',
  'chat_participants',
  'chat_presence',
  'chat_conversations',
  'ticket_attachments',
  'ticket_comments',
  'ticket_history',
  'tickets',
  'ticket_categories',
  'ticket_types',
  'sla_policies',
  'kb_article_steps',
  'kb_articles',
  'kb_categories',
  'passwords_vault',
  'ramais',
  'work_links',
  'conversion_history',
  'processed_emails',
  'notifications',
  'audit_logs',
  'profile_departments',
  'departments',
  'accounting_api_config',
  'tenant_invoices',
  'tenant_billing',
  'tenant_usage_counters',
  'tenant_features',
  'subscriptions',
  'invitations',
  'tenant_members',
  'tenants',
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get caller from JWT
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Não autenticado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Verify platform admin
    const { data: padmin } = await admin.from('platform_admins').select('id').eq('user_id', user.id).maybeSingle();
    if (!padmin) {
      return new Response(JSON.stringify({ error: 'Apenas SuperAdmin pode excluir tenants' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { tenant_id, password, confirm_slug } = await req.json();
    if (!tenant_id || !password) {
      return new Response(JSON.stringify({ error: 'tenant_id e password obrigatórios' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Re-authenticate the SuperAdmin with their password
    const reauthClient = createClient(SUPABASE_URL, ANON_KEY);
    const { error: signErr } = await reauthClient.auth.signInWithPassword({
      email: user.email!, password,
    });
    if (signErr) {
      return new Response(JSON.stringify({ error: 'Senha incorreta' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load tenant for safety check
    const { data: tenant, error: tErr } = await admin.from('tenants').select('id, slug, name').eq('id', tenant_id).maybeSingle();
    if (tErr || !tenant) {
      return new Response(JSON.stringify({ error: 'Tenant não encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (confirm_slug && confirm_slug !== tenant.slug) {
      return new Response(JSON.stringify({ error: 'Confirmação do slug não confere' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Collect storage paths to delete BEFORE wiping rows
    const storageDeletes: { bucket: string; paths: string[] }[] = [];
    const { data: tas } = await admin.from('ticket_attachments').select('file_path').eq('tenant_id', tenant_id);
    if (tas?.length) storageDeletes.push({ bucket: 'ticket-attachments', paths: tas.map(t => t.file_path).filter(Boolean) });

    const { data: cms } = await admin.from('chat_messages').select('attachment_path').eq('tenant_id', tenant_id);
    if (cms?.length) {
      const paths = cms.map(c => c.attachment_path).filter(Boolean) as string[];
      if (paths.length) storageDeletes.push({ bucket: 'chat-attachments', paths });
    }

    const errors: string[] = [];
    const counts: Record<string, number> = {};

    // Delete rows tenant by tenant in order
    for (const table of TABLES_IN_ORDER) {
      const filterCol = table === 'tenants' ? 'id' : 'tenant_id';
      const { error, count } = await admin
        .from(table)
        .delete({ count: 'exact' })
        .eq(filterCol, tenant_id);
      if (error) {
        errors.push(`${table}: ${error.message}`);
      } else if (count && count > 0) {
        counts[table] = count;
      }
    }

    // Delete storage objects (best effort)
    for (const { bucket, paths } of storageDeletes) {
      if (!paths.length) continue;
      const { error } = await admin.storage.from(bucket).remove(paths);
      if (error) errors.push(`storage/${bucket}: ${error.message}`);
    }

    if (errors.length) {
      return new Response(JSON.stringify({
        ok: false, errors, counts, tenant: tenant.slug,
      }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      ok: true, tenant: tenant.slug, deleted: counts,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
