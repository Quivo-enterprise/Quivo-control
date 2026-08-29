'use client';

import { Fragment, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
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
  Tabs,
  type DataColumn,
  type SelectOption,
} from '@quivo/design-system';

export interface EntityFieldConfig {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'select' | 'color' | 'image';
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
  accept?: string;
  upload?: (file: File) => Promise<string>;
  section?: string;
  sectionDescription?: string;
  colorPresets?: Array<{ label: string; values: Record<string, string> }>;
}

export interface FormTabConfig {
  value: string;
  label: string;
  fieldKeys: string[];
  description?: string;
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
  formTabs?: FormTabConfig[];
  formPresentation?: 'modal' | 'inline';
  renderFormPreview?: (values: Record<string, string>) => ReactNode;
  /** Acciones específicas del módulo; recibe una función para reflejar la fila actualizada. */
  renderRowActions?: (row: T, replaceRow: (updated: T) => void) => ReactNode;
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
  formTabs,
  formPresentation = 'modal',
  renderFormPreview,
  renderRowActions,
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
  const [uploadingFields, setUploadingFields] = useState<Record<string, boolean>>({});
  const [desactivacionPendiente, setDesactivacionPendiente] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [activeFormTab, setActiveFormTab] = useState(formTabs?.[0]?.value ?? '');

