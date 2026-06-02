import { describe, it, expect } from 'vitest';
import { detectVariables, substituteVariables } from '../variables';

describe('variables', () => {
  it('detects all variables', () => {
    expect(detectVariables('Olá {nome_contato}, protocolo {protocolo}.').sort())
      .toEqual(['nome_contato', 'protocolo']);
  });

  it('substitutes known values', () => {
    const r = substituteVariables('Olá {nome_contato}', { contact: { name: 'João' } });
    expect(r.output).toBe('Olá João');
    expect(r.missing).toEqual([]);
  });

  it('reports missing known variables and keeps placeholder', () => {
    const r = substituteVariables('Olá {nome_contato}, ticket {protocolo}', { contact: { name: 'João' } });
    expect(r.output).toBe('Olá João, ticket {protocolo}');
    expect(r.missing).toEqual(['protocolo']);
  });

  it('handles unknown variables without crashing', () => {
    const r = substituteVariables('Hi {desconhecida}', {});
    expect(r.output).toBe('Hi {desconhecida}');
    expect(r.missing).toEqual([]);
  });
});
