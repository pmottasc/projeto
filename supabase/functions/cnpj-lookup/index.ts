// Busca dados de CNPJ via BrasilAPI com fallback para ReceitaWS e CNPJa.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function onlyDigits(s: string) {
  return (s || '').replace(/\D+/g, '');
}

function normalizeBrasilAPI(d: any, digits: string) {
  return {
    cnpj: digits,
    razao_social: d.razao_social || '',
    nome_fantasia: d.nome_fantasia || '',
    situacao: d.descricao_situacao_cadastral || '',
    data_abertura: d.data_inicio_atividade || null,
    natureza_juridica: d.natureza_juridica || '',
    porte: d.porte || '',
    capital_social: typeof d.capital_social === 'number' ? d.capital_social : Number(d.capital_social) || null,
    cnae_principal: d.cnae_fiscal ? String(d.cnae_fiscal) : '',
    cnae_principal_descricao: d.cnae_fiscal_descricao || '',
    cnaes_secundarios: d.cnaes_secundarios || [],
    logradouro: d.logradouro || '',
    numero: d.numero || '',
    complemento: d.complemento || '',
    bairro: d.bairro || '',
    municipio: d.municipio || '',
    uf: d.uf || '',
    cep: (d.cep || '').replace(/\D/g, ''),
    email: d.email || '',
    telefone: d.ddd_telefone_1 || '',
    socios: d.qsa || [],
    raw_data: d,
  };
}

function normalizeReceitaWS(d: any, digits: string) {
  const atividade = Array.isArray(d.atividade_principal) ? d.atividade_principal[0] : null;
  return {
    cnpj: digits,
    razao_social: d.nome || '',
    nome_fantasia: d.fantasia || '',
    situacao: d.situacao || '',
    data_abertura: d.abertura ? d.abertura.split('/').reverse().join('-') : null,
    natureza_juridica: d.natureza_juridica || '',
    porte: d.porte || '',
    capital_social: Number(String(d.capital_social || '').replace(/\./g, '').replace(',', '.')) || null,
    cnae_principal: atividade?.code ? String(atividade.code).replace(/\D/g, '') : '',
    cnae_principal_descricao: atividade?.text || '',
    cnaes_secundarios: (d.atividades_secundarias || []).map((a: any) => ({
      codigo: a.code, descricao: a.text,
    })),
    logradouro: d.logradouro || '',
    numero: d.numero || '',
    complemento: d.complemento || '',
    bairro: d.bairro || '',
    municipio: d.municipio || '',
    uf: d.uf || '',
    cep: (d.cep || '').replace(/\D/g, ''),
    email: d.email || '',
    telefone: d.telefone || '',
    socios: (d.qsa || []).map((s: any) => ({
      nome_socio: s.nome,
      qualificacao_socio: s.qual,
    })),
    raw_data: d,
  };
}

async function tryBrasilAPI(digits: string) {
  const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
  if (!r.ok) return null;
  return normalizeBrasilAPI(await r.json(), digits);
}

async function tryReceitaWS(digits: string) {
  const r = await fetch(`https://receitaws.com.br/v1/cnpj/${digits}`);
  if (!r.ok) return null;
  const d = await r.json();
  if (d.status === 'ERROR') return null;
  return normalizeReceitaWS(d, digits);
}

async function tryCNPJa(digits: string) {
  const r = await fetch(`https://open.cnpja.com/office/${digits}`);
  if (!r.ok) return null;
  const d = await r.json();
  return {
    cnpj: digits,
    razao_social: d.company?.name || '',
    nome_fantasia: d.alias || '',
    situacao: d.status?.text || '',
    data_abertura: d.founded || null,
    natureza_juridica: d.company?.nature?.text || '',
    porte: d.company?.size?.text || '',
    capital_social: d.company?.equity || null,
    cnae_principal: d.mainActivity?.id ? String(d.mainActivity.id) : '',
    cnae_principal_descricao: d.mainActivity?.text || '',
    cnaes_secundarios: (d.sideActivities || []).map((a: any) => ({ codigo: a.id, descricao: a.text })),
    logradouro: d.address?.street || '',
    numero: d.address?.number || '',
    complemento: d.address?.details || '',
    bairro: d.address?.district || '',
    municipio: d.address?.city || '',
    uf: d.address?.state || '',
    cep: (d.address?.zip || '').replace(/\D/g, ''),
    email: d.emails?.[0]?.address || '',
    telefone: d.phones?.[0] ? `${d.phones[0].area}${d.phones[0].number}` : '',
    socios: (d.company?.members || []).map((m: any) => ({
      nome_socio: m.person?.name,
      qualificacao_socio: m.role?.text,
    })),
    raw_data: d,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const { cnpj } = await req.json();
    const digits = onlyDigits(cnpj);
    if (digits.length !== 14) {
      return new Response(JSON.stringify({ error: 'CNPJ inválido (precisa ter 14 dígitos)' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const errors: string[] = [];
    for (const [name, fn] of [['BrasilAPI', tryBrasilAPI], ['CNPJa', tryCNPJa], ['ReceitaWS', tryReceitaWS]] as const) {
      try {
        const data = await fn(digits);
        if (data && data.razao_social) {
          return new Response(JSON.stringify(data), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        errors.push(`${name}: sem dados`);
      } catch (err) {
        errors.push(`${name}: ${String((err as any)?.message || err)}`);
      }
    }

    return new Response(JSON.stringify({
      error: 'CNPJ não encontrado em nenhuma das fontes públicas',
      detail: errors.join(' | '),
    }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as any)?.message || e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
