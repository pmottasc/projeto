import { describe, it, expect } from 'vitest';
import { parseUnicredText } from '@/lib/unicred-parser';

describe('Unicred parser', () => {
  it('ignora saldo e usa apenas débito/crédito como valor do lançamento', () => {
    const text = `
UNICRED CENTRO-SUL Sistema de Automação Unicred
Período de: 01/01/2026 a 31/01/2026
2.226,07
Data Nr.Docum. Débito Crédito Saldo
Saldo Anterior
02/01/2026 123456
52,29 2.173,78 DEB TARIFA PACOTE
03/01/2026 654321
300,00 2.473,78 CRED PIX RECEBIDO CLIENTE XPTO
`;

    const transactions = parseUnicredText(text);

    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({
      date: '20260102',
      amount: 52.29,
      type: 'DEBIT',
      description: 'DEB TARIFA PACOTE',
    });
    expect(transactions[1]).toMatchObject({
      date: '20260103',
      amount: 300,
      type: 'CREDIT',
      description: 'CRED PIX RECEBIDO CLIENTE XPTO',
    });
  });

  it('descarta linha cujo único valor seja repetição exata do saldo anterior', () => {
    const text = `
UNICRED CENTRO-SUL Sistema de Automação Unicred
Período de: 01/01/2026 a 31/01/2026
2.226,07
Data Nr.Docum. Débito Crédito Saldo
Saldo Anterior
02/01/2026 999999
2.226,07 SALDO DO DIA
`;

    const transactions = parseUnicredText(text);

    expect(transactions).toHaveLength(0);
  });
});