  const resetFormTab = () => {
    setActiveFormTab(formTabs?.[0]?.value ?? '');
  };

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
    resetFormTab();
    setIsCreating(true);
  };

  const openEdit = (row: T) => {
    setFormError(null);
    setFieldErrors({});
    setFormValues(toFormValues(row, fields));
    resetFormTab();
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

  const handleImageUpload = async (field: EntityFieldConfig, file: File | undefined) => {
    if (!file || !field.upload) return;
    setUploadingFields((previous) => ({ ...previous, [field.key]: true }));
    try {
      handleFieldChange(field.key, await field.upload(file));
    } catch (error) {
      setFieldErrors((previous) => ({
        ...previous,
        [field.key]: error instanceof Error ? error.message : 'No se pudo subir la imagen.',
      }));
    } finally {
      setUploadingFields((previous) => ({ ...previous, [field.key]: false }));
    }
  };

  const applyColorPreset = (values: Record<string, string>) => {
    for (const [key, value] of Object.entries(values)) {
      handleFieldChange(key, value);
    }
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
  const formTitle = editingRow ? `Editar ${entityLabel}` : `Nuevo ${entityLabel}`;
  const formBody = (
    <>
      {formError && (
        <Alert variant="danger" title="No se pudo guardar" style={{ marginBottom: '1rem' }}>
          {formError}
        </Alert>
      )}
      {formTabs?.length ? (
        <>
          <Tabs
            items={formTabs.map(({ value, label }) => ({ value, label }))}
            value={activeFormTab}
            onValueChange={setActiveFormTab}
            className="module-form-tabs"
          />
          {formTabs.find((tab) => tab.value === activeFormTab)?.description ? (
            <p className="module-form-tabs__description">
              {formTabs.find((tab) => tab.value === activeFormTab)?.description}
            </p>
          ) : null}
        </>
      ) : null}
      <FormGroup id="entity-form" onSubmit={handleSubmit} noValidate>
        {fields
          .filter((field) => {
            if (!formTabs?.length) return true;
            return formTabs
              .find((tab) => tab.value === activeFormTab)
              ?.fieldKeys.includes(field.key);
          })
          .map((field, index, visibleFields) => (
            <Fragment key={field.key}>
              {field.section && field.section !== visibleFields[index - 1]?.section ? (
                <div className="module-form-section">
                  <strong>{field.section}</strong>
                  {field.sectionDescription ? <span>{field.sectionDescription}</span> : null}
                </div>
              ) : null}
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
                  <>
                    <ColorPicker
                      id={field.key}
                      name={field.key}
                      value={formValues[field.key] ?? ''}
                      onChange={(next) => handleFieldChange(field.key, next)}
                    />
                    {field.colorPresets?.length ? (
                      <div className="module-color-presets" aria-label="Paletas sugeridas">
                        {field.colorPresets.map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            className="module-color-preset"
                            onClick={() => applyColorPreset(preset.values)}
                            title={`Aplicar paleta ${preset.label}`}
                          >
                            <span aria-hidden="true">
                              {Object.values(preset.values)
                                .slice(0, 4)
                                .map((color) => (
                                  <i key={color} style={{ background: color }} />
                                ))}
                            </span>
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : field.kind === 'image' ? (
                  <div className="module-image-upload">
                    <div className="module-image-upload__preview">
                      {formValues[field.key] ? (
                        <img src={formValues[field.key]} alt="Vista previa del símbolo" />
                      ) : (
                        <span>◇</span>
                      )}
                    </div>
                    <div className="module-image-upload__actions">
                      <label className="module-image-upload__select" htmlFor={field.key}>
                        {uploadingFields[field.key]
                          ? 'Subiendo…'
                          : formValues[field.key]
                            ? 'Cambiar símbolo'
                            : 'Subir símbolo'}
                        <input
                          id={field.key}
                          name={field.key}
                          type="file"
                          accept={field.accept ?? 'image/png,image/jpeg,image/webp'}
                          onChange={(event) => handleImageUpload(field, event.target.files?.[0])}
                          disabled={uploadingFields[field.key] || isSaving}
                          aria-invalid={Boolean(fieldErrors[field.key])}
                        />
                      </label>
                      <span>
                        {uploadingFields[field.key]
                          ? 'Subiendo símbolo…'
                          : 'PNG, JPG o WebP · hasta 2 MB'}
                      </span>
                      {formValues[field.key] ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleFieldChange(field.key, '')}
                        >
                          Quitar
                        </Button>
                      ) : null}
                    </div>
                  </div>
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
            </Fragment>
          ))}
      </FormGroup>
    </>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          !isFormOpen || formPresentation === 'modal' ? (
            <Button onClick={openCreate} style={{ textTransform: 'capitalize' }}>
              Nuevo {entityLabel}
            </Button>
          ) : undefined
        }
      />
      {formPresentation === 'inline' && isFormOpen ? (
        <section className="module-inline-editor" aria-label={formTitle}>
          <header className="module-inline-editor__header">
            <div>
              <span className="module-inline-editor__eyebrow">Edición en pantalla</span>
              <h2>{formTitle}</h2>
              <p>
                {dataSource
                  ? 'Completa los datos y guarda los cambios sin salir de esta vista.'
                  : 'Cambios de demo — no se persisten en un backend real.'}
              </p>
            </div>
            <Button variant="ghost" onClick={closeForm} disabled={isSaving}>
              Volver a la lista
            </Button>
          </header>
          <div
            className={`module-inline-editor__body${renderFormPreview ? ' module-inline-editor__body--with-preview' : ''}`}
          >
            <div className="module-inline-editor__form">{formBody}</div>
            {renderFormPreview ? (
              <div className="module-inline-editor__preview">{renderFormPreview(formValues)}</div>
            ) : null}
          </div>
          <footer className="module-inline-editor__footer">
            <Button variant="ghost" onClick={closeForm} disabled={isSaving}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="entity-form"
              disabled={isSaving || Object.values(uploadingFields).some(Boolean)}
            >
              {isSaving ? 'Guardando...' : 'Guardar'}
            </Button>
          </footer>
        </section>
      ) : (
        <>
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
                  {renderRowActions?.(row, (updated) =>
                    setRows((previous) =>
                      previous.map((current) =>
                        String(current.id) === String(updated.id) ? updated : current,
                      ),
                    ),
                  )}
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
            open={formPresentation === 'modal' && isFormOpen}
            title={formTitle}
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
            {formBody}
          </Modal>
        </>
      )}

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
