// Edge function: OCR de PDF de extrato bancário via Lovable AI (Gemini).
// Recebe { fileBase64, fileName, tenant_id } e devolve { text } — o texto bruto
// que será processado pelo parser local existente.
import { createClient } from 'npm:@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY não configurada.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { fileBase64, fileName, tenant_id } = body ?? {};
    if (!fileBase64) {
      return new Response(JSON.stringify({ error: 'fileBase64 é obrigatório.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Quota check: OCR de extrato conta como conversão.
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
        console.error('[ocr-pdf-statement] quota check failed:', quotaErr);
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

    console.log(`[ocr-pdf-statement] OCR em ${fileName ?? 'arquivo'} (${fileBase64.length} chars base64)`);

    const prompt = `Você está lendo um EXTRATO BANCÁRIO BRASILEIRO em PDF (possivelmente escaneado).
Extraia TODO o texto legível, preservando a ordem de leitura (de cima para baixo, esquerda para direita).

Regras:
- Preserve datas (DD/MM/AAAA ou DD/MM), valores (1.234,56), indicadores C/D, sinais + ou -.
- Mantenha uma transação por linha quando possível.
- Se existir tabela com colunas Data | Descrição | Documento | Valor (R$) | Saldo (R$), preserve os DOIS valores no fim da linha, nesta ordem: DATA DESCRICAO DOCUMENTO VALOR SALDO.
- Nunca troque a coluna Valor pela coluna Saldo; Saldo é apenas saldo após o lançamento, não é valor da movimentação.
- Não resuma, não traduza, não interprete — apenas transcreva o conteúdo.
- Inclua cabeçalho do extrato (banco, agência, conta, período, saldo anterior, saldo final).
- NÃO adicione comentários, NÃO use markdown. Apenas texto puro.`;

    const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: { url: `data:application/pdf;base64,${fileBase64}` },
              },
            ],
          },
        ],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[ocr-pdf-statement] gateway error:', resp.status, errText.slice(0, 500));
      if (resp.status === 429) {
        return new Response(JSON.stringify({ error: 'Limite de uso atingido. Tente novamente em instantes.' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (resp.status === 402) {
        return new Response(JSON.stringify({ error: 'Créditos da Lovable AI esgotados. Recarregue para continuar.' }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: `Falha no OCR (${resp.status}).` }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await resp.json();
    const text: string = data?.choices?.[0]?.message?.content ?? '';
    console.log(`[ocr-pdf-statement] OCR ok (${text.length} chars)`);

    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ocr-pdf-statement] exception:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
