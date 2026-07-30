'use client';

import { useMemo, useState, type FormEvent } from 'react';
import {
  Button,
  ConfirmDialog,
  DataTable,
  FormField,
  FormGroup,
  Input,
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

interface ModuleTablePageProps<T extends Record<string, unknown>> {
  title: string;
  subtitle?: string;
  /** Singular, en minúscula (ej. "sindicato") — se usa en los botones y diálogos. */
  entityLabel: string;
  columns: DataColumn<T>[];
  initialRows: T[];
  searchPlaceholder?: string;
  searchKeys: (keyof T)[];
  fields: EntityFieldConfig[];
  createDefaults?: Record<string, unknown>;
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
 * Patrón compartido de lista+CRUD para los módulos de M1 (Sindicatos, Socios,
 * Vehículos, etc.): PageHeader + búsqueda + DataTable + modal de alta/edición +
 * confirmación de borrado, todo con componentes de @quivo/design-system.
 *
 * Los datos viven en `useState` de este componente — es un demo sin backend real
 * (QUI-220 en adelante trae el CRUD contra la API). Los cambios se pierden al
 * recargar la página.
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
}: ModuleTablePageProps<T>) {
  const [rows, setRows] = useState<T[]>(initialRows);
  const [query, setQuery] = useState('');
  const [editingRow, setEditingRow] = useState<T | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [deletingRow, setDeletingRow] = useState<T | null>(null);

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
    setFormValues(toFormValues(createDefaults, fields));
    setIsCreating(true);
  };

  const openEdit = (row: T) => {
    setFormValues(toFormValues(row, fields));
    setEditingRow(row);
  };

  const closeForm = () => {
    setIsCreating(false);
    setEditingRow(null);
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
      <DataTable
        columns={columns}
        rows={filteredRows}
        empty={query ? `Sin resultados para "${query}".` : 'Sin registros para mostrar.'}
        actions={(row) => (
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
              Editar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDeletingRow(row)}>
              Eliminar
            </Button>
          </div>
        )}
      />

      <Modal
        open={isFormOpen}
        title={editingRow ? `Editar ${entityLabel}` : `Nuevo ${entityLabel}`}
        description="Cambios de demo — no se persisten en un backend real (llega con QUI-220 en adelante)."
        onClose={closeForm}
        footer={
          <>
            <Button variant="ghost" onClick={closeForm}>
              Cancelar
            </Button>
            <Button type="submit" form="entity-form">
              Guardar
            </Button>
          </>
        }
      >
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

      <ConfirmDialog
        open={deletingRow !== null}
        title={`Eliminar ${entityLabel}`}
        message="Acción de demo — no borra nada real; recargá la página para restaurar los datos de ejemplo."
        confirmLabel="Eliminar"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeletingRow(null)}
      />
    </div>
  );
}
