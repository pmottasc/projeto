import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Validate caller is platform admin
    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: 'Não autenticado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: pa } = await admin.from('platform_admins').select('id').eq('user_id', userData.user.id).maybeSingle();
    if (!pa) {
      return new Response(JSON.stringify({ error: 'Apenas platform admins podem criar tenants' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const {
      name, slug, contact_email, contact_phone, notes,
      plan_id, status, owner_email, owner_password, owner_name,
    } = body || {};

    if (!name?.trim() || !slug?.trim() || !owner_email?.trim() || !owner_password) {
      return new Response(JSON.stringify({ error: 'Nome, slug, email e senha do owner são obrigatórios' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (owner_password.length < 6) {
      return new Response(JSON.stringify({ error: 'Senha deve ter ao menos 6 caracteres' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cleanSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');

    // 1. Create tenant
    const { data: tenant, error: tErr } = await admin.from('tenants').insert({
      name: name.trim(), slug: cleanSlug,
      contact_email: contact_email || owner_email,
      contact_phone: contact_phone || '',
      notes: notes || '',
      plan_id: plan_id || null,
      status: status || 'active',
    }).select().single();
    if (tErr) throw tErr;

    // 2. Find or create the owner user
    const { data: list } = await admin.auth.admin.listUsers();
    let ownerUser = list?.users?.find(u => u.email?.toLowerCase() === owner_email.toLowerCase());

    if (!ownerUser) {
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email: owner_email,
        password: owner_password,
        email_confirm: true,
        user_metadata: {
          name: owner_name || owner_email,
          username: owner_email,
          role: 'admin',
        },
      });
      if (cErr) throw cErr;
      ownerUser = created.user!;
    } else {
      // Update password if user already exists
      await admin.auth.admin.updateUserById(ownerUser.id, {
        password: owner_password,
        email_confirm: true,
      });
    }

    // 3. Ensure profile + role (remove any default role inserted by trigger first)
    await admin.from('profiles').upsert(
      { user_id: ownerUser.id, username: owner_email, name: owner_name || owner_email, active: true },
      { onConflict: 'user_id' }
    );
    await admin.from('user_roles').delete().eq('user_id', ownerUser.id);
    await admin.from('user_roles').insert({ user_id: ownerUser.id, role: 'admin' });

    // 4. Add as tenant owner
    await admin.from('tenant_members').upsert(
      { tenant_id: tenant.id, user_id: ownerUser.id, role: 'owner' },
      { onConflict: 'tenant_id,user_id' }
    );

    return new Response(JSON.stringify({
      success: true,
      tenant_id: tenant.id,
      owner_user_id: ownerUser.id,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
