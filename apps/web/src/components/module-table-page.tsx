'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  ConfirmDialog,
  DataTable,
  FormField,
  FormGroup,
  Input,
  Loader,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  type DataColumn,
  type SelectOption,
} from '@quivo/design-system';

export interface EntityFieldConfig {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'select';
  options?: SelectOption[];
  required?: boolean;
}

/** CRUD real contra `apps/api` (QUI-220..224) — sin `delete` porque ningún endpoint de M1
 * lo expone (los registros se desactivan vía `estado`, nunca se borran). Cuando se pasa
 * `dataSource`, `ModuleTablePage` reemplaza el `useState` local por estas tres funciones. */
export interface ModuleDataSource<T> {
  list: () => Promise<T[]>;
  create: (values: Record<string, unknown>) => Promise<T>;
  update: (id: string, values: Record<string, unknown>) => Promise<T>;
}

interface ModuleTablePageProps<T extends Record<string, unknown>> {
  title: string;
  subtitle?: string;
  /** Singular, en minúscula (ej. "sindicato") — se usa en los botones y diálogos. */
  entityLabel: string;
  columns: DataColumn<T>[];
  /** Ignorado si se pasa `dataSource` — ese caso arranca vacío y hace `list()` al montar. */
  initialRows?: T[];
  searchPlaceholder?: string;
  searchKeys: (keyof T)[];
  fields: EntityFieldConfig[];
  createDefaults?: Record<string, unknown>;
  dataSource?: ModuleDataSource<T>;
}

function toFormValues(row: Record<string, unknown> | null, fields: EntityFieldConfig[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    const raw = row ? row[field.key] : undefined;
    values[field.key] = raw === null || raw === undefined ? '' : String(raw);
  }
  return values;
}

/**
 * Patrón compartido de lista+CRUD para los módulos de M1 (Sindicatos, Socios, Vehículos,
 * etc.): PageHeader + búsqueda + DataTable + modal de alta/edición, con componentes de
 * @quivo/design-system. Dos modos:
 *
 * - **Demo** (sin `dataSource`): todo vive en `useState` de este componente — se usa en los
 *   módulos que todavía no tienen API real (rotaciones, reglas, auditoría). Incluye borrado.
 * - **Real** (con `dataSource`): `list()` al montar, `create`/`update` contra la API. Sin
 *   borrado (ningún endpoint de M1 lo expone — se desactiva vía el campo `estado`).
 */
