/**
 * BrasilAPI - Lista oficial de bancos (COMPE/FEBRABAN)
 *
 * Endpoint: https://brasilapi.com.br/api/banks/v1
 * Sem chave de API. Cache em localStorage por 7 dias + cache em memória.
 */

export interface BrasilApiBank {
  ispb: string;          // 8 dígitos (CNPJ raiz do banco)
  name: string;          // "BCO DO BRASIL S.A."
  code: number | null;   // Código COMPE (ex: 1, 341, 756). Pode ser null para algumas instituições.
  fullName: string;      // "Banco do Brasil S.A."
}

const ENDPOINT = 'https://brasilapi.com.br/api/banks/v1';
const CACHE_KEY = 'brasilapi:banks:v1';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

let memoryCache: BrasilApiBank[] | null = null;
let inFlight: Promise<BrasilApiBank[]> | null = null;

/** Mapeamento código COMPE (string com 3 dígitos) → bankId interno usado pelos parsers */
export const COMPE_TO_BANK_ID: Record<string, string> = {
  '001': 'bb',
  '104': 'caixa',
  '237': 'bradesco',
  '341': 'itau',
  '033': 'santander',
  '756': 'sicoob',
  '748': 'sicredi',
  '136': 'unicred',
  '077': 'inter',
  '260': 'nubank',
  '336': 'c6',
  '133': 'cresol',
};

/** Lista local de fallback (usada se a BrasilAPI estiver fora) */
const FALLBACK_BANKS: BrasilApiBank[] = [
  { ispb: '00000000', name: 'BCO DO BRASIL S.A.', code: 1, fullName: 'Banco do Brasil S.A.' },
  { ispb: '00360305', name: 'CAIXA', code: 104, fullName: 'Caixa Econômica Federal' },
  { ispb: '60746948', name: 'BCO BRADESCO S.A.', code: 237, fullName: 'Banco Bradesco S.A.' },
  { ispb: '60701190', name: 'ITAÚ UNIBANCO S.A.', code: 341, fullName: 'Itaú Unibanco S.A.' },
  { ispb: '90400888', name: 'BCO SANTANDER (BRASIL) S.A.', code: 33, fullName: 'Banco Santander (Brasil) S.A.' },
  { ispb: '02038232', name: 'SICOOB', code: 756, fullName: 'Banco Cooperativo Sicoob S.A.' },
  { ispb: '01181521', name: 'SICREDI', code: 748, fullName: 'Banco Cooperativo Sicredi S.A.' },
  { ispb: '17184037', name: 'CCC UNICRED DO BRASIL', code: 136, fullName: 'Confederação Nacional das Cooperativas Centrais Unicred' },
  { ispb: '00416968', name: 'BANCO INTER', code: 77, fullName: 'Banco Inter S.A.' },
  { ispb: '18236120', name: 'NU PAGAMENTOS S.A.', code: 260, fullName: 'Nu Pagamentos S.A.' },
  { ispb: '31872495', name: 'BANCO C6 S.A.', code: 336, fullName: 'Banco C6 S.A.' },
  { ispb: '10398952', name: 'CRESOL CONFEDERAÇÃO', code: 133, fullName: 'Confederação Nacional das Cooperativas Centrais de Crédito Rural com Interação Solidária - Cresol' },
];

function pad3(code: number | string | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  const n = typeof code === 'number' ? code : parseInt(String(code).replace(/\D/g, ''), 10);
  if (Number.isNaN(n)) return null;
  return String(n).padStart(3, '0');
}

function readLocalCache(): BrasilApiBank[] | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data: BrasilApiBank[]; fetchedAt: number };
    if (!parsed?.data || !Array.isArray(parsed.data)) return null;
    if (Date.now() - parsed.fetchedAt > TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeLocalCache(data: BrasilApiBank[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, fetchedAt: Date.now() }));
  } catch {
    /* quota exceeded ou indisponível — ignora */
  }
}

/** Carrega lista de bancos (com cache em memória + localStorage + fallback). */
export async function getBanksList(): Promise<BrasilApiBank[]> {
  if (memoryCache) return memoryCache;

  const cached = readLocalCache();
  if (cached && cached.length > 0) {
    memoryCache = cached;
    return cached;
  }

  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch(ENDPOINT, { method: 'GET' });
      if (!res.ok) throw new Error(`BrasilAPI HTTP ${res.status}`);
      const data = (await res.json()) as BrasilApiBank[];
      if (!Array.isArray(data) || data.length === 0) throw new Error('Resposta vazia');
      memoryCache = data;
      writeLocalCache(data);
      return data;
    } catch {
      memoryCache = FALLBACK_BANKS;
      return FALLBACK_BANKS;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Busca banco por código COMPE (aceita "001", "1", 1). */
export async function findBankByCode(code: string | number): Promise<BrasilApiBank | null> {
  const target = pad3(code);
  if (!target) return null;
  const list = await getBanksList();
  return list.find(b => pad3(b.code) === target) ?? null;
}

/** Busca banco por CNPJ (qualquer formato). Compara raiz de 8 dígitos com o ISPB. */
export async function findBankByCnpj(cnpj: string): Promise<BrasilApiBank | null> {
  const digits = (cnpj || '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  const root = digits.slice(0, 8);
  const list = await getBanksList();
  return list.find(b => (b.ispb || '').padStart(8, '0') === root) ?? null;
}

/** Mapeia um banco da BrasilAPI para o bankId interno usado pelos parsers. */
export function bankIdFromCompe(code: number | string | null | undefined): string | null {
  const c = pad3(code);
  if (!c) return null;
  return COMPE_TO_BANK_ID[c] ?? null;
}

/** Reset usado em testes. */
export function __resetBanksCache(): void {
  memoryCache = null;
  inFlight = null;
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(CACHE_KEY);
  } catch {
    /* noop */
  }
}
