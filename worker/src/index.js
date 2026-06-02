// XML SEFAZ Worker — Distribuição DF-e via mTLS com certificado A1
// Recebe jobs da edge function `xml-api` e consulta a SEFAZ Nacional.
//
// Variáveis de ambiente obrigatórias:
//   PORT                          (Railway injeta automaticamente)
//   WORKER_SECRET                 segredo compartilhado com a edge function
//   SUPABASE_URL                  ex: https://xxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY     service role (apenas no worker, NUNCA no front)
//
// Endpoints:
//   GET  /health
//   POST /dfe/consultar           body: { empresa_id, tipo: 'NFE'|'CTE', max_lotes?: number }

import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import { createClient } from "@supabase/supabase-js";
import forge from "node-forge";
import { Agent, fetch as undiciFetch } from "undici";
import { parseStringPromise } from "xml2js";
import { z } from "zod";
import { gunzipSync } from "node:zlib";
import { Buffer } from "node:buffer";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });

const env = z
  .object({
    PORT: z.string().default("8080"),
    WORKER_SECRET: z.string().min(16, "WORKER_SECRET deve ter pelo menos 16 chars"),
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
    AMBIENTE: z.enum(["1", "2"]).default("1"), // 1=produção, 2=homologação
  })
  .parse(process.env);

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Endpoint nacional NFeDistribuicaoDFe (AN — produção/homologação)
const DFE_ENDPOINT =
  env.AMBIENTE === "1"
    ? "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx"
    : "https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx";

// -------------------------------------------------------------------- helpers

const onlyDigits = (s) => String(s ?? "").replace(/\D/g, "");

/**
 * Converte .pfx em PEM (cert + key) usando node-forge.
 */
function pfxToPem(pfxBuffer, password) {
  const p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfxBuffer.toString("binary")));
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });

  const certBag = certBags[forge.pki.oids.certBag]?.[0];
  const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
  if (!certBag || !keyBag) throw new Error("Certificado A1 inválido (cert/key não encontrados)");

  const certPem = forge.pki.certificateToPem(certBag.cert);
  const keyPem = forge.pki.privateKeyToPem(keyBag.key);
  const cnpjCert = onlyDigits(
    certBag.cert.subject.getField("CN")?.value ?? ""
  ).match(/\d{14}/)?.[0];

  const notAfter = certBag.cert.validity.notAfter;
  return { certPem, keyPem, cnpjCert, notAfter };
}

/**
 * Monta o envelope SOAP para NFeDistribuicaoDFe (modo distNSU).
 */
