import forge from 'node-forge';

export interface CertInfo {
  notAfter?: Date;
  notBefore?: Date;
  subjectCN?: string;
  cnpj?: string;
}

const extractCnpj = (text: string): string | undefined => {
  const m = text.match(/(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/);
  return m ? m[1].replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : undefined;
};

const fromX509 = (cert: forge.pki.Certificate): CertInfo => {
  const cnAttr = cert.subject.getField('CN');
  const cn = cnAttr?.value as string | undefined;
  return {
    notBefore: cert.validity.notBefore,
    notAfter: cert.validity.notAfter,
    subjectCN: cn,
    cnpj: cn ? extractCnpj(cn) : undefined,
  };
};

const parsePfx = (buffer: ArrayBuffer, password: string): CertInfo | null => {
  try {
    const bytes = new Uint8Array(buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const asn1 = forge.asn1.fromDer(bin);
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
    const bags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const cert = bags[forge.pki.oids.certBag]?.[0]?.cert;
    if (!cert) return null;
    return fromX509(cert);
  } catch {
    return null;
  }
};

const parsePemOrDer = (buffer: ArrayBuffer): CertInfo | null => {
  const bytes = new Uint8Array(buffer);
  // try PEM
  try {
    const text = new TextDecoder().decode(bytes);
    if (text.includes('BEGIN CERTIFICATE')) {
      const cert = forge.pki.certificateFromPem(text);
      return fromX509(cert);
    }
  } catch {}
  // try DER
  try {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const asn1 = forge.asn1.fromDer(bin);
    const cert = forge.pki.certificateFromAsn1(asn1);
    return fromX509(cert);
  } catch {}
  return null;
};

export const parseCertificate = async (file: File, password = ''): Promise<CertInfo | null> => {
  const buf = await file.arrayBuffer();
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'pfx' || ext === 'p12') {
    // Try given password, then empty
    return parsePfx(buf, password) || (password ? parsePfx(buf, '') : null);
  }
  if (ext === 'cer' || ext === 'crt' || ext === 'pem') {
    return parsePemOrDer(buf);
  }
  return null;
};
