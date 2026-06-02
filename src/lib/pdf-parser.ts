/**
 * PDF Parser - Extrai texto estruturado de PDFs de extratos bancários
 * Utiliza pdf.js para leitura client-side
 */
import * as pdfjsLib from 'pdfjs-dist';

// Configurar worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs`;

export interface ExtractedTransaction {
  date: string;        // Data original do lançamento (YYYYMMDD)
  description: string; // Histórico/Descrição
  document: string;    // Número do documento (se houver)
  amount: number;      // Valor numérico normalizado
  type: 'CREDIT' | 'DEBIT'; // Tipo da transação
  balance?: number;    // Saldo (opcional)
}

export interface PDFExtractionResult {
  transactions: ExtractedTransaction[];
  bankDetected: string | null;
  accountId: string | null;
  agencyId: string | null;
  startDate: string | null;
  endDate: string | null;
  rawText: string;
}

/**
 * Extrai todo o texto de um PDF preservando a estrutura de linhas
 */
export async function extractTextFromPDF(file: File): Promise<string[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    // Agrupar itens por linha (baseado na posição Y com tolerância)
    const items = textContent.items as Array<{ str: string; transform: number[]; width: number }>;
    const lines: Map<number, { x: number; text: string }[]> = new Map();

    items.forEach(item => {
      if (!item.str.trim()) return;
      const y = Math.round(item.transform[5]);
      const x = Math.round(item.transform[4]);

      let lineY = y;
      for (const existingY of lines.keys()) {
        if (Math.abs(existingY - y) <= 2) {
          lineY = existingY;
          break;
        }
      }

      if (!lines.has(lineY)) lines.set(lineY, []);
      lines.get(lineY)!.push({ x, text: item.str });
    });

    const sortedLines = Array.from(lines.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) => {
        const sorted = items.sort((a, b) => a.x - b.x);
        let line = '';
        for (let j = 0; j < sorted.length; j++) {
          if (j > 0) {
            const gap = sorted[j].x - (sorted[j - 1].x + sorted[j - 1].text.length * 4);
            line += gap > 20 ? '  ' : ' ';
          }
          line += sorted[j].text;
        }
        return line.trim();
      })
      .filter(line => line.length > 0);

    pages.push(sortedLines.join('\n'));
  }

  return pages;
}

/**
 * Detecta o banco a partir do texto do PDF.
 * IMPORTANTE: termos únicos vêm primeiro; o BB fica por último porque
 * "extrato de conta corrente" é uma expressão genérica usada por muitos bancos.
 */
export function detectBank(text: string): string | null {
  const lower = text.toLowerCase();
  const bankPatterns: [string, string[]][] = [
    ['cresol', ['cresol']],
    ['unicred', ['unicred', 'sistema de automação unicred', 'sistema de automacao unicred']],
    ['sicoob', ['sicoob', 'sisbr', 'cooperativas de cr', 'sistema de cooperativas de cr']],
    ['sicredi', ['sicredi']],
    ['nubank', ['nubank', 'nu pagamentos']],
    ['inter', ['banco inter', 'inter s.a', 'bancointer']],
    ['c6', ['c6 bank', 'c6 s.a', 'banco c6']],
    ['caixa', ['caixa econ', 'caixa economica', 'cef']],
    ['bradesco', ['bradesco']],
    ['itau', ['itaú', 'itau unibanco', 'banco itaú', 'banco itau']],
    ['santander', ['santander']],
    ['bb', ['banco do brasil', 'bb s.a', 'bb.com.br']],
  ];

  for (const [bankId, patterns] of bankPatterns) {
    if (patterns.some(p => lower.includes(p))) return bankId;
  }

  // Heurísticas adicionais para Cresol (PDFs onde o nome só aparece como logo):
  //   - "Saldo do Dia: + R$ ..." é assinatura do extrato Cresol
  //   - "Saldo em Conta" + "Limite de Crédito" + "Saldo Disponível" no cabeçalho
  if (
    /saldo\s+do\s+dia\s*:?\s*[+\-−]\s*r\$/i.test(text) ||
    (/saldo\s+em\s+conta/i.test(text) &&
      /limite\s+de\s+cr[eé]dito/i.test(text) &&
      /saldo\s+dispon[ií]vel/i.test(text))
  ) {
    return 'cresol';
  }

  return null;
}

// ---------- Detecção avançada (com BrasilAPI) ----------

