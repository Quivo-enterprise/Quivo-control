import { beforeEach, describe, expect, it, vi } from 'vitest';

const openDatabaseAsyncMock = vi.fn();

vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: (...args: unknown[]) => openDatabaseAsyncMock(...args),
}));

vi.mock('@sentry/react-native', () => ({
  addBreadcrumb: vi.fn(),
}));

import { abrirSqlite } from './abrir-sqlite';

describe('abrirSqlite', () => {
  beforeEach(() => {
    openDatabaseAsyncMock.mockReset();
  });

  it('abre a la primera sin reintentar', async () => {
    const db = { id: 'db' };
    openDatabaseAsyncMock.mockResolvedValueOnce(db);
    await expect(abrirSqlite('x.db', { useNewConnection: true })).resolves.toBe(db);
    expect(openDatabaseAsyncMock).toHaveBeenCalledTimes(1);
    expect(openDatabaseAsyncMock).toHaveBeenCalledWith('x.db', { useNewConnection: true });
  });

  it('reintenta una vez si es la carrera de mkdirs', async () => {
    const db = { id: 'db' };
    openDatabaseAsyncMock
      .mockRejectedValueOnce(
        new Error(
          "Couldn't create directory '/data/user/0/app/files/SQLite'. Path already points to a non-normal file.",
        ),
      )
      .mockResolvedValueOnce(db);
    await expect(abrirSqlite('x.db')).resolves.toBe(db);
    expect(openDatabaseAsyncMock).toHaveBeenCalledTimes(2);
  });

  it('no reintenta otros errores', async () => {
    openDatabaseAsyncMock.mockRejectedValue(new Error('disco lleno'));
    await expect(abrirSqlite('x.db')).rejects.toThrow('disco lleno');
    expect(openDatabaseAsyncMock).toHaveBeenCalledTimes(1);
  });
});