function buildSoapDistNSU({ cnpj, ultNSU, tipoAmbiente }) {
  const xmlBody = `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>${tipoAmbiente}</tpAmb><cUFAutor>91</cUFAutor><CNPJ>${cnpj}</CNPJ><distNSU><ultNSU>${String(ultNSU).padStart(15, "0")}</ultNSU></distNSU></distDFeInt>`;

  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body>
    <nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
      <nfeDadosMsg>${xmlBody}</nfeDadosMsg>
    </nfeDistDFeInteresse>
  </soap:Body>
</soap:Envelope>`;
}

/**
 * Decodifica conteúdo de docZip (base64+gzip) para string XML.
 */
function decodeDocZip(b64) {
  const gz = Buffer.from(b64, "base64");
  return gunzipSync(gz).toString("utf8");
}

/**
 * Faz POST SOAP mTLS na SEFAZ.
 */
async function callSefaz({ certPem, keyPem, soapBody }) {
  const dispatcher = new Agent({
    connect: { cert: certPem, key: keyPem, rejectUnauthorized: true },
  });
  const resp = await undiciFetch(DFE_ENDPOINT, {
    method: "POST",
    dispatcher,
    headers: {
      "Content-Type": "application/soap+xml; charset=utf-8",
      "SOAPAction": "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse",
    },
    body: soapBody,
  });
  const text = await resp.text();
  return { status: resp.status, text };
}

/**
 * Faz parse leve do resumo NF-e/CT-e para extrair metadados úteis.
 */
async function parseResumo(xmlText, tipo) {
  try {
    const parsed = await parseStringPromise(xmlText, { explicitArray: false, ignoreAttrs: false });
    if (tipo === "NFE") {
      const r = parsed?.resNFe ?? parsed?.nfeProc?.NFe?.infNFe ?? null;
      if (!r) return null;
      return {
        chave: r.chNFe ?? r.$?.Id?.replace(/^NFe/, "") ?? null,
        cnpj_emitente: r.CNPJ ?? null,
        nome_emitente: r.xNome ?? null,
        valor: r.vNF ? Number(r.vNF) : null,
        data_emissao: r.dhEmi ?? null,
        situacao: r.cSitNFe ?? null,
      };
    }
    if (tipo === "CTE") {
      const r = parsed?.resCTe ?? null;
      if (!r) return null;
      return {
        chave: r.chCTe ?? null,
        cnpj_emitente: r.CNPJ ?? null,
        nome_emitente: r.xNome ?? null,
        valor: r.vTPrest ? Number(r.vTPrest) : null,
        data_emissao: r.dhEmi ?? null,
        situacao: r.cSitCTe ?? null,
      };
    }
  } catch (e) {
    log.warn({ err: e.message }, "parseResumo falhou");
  }
  return null;
}

// ------------------------------------------------------- carregar certificado

async function loadCertificateForEmpresa(empresaId) {
  // 1. busca empresa + certificado vinculado
  const { data: empresa, error: e1 } = await supabase
    .from("xml_empresas")
    .select("id, tenant_id, cnpj, certificado_id, ultimo_nsu_nfe, ultimo_nsu_cte, bloqueado_ate")
    .eq("id", empresaId)
    .maybeSingle();
  if (e1 || !empresa) throw new Error("Empresa não encontrada");
  if (!empresa.certificado_id) throw new Error("Empresa sem certificado vinculado");

  const { data: cert, error: e2 } = await supabase
    .from("digital_certificates")
    .select("id, file_path, certificate_password, expires_at, cnpj")
    .eq("id", empresa.certificado_id)
    .maybeSingle();
  if (e2 || !cert) throw new Error("Certificado não encontrado");

  // 2. valida vencimento
  if (cert.expires_at && new Date(cert.expires_at) < new Date()) {
    throw new Error("Certificado digital vencido");
  }

  // 3. baixa o .pfx do storage
  const { data: file, error: e3 } = await supabase.storage
    .from("digital-certificates")
    .download(cert.file_path);
  if (e3 || !file) throw new Error("Falha ao baixar arquivo do certificado");

  const arrayBuf = await file.arrayBuffer();
  const pfxBuffer = Buffer.from(arrayBuf);

  const { certPem, keyPem, cnpjCert, notAfter } = pfxToPem(
    pfxBuffer,
    cert.certificate_password ?? ""
  );

  // 4. valida CNPJ do certificado vs empresa (matriz: primeiros 8 dígitos)
  const cnpjEmpresa = onlyDigits(empresa.cnpj);
  if (cnpjCert && cnpjEmpresa && cnpjCert.slice(0, 8) !== cnpjEmpresa.slice(0, 8)) {
    throw new Error(
      `CNPJ do certificado (${cnpjCert}) não pertence à empresa (${cnpjEmpresa})`
    );
  }

  return { empresa, cert, certPem, keyPem, cnpjCert, notAfter };
}

// ----------------------------------------------------- lock & anti-bloqueio

async function acquireLock(cnpj, empresaId, tenantId, ttlMinutes = 5) {
  const expires = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  // tenta inserir; se já existe e está válido → falha
  const { data: existing } = await supabase
    .from("xml_consulta_lock")
    .select("cnpj, expires_at")
    .eq("cnpj", cnpj)
    .maybeSingle();

  if (existing && new Date(existing.expires_at) > new Date()) {
    return { acquired: false, expires_at: existing.expires_at };
  }

  await supabase
    .from("xml_consulta_lock")
    .upsert({ cnpj, empresa_id: empresaId, tenant_id: tenantId, expires_at: expires, owner: "worker" });
  return { acquired: true, expires_at: expires };
}

async function releaseLock(cnpj) {
  await supabase.from("xml_consulta_lock").delete().eq("cnpj", cnpj);
}

async function logConsulta(row) {
  await supabase.from("xml_consulta_logs").insert(row);
}

// ----------------------------------------------------------------- handler

async function consultarDFe({ empresaId, tipo }) {
  const tipoOk = tipo === "NFE" || tipo === "CTE";
  if (!tipoOk) throw new Error("tipo inválido (use NFE ou CTE)");

  const ctx = await loadCertificateForEmpresa(empresaId);
  const cnpj = onlyDigits(ctx.empresa.cnpj);

  if (ctx.empresa.bloqueado_ate && new Date(ctx.empresa.bloqueado_ate) > new Date()) {
    throw Object.assign(new Error("Empresa em cooldown SEFAZ"), {
      code: "COOLDOWN",
      bloqueado_ate: ctx.empresa.bloqueado_ate,
    });
  }

  const lock = await acquireLock(cnpj, ctx.empresa.id, ctx.empresa.tenant_id);
  if (!lock.acquired) {
    throw Object.assign(new Error("Outra consulta em andamento para este CNPJ"), {
      code: "LOCKED",
      expires_at: lock.expires_at,
    });
  }

  try {
    const ultNSU = tipo === "NFE" ? ctx.empresa.ultimo_nsu_nfe : ctx.empresa.ultimo_nsu_cte;
    const soap = buildSoapDistNSU({ cnpj, ultNSU: ultNSU ?? "0", tipoAmbiente: env.AMBIENTE });

    const { status, text } = await callSefaz({
      certPem: ctx.certPem,
      keyPem: ctx.keyPem,
      soapBody: soap,
    });

    if (status >= 500) {
      throw new Error(`SEFAZ HTTP ${status}: serviço indisponível`);
    }

    const parsed = await parseStringPromise(text, { explicitArray: false, ignoreAttrs: false, tagNameProcessors: [(n) => n.replace(/^.*:/, "")] });
    const retorno = parsed?.Envelope?.Body?.nfeDistDFeInteresseResponse?.nfeDistDFeInteresseResult?.retDistDFeInt
      ?? parsed?.Envelope?.Body?.nfeDistDFeInteresseResponse?.nfeDistDFeInteresseResult
      ?? null;
    if (!retorno) throw new Error("Resposta da SEFAZ em formato inesperado");

    const cStat = String(retorno.cStat ?? "");
    const xMotivo = String(retorno.xMotivo ?? "");
    const ultNSURet = String(retorno.ultNSU ?? ultNSU ?? "0");
    const maxNSU = String(retorno.maxNSU ?? ultNSURet);

    // Trata cStat conhecidos -------------------------------------------------
    if (cStat === "656") {
      // consumo indevido → bloqueia empresa por 1h
      const bloqueado = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await supabase
        .from("xml_empresas")
        .update({ bloqueado_ate: bloqueado, motivo_bloqueio: `SEFAZ 656: ${xMotivo}` })
        .eq("id", empresaId);
      await logConsulta({
        tenant_id: ctx.empresa.tenant_id,
        empresa_id: empresaId,
        acao: "consultar",
        status: "bloqueado",
        tipo_consulta: tipo,
        cstat: cStat,
        xmotivo: xMotivo,
        nsu_inicial: ultNSU,
        nsu_final: ultNSURet,
        bloqueado_ate: bloqueado,
        mensagem: xMotivo,
      });
      return { ok: false, code: "656", message: xMotivo, bloqueado_ate: bloqueado };
    }

    if (cStat === "137") {
      // Nenhum documento → cooldown 1h
      const bloqueado = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await supabase
        .from("xml_empresas")
        .update({
          bloqueado_ate: bloqueado,
          motivo_bloqueio: "Nenhum documento novo (cStat 137)",
          [tipo === "NFE" ? "data_ultima_consulta_nfe" : "data_ultima_consulta_cte"]: new Date().toISOString(),
          [tipo === "NFE" ? "ultimo_nsu_nfe" : "ultimo_nsu_cte"]: ultNSURet,
        })
        .eq("id", empresaId);
      await logConsulta({
        tenant_id: ctx.empresa.tenant_id,
        empresa_id: empresaId,
        acao: "consultar",
        status: "vazio",
        tipo_consulta: tipo,
        cstat: cStat,
        xmotivo: xMotivo,
        nsu_inicial: ultNSU,
        nsu_final: ultNSURet,
        bloqueado_ate: bloqueado,
        qtd_documentos: 0,
      });
      return { ok: true, code: "137", message: "Nenhum documento novo", documentos: 0 };
    }

    if (cStat !== "138") {
      // qualquer outro código diferente de "Documento(s) localizado(s)"
      await logConsulta({
        tenant_id: ctx.empresa.tenant_id,
        empresa_id: empresaId,
        acao: "consultar",
        status: "erro",
        tipo_consulta: tipo,
        cstat: cStat,
        xmotivo: xMotivo,
        nsu_inicial: ultNSU,
        mensagem: xMotivo,
      });
      return { ok: false, code: cStat, message: xMotivo };
    }

    // 138 → temos docs ------------------------------------------------------
    const docs = retorno.loteDistDFeInt?.docZip;
    const list = Array.isArray(docs) ? docs : docs ? [docs] : [];

    let saved = 0;
    for (const item of list) {
      const nsu = item?.$?.NSU ?? null;
      const schema = item?.$?.schema ?? "";
      const b64 = typeof item === "string" ? item : item?._;
      if (!b64) continue;
      let xml;
      try {
        xml = decodeDocZip(b64);
      } catch (e) {
        log.warn({ nsu, err: e.message }, "falha ao descomprimir docZip");
        continue;
      }

      const isResumoNFe = schema.startsWith("resNFe");
      const isResumoCTe = schema.startsWith("resCTe");
      const isProcNFe = schema.startsWith("procNFe");
      const isProcCTe = schema.startsWith("procCTe");
      const tipoDoc = isResumoCTe || isProcCTe ? "CTE" : "NFE";
      const status_xml = isProcNFe || isProcCTe ? "completo" : "resumo";

      const meta = await parseResumo(xml, tipoDoc);
      const chave = meta?.chave ?? `SEM-CHAVE-${nsu}`;

      // upload no storage
      const path = `${ctx.empresa.tenant_id}/${cnpj}/${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, "0")}/${tipoDoc}/${chave}.xml`;
      await supabase.storage
        .from("xml-storage")
        .upload(path, new Blob([xml], { type: "application/xml" }), {
          upsert: true,
          contentType: "application/xml",
        });

      await supabase.from("xml_documentos").upsert(
        {
          tenant_id: ctx.empresa.tenant_id,
          empresa_id: empresaId,
          chave_acesso: chave,
          nsu,
          tipo_documento: tipoDoc,
          status_xml,
          storage_path: path,
          xml_resumo: status_xml === "resumo" ? xml : null,
          xml_completo: status_xml === "completo" ? xml : null,
          cnpj_emitente: meta?.cnpj_emitente ?? null,
          nome_emitente: meta?.nome_emitente ?? null,
          valor_total: meta?.valor ?? null,
          data_emissao: meta?.data_emissao ?? null,
          situacao: meta?.situacao ?? null,
          origem: "DISTRIBUICAO_DFE",
        },
        { onConflict: "empresa_id,chave_acesso" }
      );

      saved++;
    }

    // Atualiza NSU
    await supabase
      .from("xml_empresas")
      .update({
        [tipo === "NFE" ? "ultimo_nsu_nfe" : "ultimo_nsu_cte"]: maxNSU,
        [tipo === "NFE" ? "data_ultima_consulta_nfe" : "data_ultima_consulta_cte"]: new Date().toISOString(),
        bloqueado_ate: null,
        motivo_bloqueio: null,
      })
      .eq("id", empresaId);

    await logConsulta({
      tenant_id: ctx.empresa.tenant_id,
      empresa_id: empresaId,
      acao: "consultar",
      status: "ok",
      tipo_consulta: tipo,
      cstat: cStat,
      xmotivo: xMotivo,
      nsu_inicial: ultNSU,
      nsu_final: maxNSU,
      qtd_documentos: saved,
    });

    return { ok: true, code: cStat, message: xMotivo, documentos: saved, maxNSU };
  } finally {
    await releaseLock(cnpj);
  }
}

// ----------------------------------------------------------------- HTTP app

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(pinoHttp({ logger: log }));

function requireSecret(req, res, next) {
  const provided = req.headers["x-worker-secret"];
  if (provided !== env.WORKER_SECRET) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
}

app.get("/health", (_req, res) => res.json({ ok: true, ambiente: env.AMBIENTE }));

app.post("/dfe/consultar", requireSecret, async (req, res) => {
  const schema = z.object({
    empresa_id: z.string().uuid(),
    tipo: z.enum(["NFE", "CTE"]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  try {
    const result = await consultarDFe({
      empresaId: parsed.data.empresa_id,
      tipo: parsed.data.tipo,
    });
    res.json(result);
  } catch (err) {
    log.error({ err: err.message, code: err.code }, "consulta falhou");
    res.status(err.code === "LOCKED" || err.code === "COOLDOWN" ? 409 : 500).json({
      ok: false,
      code: err.code ?? "ERROR",
      error: err.message,
      ...(err.bloqueado_ate && { bloqueado_ate: err.bloqueado_ate }),
      ...(err.expires_at && { lock_expires_at: err.expires_at }),
    });
  }
});

const port = Number(env.PORT);
app.listen(port, () => log.info(`XML SEFAZ worker ouvindo em :${port} (amb=${env.AMBIENTE})`));