export type BankConfidence = 'high' | 'medium' | 'low';
export type BankMatchedBy = 'name' | 'compe' | 'cnpj' | 'heuristic' | null;

export interface BankDetection {
  bankId: string | null;        // id interno (sicoob, itau, ...). null se não houver parser dedicado.
  compeCode: string | null;     // 3 dígitos (ex: '341')
  bankName: string | null;      // nome oficial (BrasilAPI) quando disponível
  confidence: BankConfidence;
  matchedBy: BankMatchedBy;
}

/**
 * Detecta o banco em camadas:
 *   1) Nome textual (heurística existente)        → high
 *   2) Código COMPE encontrado no texto + BrasilAPI → high
 *   3) CNPJ raiz + BrasilAPI                       → medium
 *   4) Heurísticas específicas (ex: Cresol)        → medium
 *   5) Nada                                        → low
 */
export async function detectBankAdvanced(text: string): Promise<BankDetection> {
  // Import dinâmico evita ciclo e mantém a função sync legada leve.
  const { findBankByCode, findBankByCnpj, bankIdFromCompe } = await import('./brasilapi-banks');

  // 1. Nome textual (forte)
  const byName = detectBank(text);
  if (byName) {
    // Tenta enriquecer com nome oficial via COMPE conhecido.
    const compeReverse: Record<string, string> = {
      bb: '001', caixa: '104', bradesco: '237', itau: '341', santander: '033',
      sicoob: '756', sicredi: '748', unicred: '136', inter: '077',
      nubank: '260', c6: '336', cresol: '133',
    };
    const compe = compeReverse[byName] ?? null;
    let bankName: string | null = null;
    if (compe) {
      const b = await findBankByCode(compe);
      bankName = b?.fullName ?? b?.name ?? null;
    }
    return { bankId: byName, compeCode: compe, bankName, confidence: 'high', matchedBy: 'name' };
  }

  // 2. Código COMPE no PDF (ex: "Banco 341", "001-9", "748-X")
  const compeMatches = new Set<string>();
  const reA = /\bbanco\s*[:\-]?\s*(\d{3})\b/gi;
  const reB = /\b(\d{3})\s*[-–]\s*[0-9Xx]\b/g;
  let m: RegExpExecArray | null;
  while ((m = reA.exec(text)) !== null) compeMatches.add(m[1]);
  while ((m = reB.exec(text)) !== null) compeMatches.add(m[1]);

  for (const code of compeMatches) {
    const bank = await findBankByCode(code);
    if (bank) {
      const internal = bankIdFromCompe(bank.code);
      return {
        bankId: internal,
        compeCode: String(bank.code).padStart(3, '0'),
        bankName: bank.fullName || bank.name,
        confidence: 'high',
        matchedBy: 'compe',
      };
    }
  }

  // 3. CNPJ raiz no texto
  const cnpjRe = /(\d{2})[.\-]?(\d{3})[.\-]?(\d{3})[\/\-]?(\d{4})[.\-]?(\d{2})/g;
  const cnpjs = new Set<string>();
  while ((m = cnpjRe.exec(text)) !== null) {
    cnpjs.add(`${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}`);
  }
  for (const cnpj of cnpjs) {
    const bank = await findBankByCnpj(cnpj);
    if (bank) {
      const internal = bankIdFromCompe(bank.code);
      return {
        bankId: internal,
        compeCode: bank.code != null ? String(bank.code).padStart(3, '0') : null,
        bankName: bank.fullName || bank.name,
        confidence: 'medium',
        matchedBy: 'cnpj',
      };
    }
  }

  // 4. Heurísticas específicas embutidas em detectBank (Cresol). Já tratadas acima.
  // 5. Nada.
  return { bankId: null, compeCode: null, bankName: null, confidence: 'low', matchedBy: null };
}

/**
 * Extrai conta bancária do texto.
 */
