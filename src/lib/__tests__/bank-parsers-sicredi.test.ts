import { describe, it, expect } from 'vitest';
import { parseStatementSmart } from '@/lib/bank-parsers';

describe('Sicredi / layout Valor + Saldo', () => {
  const sicrediRealPdfText = [
    'Associado: SBN PARTICIPACOES LTDA',
    'Cooperativa: 2604',
    'Conta: 65735-2',
    'Extrato (Período de 01/04/2026 a 30/04/2026)',
    'Data Descrição Documento Valor (R$) Saldo (R$)',
    'SALDO ANTERIOR 0,00',
    '06/04/2026 RECEBIMENTO PIX 60884320049 GLACI MORAIS DA SILV PIX_CRED 1.500,00 1.500,00',
    '06/04/2026 APLICACAO FINANCEIRA CAPTACAO -1.400,00 100,00',
    '10/04/2026 RECEBIMENTO PIX 28041595000142 FERNANDA MACHADO PIX_CRED 1.300,00 1.400,00',
    '10/04/2026 CESTA DE RELACIONAMENTO -29,25 1.370,75',
    '10/04/2026 RECEBIMENTO PIX 05238394993 Cristiane Pacheco Lu PIX_CRED 1.302,41 2.673,16',
    '10/04/2026 APLICACAO FINANCEIRA CAPTACAO -2.573,16 100,00',
    '14/04/2026 TED 27234448000126 IMOBILIARIA QUALALUGAR LTDA 371694 5.273,02 5.373,02',
    '14/04/2026 APLICACAO FINANCEIRA CAPTACAO -5.273,02 100,00',
    '16/04/2026 PAGAMENTO PIX 45923205904 NEUSA NEVES MENDEL PIX_DEB -11.080,00 -10.980,00',
    '16/04/2026 RESG.APLIC.FIN.AVISO PREV CAPTACAO 2.373,60 -8.606,40',
    '16/04/2026 RESG.APLIC.FIN.AVISO PREV CAPTACAO 966,21 -7.640,19',
    '16/04/2026 RESG.APLIC.FIN.AVISO PREV CAPTACAO 2.588,76 -5.051,43',
    '16/04/2026 RESG.APLIC.FIN.AVISO PREV CAPTACAO 5.051,43 0,00',
    '24/04/2026 DEBITO ARRECADACAO 00394460005887 DARFC0385 DARFC0385 -268,15 -268,15',
    '24/04/2026 DEBITO ARRECADACAO 00394460005887 DARFC0385 DARFC0385 -58,10 -326,25',
    '24/04/2026 RESG.APLIC.FIN.AVISO PREV CAPTACAO 251,36 -74,89',
    '24/04/2026 RESG.APLIC.FIN.AVISO PREV CAPTACAO 74,89 0,00',
    '30/04/2026 DEBITO ARRECADACAO 00394460005887 DARFC0385 DARFC0385 -1.161,20 -1.161,20',
    '30/04/2026 DEBITO ARRECADACAO 00394460005887 DARFC0385 DARFC0385 -747,46 -1.908,66',
    '30/04/2026 RESG.APLIC.FIN.AVISO PREV CAPTACAO 1.329,32 -579,34',
    '30/04/2026 RESG.APLIC.FIN.AVISO PREV CAPTACAO 579,34 0,00',
    'Lançamentos Futuros (Próximos 30 dias)',
    'Data Descrição Valor (R$)',
    '29/05/2026 DDA - Pagar Boletos -487,14',
    '10/05/2026 CESTA EMPRESARIAL 01 -29,25',
  ].join('\n');

  it('linha com valor negativo e saldo positivo: -1.400,00 / 100,00', () => {
    const text = `01/04/2026 SALDO ANTERIOR 0,00\n06/04/2026 APLICACAO FINANCEIRA CAPTACAO -1.400,00 100,00`;
    const txs = parseStatementSmart(text);
    expect(txs).toHaveLength(1);
    expect(txs[0].type).toBe('DEBIT');
    expect(txs[0].amount).toBeCloseTo(1400);
    expect(txs[0].balance).toBeCloseTo(100);
  });

  it('linha de crédito: 1.500,00 / 1.500,00', () => {
    const text = `06/04/2026 RECEBIMENTO PIX PIX_CRED 1.500,00 1.500,00`;
    const txs = parseStatementSmart(text);
    expect(txs[0].type).toBe('CREDIT');
    expect(txs[0].amount).toBeCloseTo(1500);
    expect(txs[0].balance).toBeCloseTo(1500);
  });

  it('saldo negativo continua sendo apenas saldo', () => {
    const text = `16/04/2026 PAGAMENTO PIX PIX_DEB -11.080,00 -10.980,00`;
    const txs = parseStatementSmart(text);
    expect(txs[0].type).toBe('DEBIT');
    expect(txs[0].amount).toBeCloseTo(11080);
    expect(txs[0].balance).toBeCloseTo(-10980);
  });

  it('ignora SALDO ANTERIOR', () => {
    const text = `01/04/2026 SALDO ANTERIOR 0,00`;
    expect(parseStatementSmart(text)).toHaveLength(0);
  });

  it('ignora seção Lançamentos Futuros por padrão', () => {
    const text = [
      '06/04/2026 APLICACAO FINANCEIRA -1.400,00 100,00',
      '10/04/2026 CESTA RELACIONAMENTO -29,25 1.370,75',
      'Lançamentos Futuros',
      '20/04/2026 BOLETO FUTURO -500,00 0,00',
    ].join('\n');
    const txs = parseStatementSmart(text);
    expect(txs).toHaveLength(2);
  });

  it('processa todos os lançamentos (sem limite de 8)', () => {
    const lines: string[] = [];
    for (let d = 1; d <= 20; d++) {
      const dd = String(d).padStart(2, '0');
      lines.push(`${dd}/04/2026 LANCAMENTO ${d} -10,00 ${100 - d * 10},00`);
    }
    const txs = parseStatementSmart(lines.join('\n'));
    expect(txs.length).toBe(20);
  });

  it('processa o extrato Sicredi real sem transformar saldos em lançamentos extras', () => {
    const txs = parseStatementSmart(sicrediRealPdfText);
    expect(txs).toHaveLength(21);
    expect(txs.filter(t => t.type === 'DEBIT')).toHaveLength(9);
    expect(txs.filter(t => t.type === 'CREDIT')).toHaveLength(12);
    expect(txs[1]).toMatchObject({ type: 'DEBIT', amount: 1400, balance: 100 });
    expect(txs[8]).toMatchObject({ type: 'DEBIT', amount: 11080, balance: -10980 });
    expect(txs.some(t => /DDA|CESTA EMPRESARIAL/i.test(t.description))).toBe(false);
  });

  it('em layout Valor + Saldo não importa linha datada com apenas saldo', () => {
    const text = [
      'Data Descrição Documento Valor (R$) Saldo (R$)',
      '06/04/2026 RECEBIMENTO PIX PIX_CRED 1.500,00 1.500,00',
      '07/04/2026 SALDO DO DIA 1.500,00',
      '08/04/2026 LINHA QUE PERDEU A COLUNA VALOR 100,00',
    ].join('\n');
    const txs = parseStatementSmart(text);
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ type: 'CREDIT', amount: 1500, balance: 1500 });
  });
});
