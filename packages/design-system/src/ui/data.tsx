'use client';

import type { ReactNode } from 'react';
import { cx } from '../utils.js';
import type { DataColumn } from '../types.js';
import { Loader, Tag } from './primitives.js';

/* ---------------------------------------------------------------------------------------
 * DataTable — tabla genérica de listado usada por `module-table-page.tsx` y por cada página
 * a medida (rutas, rotaciones, reportes...).
 * ------------------------------------------------------------------------------------- */

export interface DataTableProps<T> {
  columns: DataColumn<T>[];
  rows: T[];
  empty?: string;
  actions?: (row: T) => ReactNode;
  loading?: boolean;
  error?: string;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  empty = 'Sin registros para mostrar.',
  actions,
  loading,
  error,
  className,
}: DataTableProps<T>) {
  const colSpan = columns.length + (actions ? 1 : 0);
  return (
    <div className={cx('qv-table-wrap', className)}>
      <table className="qv-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.header}</th>
            ))}
            {actions && (
              <th className="qv-table__actions-header">
                <span className="qv-visually-hidden">Acciones</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={colSpan} className="qv-table__status">
                <Loader label="Cargando..." />
              </td>
            </tr>
          ) : error ? (
            <tr>
              <td colSpan={colSpan} className="qv-table__status qv-table__status--error">
                {error}
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="qv-table__status">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => {
              const identifiable = row as { id?: string | number };
              return (
                <tr key={identifiable.id ?? index}>
                  {columns.map((column) => (
                    <td key={column.key}>
                      {column.render
                        ? column.render(row)
                        : String((row as Record<string, unknown>)[column.key] ?? '')}
                    </td>
                  ))}
                  {actions && <td className="qv-table__actions">{actions(row)}</td>}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------
 * AuditLog — shape fijo de `audit_log` (fecha/usuario/acción/detalle). `/auditoria` (QUI-248)
 * es el único consumidor; el resto de listados de solo-lectura usa `DataTable` genérico
 * (ver comentario en `apps/web/docs/handoff.md`).
 * ------------------------------------------------------------------------------------- */

export interface AuditLogEntryView {
  id: string;
  action: string;
  user: string;
  timestamp: string;
  details: string;
}

export interface AuditLogProps {
  loading?: boolean;
  logs: AuditLogEntryView[];
  actions?: (log: AuditLogEntryView) => ReactNode;
  className?: string;
}

export function AuditLog({ loading, logs, actions, className }: AuditLogProps) {
  const colSpan = 4 + (actions ? 1 : 0);
  return (
    <div className={cx('qv-table-wrap', className)}>
      <table className="qv-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Usuario</th>
            <th>Acción</th>
            <th>Detalle</th>
            {actions && (
              <th className="qv-table__actions-header">
                <span className="qv-visually-hidden">Acciones</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={colSpan} className="qv-table__status">
                <Loader label="Cargando auditoría..." />
              </td>
            </tr>
          ) : logs.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="qv-table__status">
                Sin eventos para mostrar.
              </td>
            </tr>
          ) : (
            logs.map((log) => (
              <tr key={log.id}>
                <td>{log.timestamp}</td>
                <td>{log.user}</td>
                <td>
                  <Tag>{log.action}</Tag>
                </td>
                <td>{log.details}</td>
                {actions && <td className="qv-table__actions">{actions(log)}</td>}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
