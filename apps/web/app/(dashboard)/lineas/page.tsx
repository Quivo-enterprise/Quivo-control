'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  BanderitaBadge,
  Button,
  DataTable,
  Loader,
  SearchInput,
  Select,
  StatusBadge,
  Tooltip,
  parsearDistintivoBanderita,
} from '@quivo/design-system';
import type { ActualizarLinea, CrearLinea, Linea } from '@quivo/shared';
import {
  Bus,
  Eye,
  Layers,
  Pencil,
  Plus,
  RefreshCcw,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { useSindicatoOptions } from '../../../src/lib/api/use-sindicato-options';
import { lineasApi } from '../../../src/lib/api/lineas';
import { LineaPublicationAction, estadoPublicoEtiqueta } from './linea-publication-action';
import { LineaDetailsModal } from './linea-details-modal';
import { LineaStateModal } from './linea-state-modal';
import { LineaFormPanel } from './line-form-panel';

export default function LineasPage() {
  const { token, user } = useAuth();
  const { options: sindicatoOptions } = useSindicatoOptions();

  const [rows, setRows] = useState<Linea[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [sindicatoFilter, setSindicatoFilter] = useState('');
  const [publicStatusFilter, setPublicStatusFilter] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingLinea, setEditingLinea] = useState<Linea | null>(null);
  const [detailLinea, setDetailLinea] = useState<Linea | null>(null);
  const [stateLinea, setStateLinea] = useState<Linea | null>(null);

  const sindicatoPorId = useMemo(
    () => Object.fromEntries(sindicatoOptions.map((s) => [s.value, s.label])),
    [sindicatoOptions],
  );

  const cargarLineas = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await lineasApi.listar(token);
      setRows(data);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Error al cargar las líneas.');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void cargarLineas();
  }, [cargarLineas]);

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (sindicatoFilter && row.sindicatoId !== sindicatoFilter) return false;
      if (publicStatusFilter && row.publicStatus !== publicStatusFilter) return false;
      if (!normalized) return true;
      return [
        row.codigo,
        row.nombre,
        row.nombreCorto,
        row.lema,
        row.distintivoValor,
        row.cartelSuperior,
      ]
        .filter(Boolean)
        .some((val) => String(val).toLowerCase().includes(normalized));
    });
  }, [rows, query, sindicatoFilter, publicStatusFilter]);

  const hasActiveFilters = Boolean(query || sindicatoFilter || publicStatusFilter);

  const openCreate = () => {
    setEditingLinea(null);
    setIsFormOpen(true);
  };

  const openEdit = (l: Linea) => {
    setEditingLinea(l);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingLinea(null);
  };

  const saveLinea = async (data: CrearLinea | ActualizarLinea) => {
    if (!token) return;
    if (editingLinea) {
      const updated = await lineasApi.actualizar(token, editingLinea.id, data as ActualizarLinea);
      setRows((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } else {
      const created = await lineasApi.crear(token, data as CrearLinea);
      setRows((prev) => [created, ...prev]);
    }
    closeForm();
  };

  const replaceRow = (updated: Linea) => {
    setRows((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
  };

  return (
    <div className="lineas-page" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', position: 'relative' }}>
      {/* Si el formulario split-screen está abierto, se muestra en lugar de la tabla */}
      {isFormOpen ? (
        <LineaFormPanel
          linea={editingLinea}
          sindicatoIdDelActor={user?.sindicatoId ?? null}
          esAdminQuivo={user?.rol === 'admin_quivo'}
          sindicatoOptions={sindicatoOptions}
          onClose={closeForm}
          onSave={saveLinea}
          token={token ?? ''}
        />
      ) : (
        <>
          {/* Barra Unificada de Identidad, Búsqueda y Filtros */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.85rem',
              flexWrap: 'wrap',
              padding: '0.75rem 1.15rem',
              background: 'var(--qv-surface-glass)',
              backdropFilter: 'blur(24px) saturate(180%)',
              WebkitBackdropFilter: 'blur(24px) saturate(180%)',
              borderRadius: 'var(--qv-radius-xl)',
              border: '1px solid var(--qv-border-glass)',
              boxShadow: 'var(--qv-shadow-sm)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', flex: '1 1 auto' }}>
              <h1
                style={{
                  margin: 0,
                  fontSize: '1.05rem',
                  fontWeight: 800,
                  color: 'var(--qv-text-primary)',
                  letterSpacing: '-0.02em',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
              >
                Líneas de Transporte
              </h1>

              <div style={{ width: '1px', height: '1.4rem', backgroundColor: 'var(--qv-border-glass)' }} />

              <div style={{ flex: '1 1 14rem', maxWidth: '24rem' }}>
                <SearchInput
                  placeholder="Buscar línea, código o distintivo..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onClear={() => setQuery('')}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '1.85rem',
                    height: '1.85rem',
                    borderRadius: 'var(--qv-radius-md)',
                    backgroundColor: 'color-mix(in srgb, var(--qv-color-primary) 8%, var(--qv-surface-card))',
                    border: '1px solid var(--qv-border-glass)',
                    color: 'var(--qv-color-primary)',
                  }}
                >
                  <SlidersHorizontal size={14} />
                </span>

                {user?.rol === 'admin_quivo' && sindicatoOptions.length > 0 && (
                  <div style={{ minWidth: '11rem' }}>
                    <Select
                      aria-label="Filtrar por sindicato"
                      options={[
                        { label: 'Todos los sindicatos', value: '' },
                        ...sindicatoOptions,
                      ]}
                      placeholder="Todos los sindicatos"
                      value={sindicatoFilter}
                      onChange={(event) => setSindicatoFilter(event.target.value)}
                    />
                  </div>
                )}

                <div style={{ minWidth: '10.5rem' }}>
                  <Select
                    aria-label="Filtrar por estado app"
                    options={[
                      { label: 'Todos los estados', value: '' },
                      { label: 'Publicada', value: 'published' },
                      { label: 'En revisión', value: 'in_review' },
                      { label: 'Borrador', value: 'draft' },
                    ]}
                    placeholder="Todos los estados"
                    value={publicStatusFilter}
                    onChange={(event) => setPublicStatusFilter(event.target.value)}
                  />
                </div>

                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setQuery('');
                      setSindicatoFilter('');
                      setPublicStatusFilter('');
                    }}
                  >
                    Limpiar filtros
                  </Button>
                )}
              </div>
            </div>

            <span
              style={{
                fontSize: '0.78rem',
                fontWeight: 700,
                color: 'var(--qv-text-secondary)',
                letterSpacing: '0.02em',
                whiteSpace: 'nowrap',
              }}
            >
              {filteredRows.length} {filteredRows.length === 1 ? 'línea' : 'líneas'}
              {hasActiveFilters && filteredRows.length !== rows.length && (
                <span style={{ color: 'var(--qv-color-primary)', marginLeft: '0.25rem' }}>
                  (de {rows.length})
                </span>
              )}
            </span>
          </div>

          {loadError && (
            <Alert variant="danger" title="No se pudo cargar">
              {loadError}
            </Alert>
          )}

          {isLoading ? (
            <Loader label="Cargando líneas de transporte..." />
          ) : (
            <DataTable
              columns={[
                {
                  key: 'branding',
                  header: 'Identidad y Línea',
                  render: (row) => {
                    const parsed = parsearDistintivoBanderita(row.distintivoValor);
                    const isBanderita = row.distintivoTipo === 'banderita' || parsed.esBanderita;
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                        <div
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            minWidth: '2.75rem',
                            height: '2.25rem',
                            padding: '0 0.65rem',
                            borderRadius: 'var(--qv-radius-md)',
                            backgroundColor: row.color ?? 'var(--qv-color-primary)',
                            border: `2px solid ${row.colorSecundario ?? 'transparent'}`,
                            color: row.colorTexto ?? '#ffffff',
                            fontFamily: 'var(--qv-font-display)',
                            fontWeight: 800,
                            fontSize: '1rem',
                            letterSpacing: '0.04em',
                            boxShadow: '0 2px 8px -1px rgba(0,0,0,0.25)',
                            flexShrink: 0,
                          }}
                        >
                          {row.nombreCorto || row.codigo}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                          <strong style={{ fontSize: '0.875rem', color: '#ffffff' }}>
                            {row.nombre}
                          </strong>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.4rem',
                              fontSize: '0.75rem',
                              color: 'var(--qv-text-secondary)',
                            }}
                          >
                            <span>Línea {row.codigo}</span>
                            {row.distintivoValor && (
                              <>
                                <span>·</span>
                                {isBanderita ? (
                                  <BanderitaBadge
                                    texto={row.distintivoValor}
                                    patron={parsed.patron}
                                    colorPrimario={row.color ?? '#3226b4'}
                                    colorSecundario={row.colorSecundario ?? '#fd9e15'}
                                  />
                                ) : (
                                  <span>{row.distintivoValor}</span>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  },
                },
                {
                  key: 'cartelSuperior',
                  header: 'Letrero / Destinos',
                  render: (row) => (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: '0.8125rem',
                          color: '#ffffff',
                        }}
                      >
                        {row.cartelSuperior || 'Sin letrero configurado'}
                      </span>
                      {row.lema && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--qv-text-secondary)' }}>
                          «{row.lema}»
                        </span>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'paleta',
                  header: 'Paleta Oficial',
                  render: (row) => {
                    const primario = row.color;
                    const secundario = row.colorSecundario;
                    const terciario = row.colorTerciario;

                    const hasPrim = Boolean(primario);
                    const hasSec = Boolean(secundario && secundario !== primario);
                    const hasTer = Boolean(terciario && terciario !== primario && terciario !== secundario);

                    if (!hasPrim) {
                      return <span style={{ color: 'var(--qv-text-muted)', fontSize: '0.75rem' }}>Sin colores</span>;
                    }

                    const tooltipText = `Primario: ${primario || 'N/A'}${hasSec ? ` · Secundario: ${secundario}` : ''}${hasTer ? ` · Apoyo: ${terciario}` : ''}`;
                    const containerWidth = hasTer ? '3.25rem' : hasSec ? '2.5rem' : '1.85rem';

                    const renderDotStyle = (colorValue: string, zIndex: number, leftOffset: string) => {
                      const isLight = colorValue.toLowerCase() === '#ffffff' || colorValue.toLowerCase() === 'white';
                      return {
                        position: 'absolute' as const,
                        left: leftOffset,
                        top: 0,
                        width: '1.85rem',
                        height: '1.85rem',
                        borderRadius: '50%',
                        backgroundColor: colorValue,
                        border: isLight
                          ? '2px solid rgba(255, 255, 255, 0.4)'
                          : '2px solid var(--qv-border-glass)',
                        boxShadow: '0 2px 6px rgba(0, 0, 0, 0.25)',
                        zIndex,
                        transition: 'transform var(--qv-transition-fast)',
                      };
                    };

                    return (
                      <Tooltip content={tooltipText}>
                        <div
                          style={{
                            position: 'relative',
                            width: containerWidth,
                            height: '1.85rem',
                            cursor: 'pointer',
                            flexShrink: 0,
                          }}
                          aria-label={tooltipText}
                        >
                          {hasTer && terciario && (
                            <div style={renderDotStyle(terciario, 0, '1.4rem')} />
                          )}
                          {hasSec && secundario && (
                            <div style={renderDotStyle(secundario, 1, '0.7rem')} />
                          )}
                          <div style={renderDotStyle(primario!, 2, '0')} />
                        </div>
                      </Tooltip>
                    );
                  },
                },
                {
                  key: 'publicStatus',
                  header: 'App Pasajeros',
                  render: (row) => {
                    const status =
                      row.publicStatus === 'publicado'
                        ? 'active'
                        : row.publicStatus === 'validado'
                          ? 'warning'
                          : 'idle';
                    const label = `App: ${estadoPublicoEtiqueta(row.publicStatus)}`;
                    return <StatusBadge circle status={status} label={label} />;
                  },
                },
              ]}
              rows={filteredRows}
              empty={query ? `Sin resultados para "${query}".` : 'Sin líneas registradas.'}
              actions={(row) => (
                <div className="qv-table-actions-capsule">
                  {/* Herramienta 1: Ver detalles completos */}
                  <Tooltip content={`Ver detalles de Línea ${row.codigo}`}>
                    <button
                      type="button"
                      className="qv-action-pill-btn"
                      onClick={() => setDetailLinea(row)}
                      aria-label={`Ver detalles de Línea ${row.codigo}`}
                    >
                      <Eye size={13} />
                    </button>
                  </Tooltip>
                  <span className="qv-action-pill-divider" />

                  {/* Herramienta 2: Cambiar estado de publicación */}
                  <Tooltip content="Cambiar estado de publicación">
                    <button
                      type="button"
                      className="qv-action-pill-btn"
                      onClick={() => setStateLinea(row)}
                      aria-label={`Cambiar estado de Línea ${row.codigo}`}
                    >
                      <RefreshCcw size={13} />
                    </button>
                  </Tooltip>
                  <span className="qv-action-pill-divider" />

                  {/* Herramienta 3: Acción de visual global / publicación rápida */}
                  <LineaPublicationAction
                    linea={row}
                    token={token ?? ''}
                    onUpdated={(publication) =>
                      replaceRow({
                        ...row,
                        publicStatus: publication.status,
                        publishedAt: publication.publishedAt,
                      })
                    }
                  />
                  <span className="qv-action-pill-divider" />

                  {/* Herramienta 4: Editar línea con split-screen panel */}
                  <Tooltip content="Editar ficha de línea">
                    <button
                      type="button"
                      className="qv-action-pill-btn"
                      onClick={() => openEdit(row)}
                      aria-label="Editar"
                    >
                      <Pencil size={13} />
                    </button>
                  </Tooltip>
                </div>
              )}
            />
          )}

          {/* Botón Flotante de Creación Abajo a la Derecha */}
          <button
            type="button"
            className="qv-floating-fab-bottom-right"
            onClick={openCreate}
          >
            <Plus size={18} strokeWidth={2.5} />
            <span>Nueva línea</span>
          </button>
        </>
      )}

      {/* Modal de Detalle Completo de la Línea */}
      <LineaDetailsModal
        linea={detailLinea}
        sindicatoNombre={detailLinea ? sindicatoPorId[detailLinea.sindicatoId] : undefined}
        onClose={() => setDetailLinea(null)}
        onChangeState={(l) => {
          setDetailLinea(null);
          setStateLinea(l);
        }}
      />

      {/* Modal de Cambio de Estado de Publicación */}
      <LineaStateModal
        linea={stateLinea}
        token={token ?? ''}
        onClose={() => setStateLinea(null)}
        onUpdated={(publication) => {
          if (stateLinea) {
            replaceRow({
              ...stateLinea,
              publicStatus: publication.status,
              publishedAt: publication.publishedAt,
            });
          }
        }}
      />
    </div>
  );
}