export function extractAccountId(text: string): string | null {
  // Cresol: "Agência 2661 Conta 010628-3"
  const cresolMatch = text.match(/Ag[eê]ncia\s+\d+\s+Conta\s+(\d{3,}-\d)/i);
  if (cresolMatch) return cresolMatch[1];

  // Unicred: "Conta: 075082-4 - NOME"
  const unicredMatch = text.match(/Conta\s*:\s*(\d{3,}-\d)/i);
  if (unicredMatch) return unicredMatch[1];

  // Sicoob: "Conta: 80.137-2 / NOME"
  const sicoobMatch = text.match(/Conta\s*:\s*([\d\.\-]+)/i);
  if (sicoobMatch) return sicoobMatch[1];

  // BB: "Conta corrente 62220-6"
  const bbMatch = text.match(/Conta\s+corrente\s+([\d\.\-]+)/i);
  if (bbMatch) return bbMatch[1];

  const patterns = [
    /ag[eê]ncia[:\s]*(\d[\d.\-\/]*\d)\s*conta[:\s]*(\d[\d.\-\/]*\d)/i,
    /conta[:\s]*(\d[\d.\-\/]*\d)/i,
  ];

  for (const pat of patterns) {
    const match = text.match(pat);
    if (match) return match[1];
  }
  return null;
}

/**
 * Extrai agência (ou cooperativa) do texto.
 */
export function extractAgencyId(text: string): string | null {
  // Sicoob: "Cooperativa: 3242-5 / NOME"
  const sicoobMatch = text.match(/Cooperativa\s*:\s*([\d\.\-]+)/i);
  if (sicoobMatch) return sicoobMatch[1];

  // BB: "Agência 201-1"
  const bbMatch = text.match(/Ag[eê]ncia\s*:?\s*([\d\.\-]+)/i);
  if (bbMatch) return bbMatch[1];
  return null;
}

/**
 * Extrai período do extrato.
 */
export function extractPeriod(text: string): { start: string | null; end: string | null } {
  // BB: "de 01 / 12 / 2025 até 31 / 12 / 2025"
  const bbMatch = text.match(/de\s+(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})\s+at[eé]\s+(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/i);
  if (bbMatch) {
    const start = `${bbMatch[3]}${bbMatch[2].padStart(2, '0')}${bbMatch[1].padStart(2, '0')}`;
    const end = `${bbMatch[6]}${bbMatch[5].padStart(2, '0')}${bbMatch[4].padStart(2, '0')}`;
    return { start, end };
  }

  // Unicred: "Período de: 01/01/2026 a 31/01/2026"
  const unicredMatch = text.match(/Per[ií]odo\s+de\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})\s+a\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (unicredMatch) {
    const parseDate = (d: string) => {
      const [day, month, year] = d.split('/');
      return `${year}${month.padStart(2, '0')}${day.padStart(2, '0')}`;
    };
    return { start: parseDate(unicredMatch[1]), end: parseDate(unicredMatch[2]) };
  }

  // Sicoob/genérico: "Periodo: 01/03/2026 - 31/03/2026"
  const sicoobMatch = text.match(/per[ií]odo\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*(?:-|–|a|até|à)\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (sicoobMatch) {
    const parseDate = (d: string) => {
      const [day, month, year] = d.split('/');
      return `${year}${month.padStart(2, '0')}${day.padStart(2, '0')}`;
    };
    return { start: parseDate(sicoobMatch[1]), end: parseDate(sicoobMatch[2]) };
  }

  // Genérico: "DD/MM/YYYY a DD/MM/YYYY"
  const genericMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*(?:a|até|à|-|–)\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (genericMatch) {
    const parseDate = (d: string) => {
      const [day, month, year] = d.split('/');
      return `${year}${month.padStart(2, '0')}${day.padStart(2, '0')}`;
    };
    return { start: parseDate(genericMatch[1]), end: parseDate(genericMatch[2]) };
  }

  // Cresol: "01 de Abril de 2026 a 30 de Abril de 2026"
  const MESES: Record<string, string> = {
    janeiro: '01', fevereiro: '02', marco: '03', 'março': '03', abril: '04',
    maio: '05', junho: '06', julho: '07', agosto: '08', setembro: '09',
    outubro: '10', novembro: '11', dezembro: '12',
  };
  const cresolMatch = text.match(
    /(\d{1,2})\s+de\s+([A-Za-zçÇ]+)\s+de\s+(\d{4})\s+a\s+(\d{1,2})\s+de\s+([A-Za-zçÇ]+)\s+de\s+(\d{4})/i,
  );
  if (cresolMatch) {
    const m1 = MESES[cresolMatch[2].toLowerCase()];
    const m2 = MESES[cresolMatch[5].toLowerCase()];
    if (m1 && m2) {
      return {
        start: `${cresolMatch[3]}${m1}${cresolMatch[1].padStart(2, '0')}`,
        end: `${cresolMatch[6]}${m2}${cresolMatch[4].padStart(2, '0')}`,
      };
    }
  }

  return { start: null, end: null };
}
