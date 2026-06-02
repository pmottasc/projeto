// Consulta XML — backend único para o módulo "Consulta XML".
// Provedor: NFE.io (https://nfe.io)
//
// Actions:
//   empresa_list   -> lista empresas do tenant
//   empresa_save   -> cria/atualiza empresa (multipart com PFX opcional)
//   empresa_delete -> remove empresa
//   consultar      -> consulta DF-e na NFE.io para a empresa (respeita cooldown 1h)
//   manifestar     -> envia evento de manifestação
//   download       -> baixa XML(s) — single ou ZIP
//   permissions    -> lê/atualiza permissões granulares de um usuário
//
// Segurança:
//   - JWT do usuário validado.
//   - Senha do PFX criptografada com AES-GCM (chave derivada do SERVICE_ROLE_KEY).
//   - Senha nunca retorna ao cliente.
//   - Permissões granulares revalidadas server-side.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const NFEIO_BASE = "https://api.nfse.io";
const COOLDOWN_MS = 5 * 60 * 1000; // 5 min (sem novos documentos)
const COOLDOWN_THROTTLE_MS = 60 * 60 * 1000; // 1h apenas quando SEFAZ acusa consumo indevido

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// --------- Crypto helpers (AES-GCM) ---------
let cachedKey: CryptoKey | null = null;
async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const seed = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "fallback-seed";
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("xml-aes:" + seed));
  cachedKey = await crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
  return cachedKey;
}
async function encryptPassword(plain: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  const buf = new Uint8Array(iv.length + ct.length);
  buf.set(iv); buf.set(ct, iv.length);
  return btoa(String.fromCharCode(...buf));
}
async function decryptPassword(b64: string): Promise<string> {
  const key = await getKey();
  const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const iv = buf.slice(0, 12);
  const ct = buf.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

// --------- Auth ---------
async function getUserAndTenant(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("missing_auth");

  const supaUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data: ud, error: ue } = await supaUser.auth.getUser();
  if (ue || !ud?.user) throw new Error("invalid_auth");

  const supaSrv = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: tm } = await supaSrv
    .from("tenant_members")
    .select("tenant_id, role")
    .eq("user_id", ud.user.id)
    .limit(1)
    .maybeSingle();
  if (!tm?.tenant_id) throw new Error("no_tenant");

  return { user: ud.user, tenantId: tm.tenant_id as string, role: tm.role as string, supabase: supaSrv };
}

async function checkPermission(supabase: any, userId: string, tenantId: string, perm: string): Promise<boolean> {
  const { data } = await supabase.rpc("xml_has_permission", { _user_id: userId, _tenant_id: tenantId, _perm: perm });
  return !!data;
}

async function logAction(supabase: any, row: Record<string, unknown>) {
  try { await supabase.from("xml_consulta_logs").insert(row); } catch (_) { /* ignore */ }
}

