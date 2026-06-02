import { describe, it, expect } from 'vitest';
import { parseStatementByBank } from '@/lib/bank-parsers';

describe('Cresol parser', () => {
  it('classifica + como CRÉDITO e − como DÉBITO numa mesma linha', () => {
    const text = `
30/04/2026
Saldo do Dia: + R$ 5.441,70
30/04/2026 PAGAMENTO DE TÍTULOS - IB DUOS INDUSTRIA E COMERCIO DE B - R$ 7.680,46
27/04/2026 PIX CREDITO DE: CAMILA SORATO FRATONI HAMES + R$ 60,00
27/04/2026 PIX DEBITO PARA: SILVIERI SUPERMERC - 25/04 - R$ 1,00
`;
    const r = parseStatementByBank(text, 'cresol');
    expect(r).toHaveLength(3);
    expect(r[0]).toMatchObject({ date: '20260430', type: 'DEBIT', amount: 7680.46 });
    expect(r[1]).toMatchObject({ date: '20260427', type: 'CREDIT', amount: 60 });
    expect(r[2]).toMatchObject({ date: '20260427', type: 'DEBIT', amount: 1 });
  });

  it('detecta valor quando o sinal+R$+valor caem na linha seguinte', () => {
    const text = `
27/04/2026 PIX DEBITO PARA: SILVIERI SUPERMERC - 25/04
- R$ 1,00
23/04/2026 PIX CREDITO INTERCOOPERATIVO DE: EDIVALDO BRESSAN SIMAO
+ R$ 300,00
`;
    const r = parseStatementByBank(text, 'cresol');
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ type: 'DEBIT', amount: 1 });
    expect(r[1]).toMatchObject({ type: 'CREDIT', amount: 300 });
  });

  it('junta descrição quebrada em múltiplas linhas mantendo o tipo correto', () => {
    const text = `
23/04/2026 PIX DEBITO PARA: MARIA EDUARDA
FONTANELA DA
- R$ 47,32
`;
    const r = parseStatementByBank(text, 'cresol');
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe('DEBIT');
    expect(r[0].amount).toBe(47.32);
    expect(r[0].description).toContain('MARIA EDUARDA');
    expect(r[0].description).toContain('FONTANELA DA');
  });

  it('NUNCA importa Saldo do Dia / Saldo Anterior / Saldo em Conta', () => {
    const text = `
Saldo em Conta R$ 5.441,70
30/04/2026
Saldo do Dia: + R$ 5.441,70
30/04/2026 PIX CREDITO DE: TESTE + R$ 10,00
Saldo Anterior: + R$ 10.882,43
`;
    const r = parseStatementByBank(text, 'cresol');
    expect(r).toHaveLength(1);
    expect(r[0].description).toContain('TESTE');
    expect(r[0].type).toBe('CREDIT');
  });

  it('amostra completa: totais batem com débitos e créditos esperados', () => {
    const text = `
CRESOL CICLES DELA VEDOVA LTDA
Agência 2661 Conta 010628-3
01 de Abril de 2026 a 30 de Abril de 2026
Lançamentos
30/04/2026
Saldo do Dia: + R$ 5.441,70
30/04/2026 PAGAMENTO DE TÍTULOS - IB DUOS - R$ 7.680,46
27/04/2026 PIX CREDITO DE: CAMILA + R$ 60,00
27/04/2026 PIX DEBITO PARA: SILVIERI - R$ 1,00
23/04/2026 PIX DEBITO PARA: MARIA EDUARDA - R$ 47,32
23/04/2026 PIX CREDITO INTERCOOPERATIVO DE: EDIVALDO + R$ 300,00
20/04/2026 PAGAMENTO DE TÍTULOS - IB ASSOCIACAO - R$ 44,93
20/04/2026 PIX CREDITO INTERCOOPERATIVO DE: MARILEIA + R$ 500,00
07/04/2026 TARIFA SERVICOS COBRANCA BOLETO 133 - R$ 2,50
07/04/2026 CRÉDITO TÍTULOS COBRANÇA PRÓPRIA + R$ 285,00
Saldo Anterior: + R$ 10.882,43
`;
    const r = parseStatementByBank(text, 'cresol');
    const credits = r.filter(t => t.type === 'CREDIT');
    const debits = r.filter(t => t.type === 'DEBIT');
    const sumC = credits.reduce((s, t) => s + t.amount, 0);
    const sumD = debits.reduce((s, t) => s + t.amount, 0);

    expect(credits).toHaveLength(4);
    expect(debits).toHaveLength(5);
    expect(sumC).toBeCloseTo(1145, 2);
    expect(sumD).toBeCloseTo(7776.21, 2);
  });
});