export function ModuleTablePage<T extends Record<string, unknown>>({
  title,
  subtitle,
  entityLabel,
  columns,
  initialRows,
  searchPlaceholder = 'Buscar...',
  searchKeys,
  fields,
  createDefaults = {},
  dataSource,
}: ModuleTablePageProps<T>) {
  const [rows, setRows] = useState<T[]>(initialRows ?? []);
  const [query, setQuery] = useState('');
  const [editingRow, setEditingRow] = useState<T | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [deletingRow, setDeletingRow] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(dataSource !== undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!dataSource) {
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    dataSource
      .list()
      .then((data) => {
        if (!cancelled) {
          setRows(data);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Error al cargar los datos');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dataSource]);

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return rows;
    }
    return rows.filter((row) =>
      searchKeys.some((key) => String(row[key] ?? '').toLowerCase().includes(normalized)),
    );
  }, [rows, query, searchKeys]);

  const openCreate = () => {
    setFormError(null);
    setFormValues(toFormValues(createDefaults, fields));
    setIsCreating(true);
  };

  const openEdit = (row: T) => {
    setFormError(null);
    setFormValues(toFormValues(row, fields));
    setEditingRow(row);
  };

  const closeForm = () => {
    setIsCreating(false);
    setEditingRow(null);
    setFormError(null);
  };

  const handleFieldChange = (key: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = formValues[field.key] ?? '';
      parsed[field.key] = field.kind === 'number' ? Number(raw) : raw;
    }

    if (dataSource) {
      setIsSaving(true);
      setFormError(null);
      const request = editingRow
        ? dataSource.update(String(editingRow.id), parsed)
        : dataSource.create({ ...createDefaults, ...parsed });
      request
        .then((saved) => {
          setRows((prev) =>
            editingRow ? prev.map((row) => (row === editingRow ? saved : row)) : [saved, ...prev],
          );
          closeForm();
        })
        .catch((error: unknown) => {
          setFormError(error instanceof Error ? error.message : 'Error al guardar');
        })
        .finally(() => setIsSaving(false));
      return;
    }

    if (editingRow) {
      const updated = { ...editingRow, ...parsed } as T;
      setRows((prev) => prev.map((row) => (row === editingRow ? updated : row)));
    } else {
      const newRow = {
        id: `${entityLabel}-${Date.now()}`,
        ...createDefaults,
        ...parsed,
      } as unknown as T;
      setRows((prev) => [newRow, ...prev]);
    }
    closeForm();
  };

  const handleDeleteConfirm = () => {
    if (!deletingRow) {
      return;
    }
    setRows((prev) => prev.filter((row) => row !== deletingRow));
    setDeletingRow(null);
  };

  const isFormOpen = isCreating || editingRow !== null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <Button onClick={openCreate} style={{ textTransform: 'capitalize' }}>
            Nuevo {entityLabel}
          </Button>
        }
      />
      <SearchInput
        placeholder={searchPlaceholder}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onClear={() => setQuery('')}
      />
      {loadError && <Alert variant="danger" title="No se pudo cargar">{loadError}</Alert>}
      {isLoading ? (
        <Loader label={`Cargando ${entityLabel}s...`} />
      ) : (
        <DataTable
          columns={columns}
          rows={filteredRows}
          empty={query ? `Sin resultados para "${query}".` : 'Sin registros para mostrar.'}
          actions={(row) => (
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
                Editar
              </Button>
              {!dataSource && (
                <Button variant="ghost" size="sm" onClick={() => setDeletingRow(row)}>
                  Eliminar
                </Button>
              )}
            </div>
          )}
        />
      )}

      <Modal
        open={isFormOpen}
        title={editingRow ? `Editar ${entityLabel}` : `Nuevo ${entityLabel}`}
        description={
          dataSource
            ? undefined
            : 'Cambios de demo — no se persisten en un backend real.'
        }
        onClose={closeForm}
        footer={
          <>
            <Button variant="ghost" onClick={closeForm} disabled={isSaving}>
              Cancelar
            </Button>
            <Button type="submit" form="entity-form" disabled={isSaving}>
              {isSaving ? 'Guardando...' : 'Guardar'}
            </Button>
          </>
        }
      >
        {formError && (
          <Alert variant="danger" title="No se pudo guardar" style={{ marginBottom: '1rem' }}>
            {formError}
          </Alert>
        )}
        <FormGroup id="entity-form" onSubmit={handleSubmit}>
          {fields.map((field) => (
            <FormField key={field.key} label={field.label} htmlFor={field.key} required={field.required}>
              {field.kind === 'select' ? (
                <Select
                  id={field.key}
                  name={field.key}
                  options={field.options ?? []}
                  value={formValues[field.key] ?? ''}
                  onChange={(event) => handleFieldChange(field.key, event.target.value)}
                />
              ) : (
                <Input
                  id={field.key}
                  name={field.key}
                  type={field.kind === 'number' ? 'number' : 'text'}
                  value={formValues[field.key] ?? ''}
                  onChange={(event) => handleFieldChange(field.key, event.target.value)}
                  required={field.required}
                />
              )}
            </FormField>
          ))}
        </FormGroup>
      </Modal>

      {!dataSource && (
        <ConfirmDialog
          open={deletingRow !== null}
          title={`Eliminar ${entityLabel}`}
          message="Acción de demo — no borra nada real; recargá la página para restaurar los datos de ejemplo."
          confirmLabel="Eliminar"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeletingRow(null)}
        />
      )}
    </div>
  );
}
