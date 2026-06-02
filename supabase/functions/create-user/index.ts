import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const ResetPasswordSchema = z.object({
  action: z.literal('reset-password'),
  user_id: z.string().uuid(),
  new_password: z.string().min(8).max(128),
});

const ChangeEmailSchema = z.object({
  action: z.literal('change-email'),
  user_id: z.string().uuid(),
  new_email: z.string().email().max(255),
});

const CreateUserSchema = z.object({
  action: z.literal('create-user').optional(),
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(120),
  role: z.enum(['admin', 'supervisor', 'user']).optional(),
  tenant_id: z.string().uuid(),
  department_id: z.string().uuid().nullish(),
  department_ids: z.array(z.string().uuid()).optional(),
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Não autorizado' }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) return json({ error: 'Não autorizado' }, 401);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Caller deve ser admin/supervisor global ou platform admin
    const [{ data: roleData }, { data: platformAdmin }] = await Promise.all([
      adminClient.from('user_roles').select('role').eq('user_id', caller.id).maybeSingle(),
      adminClient.from('platform_admins').select('id').eq('user_id', caller.id).maybeSingle(),
    ]);
    const isStaff = roleData && ['admin', 'supervisor'].includes(roleData.role);
    if (!isStaff && !platformAdmin) return json({ error: 'Sem permissão' }, 403);

    const rawBody = await req.json().catch(() => ({}));
    const action = rawBody?.action ?? 'create-user';

    if (action === 'reset-password') {
      const parsed = ResetPasswordSchema.safeParse(rawBody);
      if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
      const { error } = await adminClient.auth.admin.updateUserById(parsed.data.user_id, {
        password: parsed.data.new_password,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    if (action === 'change-email') {
      const parsed = ChangeEmailSchema.safeParse(rawBody);
      if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
      const { error } = await adminClient.auth.admin.updateUserById(parsed.data.user_id, {
        email: parsed.data.new_email,
        email_confirm: true,
      });
      if (error) return json({ error: error.message }, 400);
      await adminClient.from('profiles').update({ username: parsed.data.new_email }).eq('user_id', parsed.data.user_id);
      return json({ success: true });
    }

    // create-user
    const parsed = CreateUserSchema.safeParse(rawBody);
    if (!parsed.success) {
      console.error('Validation error:', parsed.error.flatten());
      return json({ error: 'Dados inválidos: ' + JSON.stringify(parsed.error.flatten().fieldErrors) }, 400);
    }
    const { email, password, name, role, tenant_id, department_id, department_ids } = parsed.data;

    // Caller precisa ser admin/owner do tenant ou platform admin
    const { data: callerMembership } = await adminClient
      .from('tenant_members')
      .select('role')
      .eq('tenant_id', tenant_id)
      .eq('user_id', caller.id)
      .maybeSingle();
    const callerIsTenantAdmin = callerMembership && ['owner', 'admin'].includes(callerMembership.role);
    if (!callerIsTenantAdmin && !platformAdmin) {
      return json({ error: 'Sem permissão neste tenant' }, 403);
    }

    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, username: email, role: role || 'user' },
    });
    if (createError) {
      console.error('createUser error:', createError);
      return json({ error: createError.message }, 400);
    }
    if (!newUser?.user) return json({ error: 'Falha ao criar usuário' }, 500);

    const newUserId = newUser.user.id;

    const { error: memberError } = await adminClient
      .from('tenant_members')
      .insert({ tenant_id, user_id: newUserId, role: 'member' });
    if (memberError) {
      console.error('tenant_members insert error:', memberError);
      await adminClient.auth.admin.deleteUser(newUserId);
      return json({ error: 'Falha ao vincular ao tenant: ' + memberError.message }, 500);
    }

    if (department_id) {
      const { error: profErr } = await adminClient
        .from('profiles')
        .update({ department_id })
        .eq('user_id', newUserId);
      if (profErr) console.error('profiles department_id update error:', profErr);
    }

    const deptList = Array.from(new Set([
      ...(department_ids ?? []),
      ...(department_id ? [department_id] : []),
    ]));
    if (deptList.length > 0) {
      const rows = deptList.map((d) => ({ tenant_id, user_id: newUserId, department_id: d }));
      const { error: pdErr } = await adminClient.from('profile_departments').insert(rows);
      if (pdErr) console.error('profile_departments insert error:', pdErr);
    }

    return json({ user: newUser.user, user_id: newUserId });
  } catch (error) {
    console.error('create-user error:', error);
    return json({ error: error instanceof Error ? error.message : 'Erro interno' }, 500);
  }
});
