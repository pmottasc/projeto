import { createClient } from 'npm:@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ALLOWED: Record<string, string[]> = {
  pdf:  ['docx', 'xlsx', 'pptx', 'txt', 'jpg', 'png', 'html', 'rtf'],
  docx: ['pdf', 'txt', 'html', 'rtf', 'odt'],
  doc:  ['pdf', 'docx', 'txt', 'html', 'rtf'],
  xlsx: ['pdf', 'csv', 'html', 'xls'],
  xls:  ['pdf', 'xlsx', 'csv', 'html'],
  pptx: ['pdf', 'png', 'jpg', 'html'],
  ppt:  ['pdf', 'pptx', 'png', 'jpg'],
  csv:  ['xlsx', 'pdf', 'html'],
  rtf:  ['pdf', 'docx', 'txt', 'html'],
  odt:  ['pdf', 'docx', 'txt'],
  txt:  ['pdf', 'docx', 'html'],
  html: ['pdf', 'docx', 'png', 'jpg'],
  jpg:  ['pdf', 'png', 'webp'],
  jpeg: ['pdf', 'png', 'webp'],
  png:  ['pdf', 'jpg', 'webp'],
  webp: ['pdf', 'jpg', 'png'],
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiSecret = Deno.env.get('CONVERTAPI_SECRET');
    if (!apiSecret) {
      return new Response(JSON.stringify({ error: 'CONVERTAPI_SECRET não configurado' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Não autenticado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Sessão inválida' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { fileBase64, fileName, fromFormat, toFormat, tenant_id } = body ?? {};
    if (!fileBase64 || !fileName || !fromFormat || !toFormat) {
      return new Response(JSON.stringify({ error: 'Parâmetros faltando' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const from = String(fromFormat).toLowerCase();
    const to = String(toFormat).toLowerCase();
    if (!ALLOWED[from] || !ALLOWED[from].includes(to)) {
      return new Response(JSON.stringify({ error: `Conversão não suportada: ${from} → ${to}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Quota check: bloqueia se o tenant já estourou o limite mensal de conversões.
    // Usa service role para chamar a RPC SECURITY DEFINER.
    if (tenant_id) {
      const admin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      const { data: quota, error: quotaErr } = await admin.rpc('check_tenant_quota', {
        _tenant_id: tenant_id,
        _counter_key: 'conversions',
        _increment: 1,
      });
      if (quotaErr) {
        console.error('[convert-document] quota check failed:', quotaErr);
      } else if (quota && (quota as any).allowed === false) {
        const q = quota as any;
        return new Response(JSON.stringify({
          error: `Limite mensal de conversões atingido (${q.current}/${q.limit}). Faça upgrade do plano.`,
          quota_exceeded: true,
          quota: q,
        }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const url = `https://v2.convertapi.com/convert/${from}/to/${to}?Secret=${apiSecret}`;
    const payload = {
      Parameters: [
        { Name: 'File', FileValue: { Name: fileName, Data: fileBase64 } },
        { Name: 'StoreFile', Value: false },
      ],
    };

    console.log(`[convert-document] ${from} → ${to}, file: ${fileName}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      const msg = data?.Message || data?.error || `ConvertAPI ${response.status}`;
      console.error('[convert-document] ConvertAPI error:', msg);
      return new Response(JSON.stringify({ error: msg }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const file = data?.Files?.[0];
    if (!file) {
      console.error('[convert-document] no Files in response:', JSON.stringify(data).slice(0, 500));
      return new Response(JSON.stringify({ error: 'Resposta inválida do conversor (sem arquivo)' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let fileData: string | undefined = file.FileData;

    // Fallback: if API returned a Url (StoreFile mode), fetch and convert to base64
    if (!fileData && file.Url) {
      console.log('[convert-document] fetching file from Url:', file.Url);
      const dl = await fetch(file.Url);
      if (!dl.ok) {
        return new Response(JSON.stringify({ error: `Falha ao baixar arquivo convertido (${dl.status})` }), {
          status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const buf = new Uint8Array(await dl.arrayBuffer());
      // Chunked btoa to avoid stack overflow on large files
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < buf.length; i += chunk) {
        binary += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)));
      }
      fileData = btoa(binary);
    }

    if (!fileData) {
      console.error('[convert-document] no FileData/Url:', JSON.stringify(file).slice(0, 500));
      return new Response(JSON.stringify({ error: 'Resposta inválida do conversor (sem dados)' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      fileName: file.FileName,
      fileData,
      fileSize: file.FileSize,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[convert-document] error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
