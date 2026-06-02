import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TARGET_EMAIL = 'hubprimesistemas@gmail.com';
const TARGET_PASSWORD = 'Pedro@@2024!';
const HUB_TENANT_SLUG = 'hubprime';
const HUB_TENANT_NAME = 'HubPrime';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // 1. Find or create the user
    const { data: list } = await admin.auth.admin.listUsers();
    let user = list?.users?.find(u => u.email?.toLowerCase() === TARGET_EMAIL);

    if (!user) {
      const { data: created, error } = await admin.auth.admin.createUser({
        email: TARGET_EMAIL,
        password: TARGET_PASSWORD,
        email_confirm: true,
        user_metadata: { name: 'Hub Prime', username: TARGET_EMAIL, role: 'admin' },
      });
      if (error) throw error;
      user = created.user!;
    } else {
      await admin.auth.admin.updateUserById(user.id, { password: TARGET_PASSWORD, email_confirm: true });
    }

    // 2. Ensure profile + admin role
    await admin.from('profiles').upsert(
      { user_id: user.id, username: TARGET_EMAIL, name: 'Hub Prime', active: true },
      { onConflict: 'user_id' },
    );
    await admin.from('user_roles').upsert(
      { user_id: user.id, role: 'admin' },
      { onConflict: 'user_id,role' },
    );

    // 3. Reset platform_admins: ONLY this user is platform admin
    await admin.from('platform_admins').delete().neq('user_id', user.id);
    const { data: existing } = await admin.from('platform_admins').select('id').eq('user_id', user.id).maybeSingle();
    if (!existing) {
      await admin.from('platform_admins').insert({ user_id: user.id });
    }

    // 4. Ensure HubPrime tenant exists (separate from any client tenant like Tell)
    let { data: hubTenant } = await admin
      .from('tenants')
      .select('id')
      .eq('slug', HUB_TENANT_SLUG)
      .maybeSingle();

    if (!hubTenant) {
      const { data: created, error: tErr } = await admin
        .from('tenants')
        .insert({
          name: HUB_TENANT_NAME,
          slug: HUB_TENANT_SLUG,
          contact_email: TARGET_EMAIL,
          status: 'active',
        })
        .select('id')
        .single();
      if (tErr) throw tErr;
      hubTenant = created;
    }

    // 5. CRITICAL: HubPrime user must ONLY belong to HubPrime tenant.
    // Remove from any other tenant (Tell, future clients, etc.) so SuperAdmin
    // never sees client data through tenant_members.
    await admin
      .from('tenant_members')
      .delete()
      .eq('user_id', user.id)
      .neq('tenant_id', hubTenant!.id);

    // 6. Ensure ownership of HubPrime tenant
    await admin.from('tenant_members').upsert(
      { tenant_id: hubTenant!.id, user_id: user.id, role: 'owner' },
      { onConflict: 'tenant_id,user_id' },
    );

    return new Response(
      JSON.stringify({ success: true, user_id: user.id, email: TARGET_EMAIL, hub_tenant_id: hubTenant!.id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