// --------- NFE.io adapter ---------
function nfeioKey() {
  const k = Deno.env.get("NFEIO_API_KEY");
  if (!k) throw new Error("NFEIO_API_KEY not configured");
  return k;
}
async function nfeioFetch(path: string, init: RequestInit = {}) {
  const r = await fetch(`${NFEIO_BASE}${path}`, {
    ...init,
    headers: {
      "Authorization": `ApiKey ${nfeioKey()}`,
      "Accept": "application/json",
      ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const txt = await r.text();
  let data: any = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = { raw: txt }; }
  if (!r.ok) {
    const firstErr = Array.isArray(data?.errors) && data.errors.length
      ? data.errors[0]?.message || data.errors[0]?.code
      : null;
    const msg = firstErr || data?.message || data?.error?.message || `NFE.io ${r.status}${txt ? `: ${txt.slice(0, 200)}` : ''}`;
    const err: any = new Error(msg);
    err.status = r.status;
    err.path = path;
    throw err;
  }
  return data;
}

// Garante que o serviço de inbound de NF-e (DF-e) está ativo para a empresa.
// Idempotente: se já estiver ativo, a API responde sem efeitos colaterais.
async function nfeioEnsureInboundActive(companyId: string) {
  try {
    // Verifica a configuração atual do inbound de NF-e.
    await nfeioFetch(`/v2/companies/${companyId}/inbound/productinvoices`, { method: "GET" });
  } catch (e: any) {
    if (e?.status === 404) {
      // Ativa o serviço de DF-e (inbound NF-e) para a empresa
      await nfeioFetch(`/v2/companies/${companyId}/inbound/productinvoices`, {
        method: "POST",
        body: JSON.stringify({
          StartFromNsu: 0,
          StartFromDate: new Date(Date.now() - 89 * 24 * 60 * 60 * 1000).toISOString(),
          EnvironmentSEFAZ: "Production",
          AutomaticManifesting: { MinutesToWaitAwarenessOperation: 60 },
          WebhookVersion: 2,
        }),
      });
    } else {
      throw e;
    }
  }
}

// Lista NF-e recebidas (DF-e) via OData.
async function nfeioListInbound(companyId: string, lastNSU = "0") {
  const qs = new URLSearchParams();
  const nsu = Number(lastNSU || "0");
  const filter = Number.isFinite(nsu) && nsu > 0
    ? `environmentType eq 1 and nsu gt ${nsu}`
    : "environmentType eq 1";
  qs.set("$filter", filter);
  qs.set("$top", "200");
  return await nfeioFetch(`/v2/companies/${companyId}/inbound/odata/ProductInvoices?${qs.toString()}`);
}

// Manifestação. Endpoint: POST /v2/companies/{companyId}/inbound/{accessKey}/manifest?tpEvent=...
async function nfeioManifest(companyId: string, accessKey: string, tipo: string, justificativa?: string) {
  const map: Record<string, string> = {
    ciencia: "210210",
    confirmacao: "210200",
    desconhecimento: "210220",
    nao_realizada: "210240",
  };
  const tpEvent = map[tipo] || "210210";
  const body: Record<string, unknown> = {};
  if (justificativa) body.justification = justificativa;
  return await nfeioFetch(`/v2/companies/${companyId}/inbound/${accessKey}/manifest?tpEvent=${tpEvent}`, {
    method: "POST",
    ...(Object.keys(body).length ? { body: JSON.stringify(body) } : {}),
  });
}


// Cria empresa na NFE.io (cadastro automático)
// Busca dados cadastrais da empresa (endereço etc.) na BrasilAPI
async function fetchCnpjData(cnpj: string): Promise<any | null> {
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function cleanText(value: unknown, fallback = "") {
  return String(value || fallback).replace(/\s+/g, " ").trim();
}

function resolveStreet(rawStreet: unknown) {
  const original = cleanText(rawStreet, "Não informada");
  const aliases: Array<[RegExp, string]> = [
    [/^(r\.?|rua)\b/i, "Rua"],
    [/^(av\.?|avenida)\b/i, "Avenida"],
    [/^(al\.?|alameda)\b/i, "Alameda"],
    [/^(rod\.?|rodovia)\b/i, "Rodovia"],
    [/^(estr\.?|estrada)\b/i, "Estrada"],
    [/^(trav\.?|travessa)\b/i, "Travessa"],
    [/^(pc\.?|praça|praca)\b/i, "Praça"],
    [/^(vl\.?|vila)\b/i, "Vila"],
    [/^(lgo\.?|largo)\b/i, "Largo"],
    [/^(q\.?|quadra)\b/i, "Quadra"],
  ];
  const found = aliases.find(([pattern]) => pattern.test(original));
  const streetPrefix = found?.[1] || "Rua";
  const street = found ? original : `${streetPrefix} ${original}`;
  return { streetPrefix, street: street.length >= 5 ? street : `${streetPrefix} Não informada` };
}

function resolveTaxRegime(cnpjData: any) {
  if (cnpjData?.opcao_pelo_mei === true) return "MicroempreendedorIndividual";
  if (cnpjData?.opcao_pelo_simples === true) return "SimplesNacional";
  return "None";
}

async function nfeioCreateCompany(payload: {
  name: string; cnpj: string; email?: string;
}): Promise<string> {
  const cnpjData = await fetchCnpjData(payload.cnpj);
  if (!cnpjData) {
    throw new Error("Não consegui obter o endereço deste CNPJ na Receita (BrasilAPI). Verifique se o CNPJ está correto e ativo.");
  }

  const streetInfo = resolveStreet(cnpjData.logradouro);
  const address = {
    country: "BRA",
    postalCode: String(cnpjData.cep || "").replace(/\D/g, ""),
    streetPrefix: streetInfo.streetPrefix,
    street: streetInfo.street,
    number: cleanText(cnpjData.numero, "S/N") || "S/N",
    additionalInformation: cleanText(cnpjData.complemento),
    district: cleanText(cnpjData.bairro, "Centro"),
    city: {
      code: String(cnpjData.codigo_municipio_ibge || cnpjData.codigo_municipio || ""),
      name: cleanText(cnpjData.municipio),
    },
    state: cleanText(cnpjData.uf).toUpperCase(),
  };

  if (!address.postalCode || !address.city.code || !address.city.name || !address.state) {
    throw new Error("Endereço incompleto na Receita/BrasilAPI para este CNPJ. Verifique CEP, município e UF antes de cadastrar na NFE.io.");
  }

  const company: Record<string, unknown> = {
    name: cleanText(payload.name, cnpjData.razao_social || cnpjData.nome_fantasia),
    tradeName: cleanText(cnpjData.nome_fantasia, payload.name || cnpjData.razao_social),
    federalTaxNumber: Number(payload.cnpj),
    email: cleanText(payload.email || cnpjData.email, "no-reply@example.com"),
    taxRegime: resolveTaxRegime(cnpjData),
    address,
  };
  if (cnpjData.inscricao_municipal) company.municipalTaxNumber = String(cnpjData.inscricao_municipal);

  const r = await fetch(`${NFEIO_BASE}/v2/companies`, {
    method: "POST",
    headers: {
      "Authorization": `ApiKey ${nfeioKey()}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({ company }),
  });

  const txt = await r.text();
  let data: any = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = { raw: txt }; }
  if (!r.ok) {
    console.error("[NFE.io createCompany] status", r.status, "body enviado:", JSON.stringify({ company }));
    console.error("[NFE.io createCompany] resposta:", txt);
    // Tenta achar a primeira mensagem útil em qualquer estrutura de erro
    const firstErr = (() => {
      if (Array.isArray(data?.errors) && data.errors.length) {
        const e = data.errors[0];
        return e?.message || e?.code || JSON.stringify(e);
      }
      if (data?.errors && typeof data.errors === "object") {
        const k = Object.keys(data.errors)[0];
        const v = (data.errors as any)[k];
        return `${k}: ${Array.isArray(v) ? v.join(", ") : JSON.stringify(v)}`;
      }
      return null;
    })();
    const msg = firstErr || data?.message || data?.error?.message || data?.error || txt?.slice(0, 300) || `NFE.io ${r.status}`;
    throw new Error(`NFE.io ${r.status}: ${msg}`);
  }
  // Tenta extrair o id em qualquer formato comum retornado pela NFE.io
  const id =
    data?.companies?.id ||
    data?.company?.id ||
    data?.company?.Id ||
    data?.companyId ||
    data?.id ||
    data?.Id ||
    data?.data?.id ||
    data?.result?.id;
  if (!id) {
    console.error("[NFE.io] resposta sem companyId:", JSON.stringify(data).slice(0, 800));
    throw new Error("NFE.io não retornou companyId. Resposta: " + JSON.stringify(data).slice(0, 200));
  }
  return String(id);
}

// Upload do certificado A1 na NFE.io
async function nfeioUploadCertificate(companyId: string, pfx: Uint8Array, password: string): Promise<void> {
  const pfxCopy = new ArrayBuffer(pfx.byteLength);
  new Uint8Array(pfxCopy).set(pfx);
  const blob = new Blob([pfxCopy], { type: "application/x-pkcs12" });

  // NFE.io aceita o certificado em /certificate (singular). Tentamos algumas variações
  // de nome de campo, pois a API muda entre planos (DF-e vs NFS-e).
  const attempts: Array<{ url: string; fileField: string; pwdField: string }> = [
    { url: `${NFEIO_BASE}/v2/companies/${companyId}/certificate`, fileField: "file", pwdField: "password" },
    { url: `${NFEIO_BASE}/v2/companies/${companyId}/certificate`, fileField: "File", pwdField: "Password" },
    { url: `${NFEIO_BASE}/v2/companies/${companyId}/certificates`, fileField: "file", pwdField: "password" },
  ];

  let lastMsg = "";
  for (const a of attempts) {
    const fd = new FormData();
    fd.append(a.fileField, blob, "certificado.pfx");
    fd.append(a.pwdField, password);
    const r = await fetch(a.url, {
      method: "POST",
      headers: { "Authorization": `ApiKey ${nfeioKey()}` },
      body: fd,
    });
    if (r.ok) return;
    const txt = await r.text();
    let msg = `NFE.io ${r.status}`;
    try { const d = JSON.parse(txt); msg = d?.message || d?.error?.message || JSON.stringify(d) || msg; } catch { msg = `${msg}: ${txt.slice(0, 200)}`; }
    lastMsg = msg;
    // Se for 404 (rota inválida) tenta a próxima; em outros erros aborta.
    if (r.status !== 404) break;
  }
  throw new Error(`Falha ao enviar certificado para NFE.io: ${lastMsg}`);
}


// Detalhes / XML completo
async function nfeioGetXml(companyId: string, accessKey: string): Promise<string | null> {
  try {
    const r = await fetch(`${NFEIO_BASE}/v2/companies/${companyId}/inbound/${accessKey}/xml`, {
      headers: { "Authorization": `ApiKey ${nfeioKey()}` },
    });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}


// --------- ZIP minimal (store, no compression) ---------
function crc32(bytes: Uint8Array): number {
  let c, table: number[] = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = (table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function buildZip(files: { name: string; content: string }[]): Uint8Array {
  const enc = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = enc.encode(f.content);
    const crc = crc32(data);
    const lh = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true); dv.setUint16(6, 0, true); dv.setUint16(8, 0, true);
    dv.setUint16(10, 0, true); dv.setUint16(12, 0, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true);
    dv.setUint16(26, nameBytes.length, true); dv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);
    localParts.push(lh, data);

    const ch = new Uint8Array(46 + nameBytes.length);
    const dv2 = new DataView(ch.buffer);
    dv2.setUint32(0, 0x02014b50, true);
    dv2.setUint16(4, 20, true); dv2.setUint16(6, 20, true);
    dv2.setUint16(8, 0, true); dv2.setUint16(10, 0, true);
    dv2.setUint16(12, 0, true); dv2.setUint16(14, 0, true);
    dv2.setUint32(16, crc, true);
    dv2.setUint32(20, data.length, true); dv2.setUint32(24, data.length, true);
    dv2.setUint16(28, nameBytes.length, true);
    dv2.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    central.push(ch);

    offset += lh.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const cdOffset = offset;
  const eocd = new Uint8Array(22);
  const dv3 = new DataView(eocd.buffer);
  dv3.setUint32(0, 0x06054b50, true);
  dv3.setUint16(8, files.length, true);
  dv3.setUint16(10, files.length, true);
  dv3.setUint32(12, cdSize, true);
  dv3.setUint32(16, cdOffset, true);

  const total = localParts.reduce((a, b) => a + b.length, 0) + cdSize + 22;
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of localParts) { out.set(part, p); p += part.length; }
  for (const part of central)    { out.set(part, p); p += part.length; }
  out.set(eocd, p);
  return out;
}

// --------- Action handlers ---------
async function handleEmpresaList(supabase: any, tenantId: string) {
  const { data, error } = await supabase
    .from("xml_empresas")
    .select("id, razao_social, cnpj, codigo_interno, nfeio_company_id, ultimo_nsu, ultima_consulta_at, cooldown_until, status, last_error, certificado_path, created_at")
    .eq("tenant_id", tenantId)
    .order("razao_social");
  if (error) throw error;
  return json({ ok: true, empresas: data || [] });
}

async function handleEmpresaSave(req: Request, supabase: any, tenantId: string, userId: string) {
  if (!await checkPermission(supabase, userId, tenantId, "configurar"))
    return json({ ok: false, error: "Sem permissão para configurar empresas." }, 403);

  const ct = req.headers.get("content-type") || "";
  let body: Record<string, any> = {};
  let pfxFile: File | null = null;
  let senha: string | null = null;

  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    for (const [k, v] of fd.entries()) {
      if (k === "pfx" && v instanceof File) pfxFile = v;
      else if (k === "senha") senha = String(v);
      else body[k] = String(v);
    }
  } else {
    body = await req.json().catch(() => ({}));
  }

  const id = body.id || null;
  const cnpj = String(body.cnpj || "").replace(/\D/g, "");
  if (cnpj.length !== 14) return json({ ok: false, error: "CNPJ inválido." }, 400);

  const payload: Record<string, any> = {
    tenant_id: tenantId,
    razao_social: body.razao_social,
    cnpj,
    codigo_interno: body.codigo_interno || null,
    nfeio_company_id: body.nfeio_company_id || null,
    status: body.status || "ativo",
  };

  let empresaId = id;
  let existingNfeioId: string | null = null;

  // Idempotência: se não veio id, procura por (tenant, cnpj) — evita duplicate key em retentativas.
  if (!empresaId) {
    const { data: existing } = await supabase
      .from("xml_empresas")
      .select("id, nfeio_company_id")
      .eq("tenant_id", tenantId).eq("cnpj", cnpj).maybeSingle();
    if (existing?.id) {
      empresaId = existing.id;
      existingNfeioId = existing.nfeio_company_id || null;
    }
  } else {
    const { data: existing } = await supabase
      .from("xml_empresas")
      .select("nfeio_company_id")
      .eq("id", empresaId).eq("tenant_id", tenantId).maybeSingle();
    existingNfeioId = existing?.nfeio_company_id || null;
  }

  if (empresaId) {
    if (senha) payload.senha_cifrada = await encryptPassword(senha);
    // Não sobrescreve nfeio_company_id se já existir e o cliente não enviou um novo.
    if (!payload.nfeio_company_id) delete payload.nfeio_company_id;
    const { error } = await supabase.from("xml_empresas").update(payload).eq("id", empresaId).eq("tenant_id", tenantId);
    if (error) return json({ ok: false, error: error.message }, 400);
  } else {
    payload.created_by = userId;
    if (senha) payload.senha_cifrada = await encryptPassword(senha);
    const { data, error } = await supabase.from("xml_empresas").insert(payload).select("id").single();
    if (error) return json({ ok: false, error: error.message }, 400);
    empresaId = data.id;
  }

  // Upload PFX (Storage privado, backup criptografado) + cadastro automático na NFE.io
  let pfxBuf: Uint8Array | null = null;
  if (pfxFile && empresaId) {
    pfxBuf = new Uint8Array(await pfxFile.arrayBuffer());
    const path = `${tenantId}/${empresaId}.pfx`;
    const up = await supabase.storage.from("xml-certificates").upload(path, pfxBuf, {
      contentType: "application/x-pkcs12",
      upsert: true,
    });
    if (up.error) return json({ ok: false, error: up.error.message }, 400);
    await supabase.from("xml_empresas").update({ certificado_path: path }).eq("id", empresaId);
  }

  // Auto-registro na NFE.io quando ainda não temos companyId
  let nfeioId = body.nfeio_company_id || existingNfeioId || null;

  // Se ainda não temos companyId mas existe certificado armazenado, baixa do Storage
  // para usar no cadastro automático.
  if (!nfeioId && !pfxBuf) {
    const { data: empRow } = await supabase
      .from("xml_empresas")
      .select("certificado_path, senha_cifrada")
      .eq("id", empresaId).maybeSingle();
    if (empRow?.certificado_path) {
      const dl = await supabase.storage.from("xml-certificates").download(empRow.certificado_path);
      if (dl.data) pfxBuf = new Uint8Array(await dl.data.arrayBuffer());
    }
    // Se não veio senha agora, tenta usar a senha guardada (criptografada)
    if (!senha && empRow?.senha_cifrada) {
      try { senha = await decryptPassword(empRow.senha_cifrada); } catch { /* ignore */ }
    }
  }

  if (!nfeioId && pfxBuf && senha) {
    try {
      nfeioId = await nfeioCreateCompany({
        name: String(body.razao_social || ""),
        cnpj,
        email: body.email || undefined,
      });
      await nfeioUploadCertificate(nfeioId, pfxBuf, senha);
      await supabase.from("xml_empresas").update({
        nfeio_company_id: nfeioId,
        last_error: null,
      }).eq("id", empresaId);
    } catch (err: any) {
      const msg = err?.message || "Erro ao cadastrar na NFE.io";
      await supabase.from("xml_empresas").update({ last_error: msg }).eq("id", empresaId);
      await logAction(supabase, {
        tenant_id: tenantId, empresa_id: empresaId, user_id: userId,
        acao: "cadastro_nfeio", status: "erro", mensagem: msg, error: msg,
      });
      return json({
        ok: false,
        id: empresaId,
        error: msg + " Empresa salva localmente — corrija e tente salvar novamente.",
      }, 400);
    }
  } else if (!nfeioId && (!pfxBuf || !senha)) {
    // Falta material para registrar — alerta o usuário
    const falta = !pfxBuf ? "certificado .pfx" : "senha do certificado";
    await supabase.from("xml_empresas").update({
      last_error: `Cadastro na NFE.io pendente: faltou ${falta}.`,
    }).eq("id", empresaId);
  } else if (nfeioId && pfxFile && senha) {
    // Reupload de certificado para empresa já cadastrada
    try {
      await nfeioUploadCertificate(nfeioId, pfxBuf!, senha);
    } catch (err: any) {
      const msg = err?.message || "Erro ao atualizar certificado";
      await supabase.from("xml_empresas").update({ last_error: msg }).eq("id", empresaId);
      return json({ ok: false, id: empresaId, error: msg }, 400);
    }
  }

  await logAction(supabase, {
    tenant_id: tenantId, empresa_id: empresaId, user_id: userId,
    acao: "cadastro", status: "ok",
    mensagem: id ? "Empresa atualizada" : (nfeioId ? "Empresa criada e registrada na NFE.io" : "Empresa criada"),
  });

  return json({ ok: true, id: empresaId, nfeio_company_id: nfeioId });
}

async function handleEmpresaDelete(supabase: any, tenantId: string, userId: string, empresaId: string) {
  if (!await checkPermission(supabase, userId, tenantId, "configurar"))
    return json({ ok: false, error: "Sem permissão." }, 403);
  const { data: emp } = await supabase.from("xml_empresas").select("certificado_path").eq("id", empresaId).eq("tenant_id", tenantId).maybeSingle();
  if (emp?.certificado_path) {
    await supabase.storage.from("xml-certificates").remove([emp.certificado_path]);
  }
  await supabase.from("xml_empresas").delete().eq("id", empresaId).eq("tenant_id", tenantId);
  return json({ ok: true });
}

async function handleConsultar(supabase: any, tenantId: string, userId: string, empresaId: string) {
  if (!await checkPermission(supabase, userId, tenantId, "consultar"))
    return json({ ok: false, error: "Sem permissão para consultar." }, 403);

  const { data: emp, error } = await supabase
    .from("xml_empresas").select("*").eq("id", empresaId).eq("tenant_id", tenantId).maybeSingle();
  if (error || !emp) return json({ ok: false, error: "Empresa não encontrada." }, 404);
  if (emp.status !== "ativo") return json({ ok: false, error: "Empresa inativa." }, 400);
  // Auto-cria empresa na NFE.io se ainda não tiver ID associado
  if (!emp.nfeio_company_id) {
    try {
      const newId = await nfeioCreateCompany({
        name: emp.razao_social,
        cnpj: String(emp.cnpj || "").replace(/\D/g, ""),
        email: emp.email || undefined,
      });
      await supabase.from("xml_empresas").update({ nfeio_company_id: newId, last_error: null }).eq("id", empresaId);
      emp.nfeio_company_id = newId;
    } catch (err: any) {
      const msg = err?.message || "Falha ao registrar empresa na NFE.io";
      await supabase.from("xml_empresas").update({ last_error: msg }).eq("id", empresaId);
      await logAction(supabase, { tenant_id: tenantId, empresa_id: empresaId, user_id: userId, acao: "consulta", status: "erro", mensagem: msg, error: msg });
      return json({ ok: false, error: `Não foi possível registrar a empresa na NFE.io automaticamente. ${msg}` }, 400);
    }
  }

  if (emp.cooldown_until && new Date(emp.cooldown_until).getTime() > Date.now()) {
    const cooldownUntil = new Date(emp.cooldown_until);
    const restMin = Math.ceil((cooldownUntil.getTime() - Date.now()) / 60000);
    return json({
      ok: false,
      blocked: true,
      error: `Aguarde antes de consultar novamente esta empresa. Próxima consulta liberada em ~${restMin} min.`,
      next_allowed_at: cooldownUntil.toISOString(),
    });
  }

  let result: any;
  try {
    // Garante que o serviço de inbound está ativo (idempotente)
    await nfeioEnsureInboundActive(emp.nfeio_company_id);
    result = await nfeioListInbound(emp.nfeio_company_id, emp.ultimo_nsu || "0");
  } catch (err: any) {
    const msg = err?.message || "Erro desconhecido";
    const isThrottle = /consumo indevido|429|too many requests/i.test(msg) || err?.status === 429;
    const cooldownUntil = isThrottle ? new Date(Date.now() + COOLDOWN_THROTTLE_MS).toISOString() : null;
    await supabase.from("xml_empresas").update({
      last_error: msg,
      cooldown_until: cooldownUntil,
      ultima_consulta_at: new Date().toISOString(),
    }).eq("id", empresaId);
    await logAction(supabase, { tenant_id: tenantId, empresa_id: empresaId, user_id: userId, acao: "consulta", status: "erro", mensagem: msg, error: msg });
    if (isThrottle) {
      return json({
        ok: false,
        blocked: true,
        error: "A NFE.io limitou temporariamente as consultas desta empresa. Aguarde antes de consultar novamente.",
        next_allowed_at: cooldownUntil,
      });
    }
    return json({ ok: false, error: `Erro ao consultar SEFAZ. ${msg}` });
  }

  // OData retorna em `value`; outras versões podem retornar `inboundNFes` / `documents` / `data`.
  const docs: any[] = result?.value || result?.inboundNFes || result?.documents || result?.data || [];
  let lastNsu = emp.ultimo_nsu || "0";
  let novos = 0;

  for (const d of docs) {
    const accessKey = d.accessKey || d.chaveAcesso || d.chave;
    if (!accessKey) continue;
    const nsu = String(d.nsu ?? d.NSU ?? "");
    if (nsu && Number(nsu) > Number(lastNsu)) lastNsu = nsu;

    // Tipos OData: productInvoice (completa), productInvoiceSummary (resumo), productInvoiceEvent (evento)
    const tipoDoc = String(d.type || "").toLowerCase();
    const isSummary = tipoDoc.includes("summary");
    const status_xml = isSummary ? "resumo" : "completo";

    const valorTotal = Number(
      d.totalInvoiceAmount ?? d.totals?.total ?? d.valor ?? d.valorTotal ?? 0,
    );

    const row = {
      tenant_id: tenantId,
      empresa_id: empresaId,
      chave_acesso: accessKey,
      nsu,
      numero: String(d.nfeNumber || d.number || d.numero || d.nNF || ""),
      serie: String(d.nfeSerialNumber || d.serie || d.series || ""),
      modelo: String(d.model || d.modelo || "55"),
      cnpj_emitente: (d.issuer?.federalTaxNumber || d.cnpjEmitente || "").toString(),
      nome_emitente: d.issuer?.name || d.nomeEmitente || "",
      cnpj_destinatario: (d.buyer?.federalTaxNumber || d.recipient?.federalTaxNumber || d.cnpjDestinatario || "").toString(),
      data_emissao: d.issuedOn || d.dataEmissao || null,
      valor_total: valorTotal,
      situacao: d.description || d.status || d.situacao || null,
      status_xml,
      xml_resumo: isSummary ? JSON.stringify(d) : null,
      xml_completo: null as string | null,
      ultima_atualizacao: new Date().toISOString(),
    };

    // Se a OData trouxer link temporário do XML, baixamos já o conteúdo completo.
    const xmlLink = d.links?.xml || d.xmlUrl;
    if (!isSummary && xmlLink) {
      try {
        const xr = await fetch(xmlLink);
        if (xr.ok) row.xml_completo = await xr.text();
      } catch { /* ignore */ }
    }

    const { error: upErr } = await supabase.from("xml_documentos").upsert(row, { onConflict: "empresa_id,chave_acesso" });
    if (!upErr) novos++;
  }


  const cooldown = docs.length === 0 ? new Date(Date.now() + COOLDOWN_MS).toISOString() : null;
  await supabase.from("xml_empresas").update({
    ultimo_nsu: lastNsu,
    ultima_consulta_at: new Date().toISOString(),
    cooldown_until: cooldown,
    last_error: null,
  }).eq("id", empresaId);

  await logAction(supabase, {
    tenant_id: tenantId, empresa_id: empresaId, user_id: userId,
    acao: "consulta", status: "ok",
    mensagem: docs.length === 0 ? "Nenhum novo XML encontrado." : `${docs.length} documento(s) processado(s)`,
    qtd_documentos: docs.length,
  });

  return json({
    ok: true,
    qtd: docs.length,
    novos,
    ultimo_nsu: lastNsu,
    mensagem: docs.length === 0 ? "Nenhum novo XML encontrado." : `${novos} XML(s) processados.`,
  });
}

async function handleManifestar(supabase: any, tenantId: string, userId: string, body: any) {
  if (!await checkPermission(supabase, userId, tenantId, "manifestar"))
    return json({ ok: false, error: "Sem permissão para manifestar." }, 403);

  const { documento_id, tipo, justificativa } = body;
  if (!documento_id || !tipo) return json({ ok: false, error: "documento_id e tipo são obrigatórios." }, 400);

  const { data: doc } = await supabase
    .from("xml_documentos")
    .select("id, chave_acesso, empresa_id")
    .eq("id", documento_id).eq("tenant_id", tenantId).maybeSingle();
  if (!doc) return json({ ok: false, error: "Documento não encontrado." }, 404);

  const { data: emp } = await supabase.from("xml_empresas").select("nfeio_company_id").eq("id", doc.empresa_id).maybeSingle();
  if (!emp?.nfeio_company_id) return json({ ok: false, error: "Empresa sem nfeio_company_id." }, 400);

  let r: any;
  try {
    r = await nfeioManifest(emp.nfeio_company_id, doc.chave_acesso, tipo, justificativa);
  } catch (err: any) {
    await supabase.from("xml_manifestacoes").insert({
      tenant_id: tenantId, documento_id, tipo, status: "erro",
      mensagem: err?.message || "falha", created_by: userId,
    });
    return json({ ok: false, error: `Falha na manifestação: ${err?.message}` }, 502);
  }

  await supabase.from("xml_manifestacoes").insert({
    tenant_id: tenantId, documento_id, tipo,
    protocolo: r?.protocol || r?.protocolo || null,
    status: r?.status || "ok",
    mensagem: r?.message || "Manifestação enviada com sucesso.",
    created_by: userId,
  });
  await supabase.from("xml_documentos").update({ status_xml: "manifestado" }).eq("id", documento_id);

  await logAction(supabase, {
    tenant_id: tenantId, empresa_id: doc.empresa_id, user_id: userId,
    acao: "manifestacao", status: "ok", mensagem: `Manifestação ${tipo} enviada.`,
  });
  return json({ ok: true, mensagem: "Manifestação enviada com sucesso." });
}

async function handleDownload(supabase: any, tenantId: string, userId: string, body: any) {
  if (!await checkPermission(supabase, userId, tenantId, "baixar"))
    return json({ ok: false, error: "Sem permissão para baixar." }, 403);

  const ids: string[] = body.ids || [];
  const single: string | null = body.id || null;
  const list = single ? [single] : ids;
  if (list.length === 0) return json({ ok: false, error: "Selecione ao menos um documento." }, 400);

  const { data: docs } = await supabase
    .from("xml_documentos")
    .select("id, chave_acesso, empresa_id, xml_completo")
    .eq("tenant_id", tenantId).in("id", list);
  if (!docs || docs.length === 0) return json({ ok: false, error: "Nada para baixar." }, 404);

  // garantir XML completo (busca da NFE.io se necessário)
  const empresasMap = new Map<string, string>();
  const { data: empresas } = await supabase.from("xml_empresas").select("id, nfeio_company_id").eq("tenant_id", tenantId);
  for (const e of empresas || []) empresasMap.set(e.id, e.nfeio_company_id);

  const files: { name: string; content: string }[] = [];
  for (const d of docs) {
    let xml = d.xml_completo;
    if (!xml) {
      const cid = empresasMap.get(d.empresa_id);
      if (cid) xml = await nfeioGetXml(cid, d.chave_acesso);
      if (xml) await supabase.from("xml_documentos").update({ xml_completo: xml, status_xml: "completo" }).eq("id", d.id);
    }
    if (xml) files.push({ name: `${d.chave_acesso}.xml`, content: xml });
  }

  if (files.length === 0) return json({ ok: false, error: "Nenhum XML completo disponível ainda. Manifeste a nota primeiro." }, 404);

  await logAction(supabase, {
    tenant_id: tenantId, user_id: userId, acao: "download", status: "ok",
    mensagem: `Download de ${files.length} XML(s)`, qtd_documentos: files.length,
  });

  if (files.length === 1 && !body.zip) {
    return new Response(files[0].content, {
      headers: { ...corsHeaders, "Content-Type": "application/xml", "Content-Disposition": `attachment; filename="${files[0].name}"` },
    });
  }
  const zip = buildZip(files);
  const zipCopy = new ArrayBuffer(zip.byteLength);
  new Uint8Array(zipCopy).set(zip);
  return new Response(new Blob([zipCopy], { type: "application/zip" }), {
    headers: { ...corsHeaders, "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="xmls-${Date.now()}.zip"` },
  });
}

// --------- Entry ---------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await getUserAndTenant(req);
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "";

    if (action === "empresa_list") return await handleEmpresaList(ctx.supabase, ctx.tenantId);
    if (action === "empresa_save") return await handleEmpresaSave(req, ctx.supabase, ctx.tenantId, ctx.user.id);
    if (action === "empresa_delete") {
      const body = await req.json().catch(() => ({}));
      return await handleEmpresaDelete(ctx.supabase, ctx.tenantId, ctx.user.id, body.id);
    }
    if (action === "consultar") {
      const body = await req.json().catch(() => ({}));
      return await handleConsultar(ctx.supabase, ctx.tenantId, ctx.user.id, body.empresa_id);
    }
    if (action === "manifestar") {
      const body = await req.json().catch(() => ({}));
      return await handleManifestar(ctx.supabase, ctx.tenantId, ctx.user.id, body);
    }
    if (action === "download") {
      const body = await req.json().catch(() => ({}));
      return await handleDownload(ctx.supabase, ctx.tenantId, ctx.user.id, body);
    }
    return json({ ok: false, error: "Ação inválida." }, 400);
  } catch (e: any) {
    const msg = e?.message || "internal_error";
    const code = msg === "missing_auth" || msg === "invalid_auth" ? 401 : msg === "no_tenant" ? 400 : 500;
    return json({ ok: false, error: msg }, code);
  }
});
