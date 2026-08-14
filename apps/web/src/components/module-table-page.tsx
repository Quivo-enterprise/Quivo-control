'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  ColorPicker,
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
  kind: 'text' | 'number' | 'select' | 'color';
  options?: SelectOption[];
  required?: boolean;
  helperText?: string;
  placeholder?: string;
  maxLength?: number;
  pattern?: string;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email' | 'search' | 'url' | 'none';
  autoComplete?: string;
  /** Sugerencias vía <datalist> para campos `text` sin catálogo fijo (ej. valores ya usados
   * en otros registros) — no restringe el valor, solo evita que el usuario reescriba variantes
   * del mismo texto libre. */
  suggestions?: string[];
  normalize?: (value: string) => string;
  validate?: (value: string, values: Record<string, string>) => string | undefined;
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

function toFormValues(
  row: Record<string, unknown> | null,
  fields: EntityFieldConfig[],
): Record<string, string> {
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [desactivacionPendiente, setDesactivacionPendiente] = useState<Record<
    string,
    unknown
  > | null>(null);

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
      searchKeys.some((key) =>
        String(row[key] ?? '')
          .toLowerCase()
          .includes(normalized),
      ),
    );
  }, [rows, query, searchKeys]);

  const openCreate = () => {
    setFormError(null);
    setFieldErrors({});
    setFormValues(toFormValues(createDefaults, fields));
    setIsCreating(true);
  };

  const openEdit = (row: T) => {
    setFormError(null);
    setFieldErrors({});
    setFormValues(toFormValues(row, fields));
    setEditingRow(row);
  };

  const closeForm = () => {
    setIsCreating(false);
    setEditingRow(null);
    setFormError(null);
    setFieldErrors({});
    setDesactivacionPendiente(null);
  };

  const handleFieldChange = (key: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((previous) => {
      if (!previous[key]) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };

  function guardar(parsed: Record<string, unknown>) {
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
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedValues = { ...formValues };
    const nextFieldErrors: Record<string, string> = {};
    for (const field of fields) {
      const raw = normalizedValues[field.key] ?? '';
      normalizedValues[field.key] = field.normalize ? field.normalize(raw) : raw;
    }

    for (const field of fields) {
      const value = normalizedValues[field.key] ?? '';
      if (field.required && value.trim() === '') {
        nextFieldErrors[field.key] = `${field.label} es obligatorio`;
        continue;
      }
      if (value !== '' && field.validate) {
        const message = field.validate(value, normalizedValues);
        if (message) nextFieldErrors[field.key] = message;
      }
    }

    setFormValues(normalizedValues);
    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      const firstInvalidKey = fields.find((field) => nextFieldErrors[field.key])?.key;
      if (firstInvalidKey) document.getElementById(firstInvalidKey)?.focus();
      return;
    }

    const parsed: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = normalizedValues[field.key] ?? '';
      parsed[field.key] = field.kind === 'number' ? Number(raw) : raw;
    }

    const estadoActual = String(editingRow?.estado ?? '')
      .trim()
      .toLowerCase();
    const estadoPropuesto = String(parsed.estado ?? '')
      .trim()
      .toLowerCase();
    if (estadoActual === 'activo' && estadoPropuesto === 'inactivo') {
      setDesactivacionPendiente(parsed);
      return;
    }

    guardar(parsed);
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
      {loadError && (
        <Alert variant="danger" title="No se pudo cargar">
          {loadError}
        </Alert>
      )}
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
          dataSource ? undefined : 'Cambios de demo — no se persisten en un backend real.'
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
        <FormGroup id="entity-form" onSubmit={handleSubmit} noValidate>
          {fields.map((field) => (
            <FormField
              key={field.key}
              label={field.label}
              htmlFor={field.key}
              required={field.required}
              error={fieldErrors[field.key]}
              helperText={field.helperText}
            >
              {field.kind === 'select' ? (
                <Select
                  id={field.key}
                  name={field.key}
                  options={field.options ?? []}
                  value={formValues[field.key] ?? ''}
                  onChange={(event) => handleFieldChange(field.key, event.target.value)}
                  aria-invalid={Boolean(fieldErrors[field.key])}
                />
              ) : field.kind === 'color' ? (
                <ColorPicker
                  id={field.key}
                  name={field.key}
                  value={formValues[field.key] ?? ''}
                  onChange={(next) => handleFieldChange(field.key, next)}
                />
              ) : (
                <>
                  <Input
                    id={field.key}
                    name={field.key}
                    type={field.kind === 'number' ? 'number' : 'text'}
                    value={formValues[field.key] ?? ''}
                    onChange={(event) => handleFieldChange(field.key, event.target.value)}
                    onBlur={(event) => {
                      if (field.normalize)
                        handleFieldChange(field.key, field.normalize(event.target.value));
                    }}
                    required={field.required}
                    placeholder={field.placeholder}
                    maxLength={field.maxLength}
                    pattern={field.pattern}
                    inputMode={field.inputMode}
                    autoComplete={field.autoComplete}
                    list={field.suggestions?.length ? `${field.key}-suggestions` : undefined}
                    aria-invalid={Boolean(fieldErrors[field.key])}
                  />
                  {field.suggestions?.length ? (
                    <datalist id={`${field.key}-suggestions`}>
                      {field.suggestions.map((value) => (
                        <option key={value} value={value} />
                      ))}
                    </datalist>
                  ) : null}
                </>
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

      <ConfirmDialog
        open={desactivacionPendiente !== null}
        title={`Desactivar ${entityLabel}`}
        message={`Este cambio marcará el ${entityLabel} como inactivo. Verificá que no afecte operaciones planificadas antes de confirmar.`}
        variant="danger"
        confirmLabel={isSaving ? 'Guardando...' : 'Desactivar'}
        onConfirm={() => {
          if (desactivacionPendiente) guardar(desactivacionPendiente);
        }}
        onCancel={() => setDesactivacionPendiente(null)}
      />
    </div>
  );
}
