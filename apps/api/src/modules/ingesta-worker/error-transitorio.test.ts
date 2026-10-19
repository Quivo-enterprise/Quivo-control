import { describe, expect, it } from 'vitest';
import { esErrorTransitorioDb } from './error-transitorio.js';

// Forma real con `PrismaPg` (verificada contra Postgres): SQL crudo → P2010 + SQLSTATE en meta.
const prismaRaw = (originalCode: string) => ({
  code: 'P2010',
  meta: { driverAdapterError: { cause: { originalCode, kind: 'postgres', code: originalCode } } },
});

describe('esErrorTransitorioDb', () => {
  it.each([
    ['P1001', { code: 'P1001' }],
    ['P1002', { code: 'P1002' }],
    ['P1008', { code: 'P1008' }],
    ['P1017', { code: 'P1017' }],
    ['P2024', { code: 'P2024' }],
    ['P2028', { code: 'P2028' }],
    ['P2034', { code: 'P2034' }],
    ['PrismaClientInitializationError (errorCode)', { errorCode: 'P1001' }],
    ['pg: Connection terminated unexpectedly', new Error('Connection terminated unexpectedly')],
    ['pg-pool: timeout exceeded when trying to connect', new Error('timeout exceeded when trying to connect')],
    ['pg-pool: Connection terminated due to connection timeout', new Error('Connection terminated due to connection timeout')],
    ['pg: client not queryable', new Error('Client has encountered a connection error and is not queryable')],
    ['mensaje envuelto en cause', new Error('x', { cause: new Error('Connection terminated unexpectedly') })],
    ['statement_timeout 57014 (P2010)', prismaRaw('57014')],
    ['serialization 40001', prismaRaw('40001')],
    ['deadlock 40P01', prismaRaw('40P01')],
    ['too many connections 53300', prismaRaw('53300')],
    ['conexión 08006', prismaRaw('08006')],
    ['failover 57P01', prismaRaw('57P01')],
    ['ECONNRESET', Object.assign(new Error('x'), { code: 'ECONNRESET' })],
    ['ECONNREFUSED', Object.assign(new Error('x'), { code: 'ECONNREFUSED' })],
    ['ETIMEDOUT', Object.assign(new Error('x'), { code: 'ETIMEDOUT' })],
    ['envuelto en cause', new Error('x', { cause: { code: 'P1017' } })],
  ])('%s → transitorio', (_nombre, error) => {
    expect(esErrorTransitorioDb(error)).toBe(true);
  });

  it.each([
    ['violación de FK 23503', prismaRaw('23503')],
    ['columna inexistente P2022', { code: 'P2022', meta: { driverAdapterError: { cause: { originalCode: '42703', kind: 'ColumnNotFound' } } } }],
    ['unique P2002', { code: 'P2002' }],
    ['Error genérico', new Error('Punto de control no encontrado')],
    ['string', 'P1001'],
    ['null', null],
    ['undefined', undefined],
  ])('%s → permanente', (_nombre, error) => {
    expect(esErrorTransitorioDb(error)).toBe(false);
  });
});
