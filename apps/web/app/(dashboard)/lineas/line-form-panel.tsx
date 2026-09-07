'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Alert,
  BanderitaIcon,
  Button,
  ColorPicker,
  FormField,
  Input,
  Select,
  parsearDistintivoBanderita,
} from '@quivo/design-system';
import type { ActualizarLinea, CrearLinea, Linea } from '@quivo/shared';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bus,
  Flag,
  FileText,
  Hash,
  Image as ImageIcon,
  Layers,
  LayoutTemplate,
  Palette,
  Save,
  Shapes,
  Sparkles,
  Tag,
  Trash2,
  Type,
  Upload,
  X,
} from 'lucide-react';
import { subirLogoLinea } from '../../../src/lib/api/lineas';
import { LineaBoxPreview, VARIANTES_BANDERITA } from './line-box-preview';

interface Option {
  label: string;
  value: string;
}

interface LineFormPanelProps {
  linea: Linea | null;
  sindicatoIdDelActor: string | null;
  esAdminQuivo: boolean;
  sindicatoOptions: Option[];
  onClose: () => void;
  onSave: (data: CrearLinea | ActualizarLinea) => Promise<void>;
  token: string;
}

interface FormValues {
  codigo: string;
  nombre: string;
  nombreCorto: string;
  lema: string;
  descripcion: string;
  sindicatoId: string;
  logoUrl: string;
  color: string;
  colorSecundario: string;
  colorTerciario: string;
  colorTexto: string;
  colorFondo: string;
  distintivoTipo: string;
  distintivoValor: string;
  cartelSuperior: string;
  cartelFormato: string;
  cartelNumeroPosicion: string;
  cartelLogoPosicion: string;
  cartelTitulo: string;
  cartelDetalle: string;
  cartelColorNumero: string;
  cartelColorTitulo: string;
  cartelColorDetalle: string;
  cartelColorBorde: string;
}

const PRESETS_CARTEL = [
  'DIRECTO',
  'EXPRESO',
  'NORTE',
  'SUR',
  'RAMAL A',
  'RAMAL B',
  'CIRCUNVALACIÓN',
  'AV. BLANCO GALINDO',
  'CAMPUS UNIVERSITARIO',
  'ZONA SUD / LA CANCHA',
  'CRUCE TAQUIÑA',
  'SAN MARTÍN',
];

const PRESETS_SIMBOLO = [
  { simbolo: '★', label: 'Estrella' },
  { simbolo: '▲', label: 'Triángulo' },
  { simbolo: '◆', label: 'Rombo' },
  { simbolo: '●', label: 'Círculo' },
  { simbolo: '✚', label: 'Cruz' },
  { simbolo: '⚡', label: 'Rayo' },
  { simbolo: '🌙', label: 'Media Luna' },
  { simbolo: '💎', label: 'Diamante' },
];

const PRESETS_TEXTO = [
  'Por el Puente',
  'Por la Cancha',
  'Por San Martín',
  'Por Av. América',
  'Por Killman',
  'Por la Terminal',
  'Por Circunvalación',
];

const COLOR_PRESETS = [
  {
    label: 'Universitaria',
    values: {
      color: '#0f766e',
      colorSecundario: '#f59e0b',
      colorTexto: '#ffffff',
      colorTerciario: '#0ea5a4',
      colorFondo: '#f0fdfa',
      cartelColorNumero: '#0f766e',
      cartelColorTitulo: '#0f766e',
      cartelColorDetalle: '#f59e0b',
      cartelColorBorde: '#0f766e',
    },
  },
  {
    label: 'Azul urbano',
    values: {
      color: '#1d4ed8',
      colorSecundario: '#f97316',
      colorTexto: '#ffffff',
      colorTerciario: '#38bdf8',
      colorFondo: '#eff6ff',
      cartelColorNumero: '#1d4ed8',
      cartelColorTitulo: '#1d4ed8',
      cartelColorDetalle: '#f97316',
      cartelColorBorde: '#1d4ed8',
    },
  },
  {
    label: 'Rojiblanca',
    values: {
      color: '#b91c1c',
      colorSecundario: '#facc15',
      colorTexto: '#ffffff',
      colorTerciario: '#ef4444',
      colorFondo: '#fff7ed',
      cartelColorNumero: '#b91c1c',
      cartelColorTitulo: '#b91c1c',
      cartelColorDetalle: '#1d4ed8',
      cartelColorBorde: '#64748b',
    },
  },
  {
    label: 'Andina',
    values: {
      color: '#4c1d95',
      colorSecundario: '#22c55e',
      colorTexto: '#ffffff',
      colorTerciario: '#f59e0b',
      colorFondo: '#faf5ff',
      cartelColorNumero: '#4c1d95',
      cartelColorTitulo: '#4c1d95',
      cartelColorDetalle: '#22c55e',
      cartelColorBorde: '#4c1d95',
    },
  },
];

function valoresIniciales(linea: Linea | null, sindicatoId: string | null): FormValues {
  return {
    codigo: linea?.codigo ?? '',
    nombre: linea?.nombre ?? '',
    nombreCorto: linea?.nombreCorto ?? '',
    lema: linea?.lema ?? '',
    descripcion: linea?.descripcion ?? '',
    sindicatoId: linea?.sindicatoId ?? sindicatoId ?? '',
    logoUrl: linea?.logoUrl ?? '',
    color: linea?.color ?? '#b91c1c',
    colorSecundario: linea?.colorSecundario ?? '#facc15',
    colorTerciario: linea?.colorTerciario ?? '#ef4444',
    colorTexto: linea?.colorTexto ?? '#ffffff',
    colorFondo: linea?.colorFondo ?? '#fff7ed',
    distintivoTipo: linea?.distintivoTipo ?? 'ninguno',
    distintivoValor: linea?.distintivoValor ?? '',
    cartelSuperior: linea?.cartelSuperior ?? '',
    cartelFormato: linea?.cartelFormato ?? 'doble_clasico',
    cartelNumeroPosicion: linea?.cartelNumeroPosicion ?? 'izquierda',
    cartelLogoPosicion: linea?.cartelLogoPosicion ?? 'ninguno',
    cartelTitulo: linea?.cartelTitulo ?? '',
    cartelDetalle: linea?.cartelDetalle ?? '',
    cartelColorNumero: linea?.cartelColorNumero ?? '#b91c1c',
    cartelColorTitulo: linea?.cartelColorTitulo ?? '#b91c1c',
    cartelColorDetalle: linea?.cartelColorDetalle ?? '#1d4ed8',
    cartelColorBorde: linea?.cartelColorBorde ?? '#64748b',
  };
}

export function LineaFormPanel({
  linea,
  sindicatoIdDelActor,
  esAdminQuivo,
  sindicatoOptions,
  onClose,
  onSave,
  token,
}: LineFormPanelProps) {
  const [values, setValues] = useState<FormValues>(() =>
    valoresIniciales(linea, sindicatoIdDelActor),
  );
  const [activeSection, setActiveSection] = useState<'01' | '02' | '03' | '04' | '05'>('01');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  useEffect(() => {
    setValues(valoresIniciales(linea, sindicatoIdDelActor));
    setErrors({});
    setFormError(null);
  }, [linea, sindicatoIdDelActor]);

  const completionChecks = [
    Boolean(values.codigo.trim()),
    Boolean(values.nombre.trim()),
    Boolean(values.sindicatoId),
    Boolean(values.color),
  ];
  const completedFields = completionChecks.filter(Boolean).length;
  const completionPercentage = Math.round((completedFields / completionChecks.length) * 100);

  const setField = (key: keyof FormValues, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const aplicarPreset = (preset: typeof COLOR_PRESETS[0]) => {
    setValues((prev) => ({
      ...prev,
      ...preset.values,
    }));
  };

  const handleLogoUpload = async (file: File) => {
    setIsUploadingLogo(true);
    setFormError(null);
    try {
      const url = await subirLogoLinea(token, file);
      setField('logoUrl', url);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'No se pudo subir la imagen del logo.');
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    const newErrors: Record<string, string> = {};
    if (!values.codigo.trim()) newErrors.codigo = 'Ingresa el código de la línea.';
    if (!values.nombre.trim()) newErrors.nombre = 'Ingresa el nombre oficial de la línea.';
    if (!values.sindicatoId.trim()) newErrors.sindicatoId = 'Selecciona el sindicato asignado.';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setActiveSection('01');
      return;
    }

    setIsSaving(true);
    try {
      const distintivoTipoValido =
        values.distintivoTipo && values.distintivoTipo !== 'ninguno'
          ? (values.distintivoTipo as CrearLinea['distintivoTipo'])
          : null;

      const distintivoValorValido =
        distintivoTipoValido && values.distintivoValor.trim()
          ? values.distintivoValor.trim()
          : null;

      const payload: CrearLinea = {
        codigo: values.codigo.trim(),
        nombre: values.nombre.trim(),
        nombreCorto: values.nombreCorto.trim() || undefined,
        lema: values.lema.trim() || undefined,
        descripcion: values.descripcion.trim() || undefined,
        sindicatoId: values.sindicatoId,
        logoUrl: values.logoUrl.trim() || undefined,
        color: values.color || undefined,
        colorSecundario: values.colorSecundario || undefined,
        colorTerciario: values.colorTerciario || undefined,
        colorTexto: values.colorTexto || undefined,
        colorFondo: values.colorFondo || undefined,
        distintivoTipo: distintivoTipoValido,
        distintivoValor: distintivoValorValido,
        cartelSuperior: values.cartelSuperior.trim() || undefined,
        cartelFormato: (values.cartelFormato || undefined) as CrearLinea['cartelFormato'],
        cartelNumeroPosicion: (values.cartelNumeroPosicion || undefined) as CrearLinea['cartelNumeroPosicion'],
        cartelLogoPosicion: (values.cartelLogoPosicion || undefined) as CrearLinea['cartelLogoPosicion'],
        cartelTitulo: values.cartelTitulo.trim() || undefined,
        cartelDetalle: values.cartelDetalle.trim() || undefined,
        cartelColorNumero: values.cartelColorNumero || undefined,
        cartelColorTitulo: values.cartelColorTitulo || undefined,
        cartelColorDetalle: values.cartelColorDetalle || undefined,
        cartelColorBorde: values.cartelColorBorde || undefined,
      };

      await onSave(payload);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'No se pudo guardar la línea.');
    } finally {
      setIsSaving(false);
    }
  };

  const erroresSec01 = Boolean(errors.codigo || errors.nombre || errors.sindicatoId);

  return (
    <div className="vehicle-form-layout" style={{ width: '100%' }}>
      {/* Columna Izquierda: Formulario Principal */}
      <div className="vehicle-form-main-card" style={{ width: '100%' }}>
        {/* Encabezado del Panel */}
        <header className="vehicle-panel-header">
          <div className="vehicle-panel-header__info">
            <div
              className="vehicle-panel-header__icon"
              style={{
                background: 'color-mix(in srgb, var(--qv-color-primary) 14%, var(--qv-surface-card))',
                color: 'var(--qv-color-primary)',
              }}
            >
              <Bus size={22} />
            </div>
            <div>
              <span className="vehicle-panel-header__eyebrow">
                {linea ? 'Ficha de identidad de la línea' : 'Nueva línea · Registro guiado'}
              </span>
              <h2>{linea ? `Editar línea: ${linea.codigo} — ${linea.nombre}` : 'Registrar nueva línea'}</h2>
              <p>
                {linea
                  ? 'Configura la identidad visual, señalización de techo y asignación operativa.'
                  : 'Completa los datos de identidad, paleta y señalización para habilitar la línea.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="vehicle-panel-header__close"
            onClick={onClose}
            aria-label="Cerrar formulario"
          >
            <X size={20} />
          </button>
        </header>

        {formError && (
          <Alert variant="danger" title="No se pudo guardar" style={{ margin: '1rem 1.5rem 0' }}>
            {formError}
          </Alert>
        )}

        {/* Barra de Navegación por Secciones */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.45rem',
            padding: '0.75rem 1.5rem',
            backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 65%, transparent)',
            borderBottom: '1px solid var(--qv-border-glass)',
            overflowX: 'auto',
            width: '100%',
            boxSizing: 'border-box',
            flexWrap: 'nowrap',
          }}
        >
          {[
            { id: '01', label: 'Identidad Base', error: erroresSec01 },
            { id: '02', label: 'Símbolo y Emblema', error: false },
            { id: '03', label: 'Paleta y Colores', error: false },
            { id: '04', label: 'Señalización', error: false },
            { id: '05', label: 'Letrero de Techo', error: false },
          ].map((sec) => {
            const isCurrent = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => setActiveSection(sec.id as typeof activeSection)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.45rem 0.85rem',
                  borderRadius: 'var(--qv-radius-full)',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: isCurrent
                    ? '1px solid var(--qv-color-primary)'
                    : '1px solid var(--qv-border-glass)',
                  backgroundColor: isCurrent ? 'var(--qv-color-primary)' : 'var(--qv-surface-card)',
                  color: isCurrent ? '#ffffff' : 'var(--qv-text-primary)',
                  transition: 'all var(--qv-transition-fast)',
                  whiteSpace: 'nowrap',
                  boxShadow: isCurrent
                    ? '0 2px 8px color-mix(in srgb, var(--qv-color-primary) 30%, transparent)'
                    : 'none',
                }}
              >
                <span style={{ fontWeight: 800 }}>{sec.id}</span>
                <span>{sec.label}</span>
                {sec.error && (
                  <AlertCircle
                    size={13}
                    style={{ color: isCurrent ? '#ffffff' : 'var(--qv-color-danger)' }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Cuerpo del Formulario */}
        <form id="linea-form" onSubmit={handleSubmit} className="vehicle-panel-body" style={{ width: '100%', boxSizing: 'border-box' }}>
          {/* ── SECCIÓN 01: Identidad Base ── */}
          {activeSection === '01' && (
            <section
              className="vehicle-panel-main"
              aria-label="Identidad Base"
              style={{
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.25rem',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  borderBottom: '1px solid var(--qv-border-glass)',
                  paddingBottom: '0.75rem',
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '1.85rem',
                    height: '1.85rem',
                    borderRadius: '50%',
                    backgroundColor: 'color-mix(in srgb, var(--qv-color-primary) 15%, transparent)',
                    color: 'var(--qv-color-primary)',
                    fontWeight: 800,
                    fontSize: '0.8125rem',
                  }}
                >
                  01
                </span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--qv-text-primary)' }}>
                    Identidad Base de la Línea
                  </h3>
                  <p style={{ margin: '0.1rem 0 0 0', fontSize: '0.75rem', color: 'var(--qv-text-secondary)' }}>
                    Código oficial, denominación representativa y padrón sindical asignado.
                  </p>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', width: '100%' }}>
                <FormField htmlFor="linea-codigo" label="Código Oficial de Línea" required error={errors.codigo}>
                  <Input
                    id="linea-codigo"
                    placeholder="Ej. 120, 101, 3A"
                    value={values.codigo}
                    onChange={(e) => setField('codigo', e.target.value)}
                    autoFocus
                    fullWidth
                  />
                </FormField>

                <FormField htmlFor="linea-nombre" label="Nombre de la Línea" required error={errors.nombre}>
                  <Input
                    id="linea-nombre"
                    placeholder="Ej. Línea 120 Tiquipaya"
                    value={values.nombre}
                    onChange={(e) => setField('nombre', e.target.value)}
                    fullWidth
                  />
                </FormField>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', width: '100%' }}>
                <FormField
                  htmlFor="linea-nombre-corto"
                  label="Nombre Corto / Identificador"
                  helperText="Visible en credenciales y apps móviles (ej. 120)."
                >
                  <Input
                    id="linea-nombre-corto"
                    placeholder="Ej. 120"
                    value={values.nombreCorto}
                    onChange={(e) => setField('nombreCorto', e.target.value)}
                    fullWidth
                  />
                </FormField>

                <FormField
                  htmlFor="linea-lema"
                  label="Lema de la Línea"
                  helperText="Eslogan opcional para identificación pública."
                >
                  <Input
                    id="linea-lema"
                    placeholder="Ej. Conectando la ciudad"
                    value={values.lema}
                    onChange={(e) => setField('lema', e.target.value)}
                    fullWidth
                  />
                </FormField>
              </div>

              {esAdminQuivo && (
                <div style={{ width: '100%' }}>
                  <FormField htmlFor="linea-sindicato" label="Sindicato Asignado" required error={errors.sindicatoId}>
                    <Select
                      id="linea-sindicato"
                      options={[{ label: 'Seleccionar sindicato...', value: '' }, ...sindicatoOptions]}
                      value={values.sindicatoId}
                      onChange={(e) => setField('sindicatoId', e.target.value)}
                      fullWidth
                    />
                  </FormField>
                </div>
              )}

              <div style={{ width: '100%' }}>
                <FormField htmlFor="linea-descripcion" label="Descripción Operativa / Cobertura">
                  <Input
                    id="linea-descripcion"
                    placeholder="Detalles de recorrido, paradas estratégicas o zonas de influencia..."
                    value={values.descripcion}
                    onChange={(e) => setField('descripcion', e.target.value)}
                    fullWidth
                  />
                </FormField>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--qv-border-glass)', width: '100%' }}>
                <Button type="button" onClick={() => setActiveSection('02')} size="sm">
                  <span>Siguiente: Símbolo (02)</span>
                  <ArrowRight size={14} style={{ marginLeft: '6px' }} />
                </Button>
              </div>
            </section>
          )}

          {/* ── SECCIÓN 02: Símbolo y Emblema ── */}
          {activeSection === '02' && (
            <section
              className="vehicle-panel-main"
              aria-label="Símbolo y Emblema"
              style={{
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.25rem',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  borderBottom: '1px solid var(--qv-border-glass)',
                  paddingBottom: '0.75rem',
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '1.85rem',
                    height: '1.85rem',
                    borderRadius: '50%',
                    backgroundColor: 'color-mix(in srgb, var(--qv-color-primary) 15%, transparent)',
                    color: 'var(--qv-color-primary)',
                    fontWeight: 800,
                    fontSize: '0.8125rem',
                  }}
                >
                  02
                </span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--qv-text-primary)' }}>
                    Símbolo y Emblema Gráfico
                  </h3>
                  <p style={{ margin: '0.1rem 0 0 0', fontSize: '0.75rem', color: 'var(--qv-text-secondary)' }}>
                    Logo o escudo vectorial que distingue a la línea en mapas y tarjetas informativas.
                  </p>
                </div>
              </div>

              <div
                style={{
                  padding: '1.5rem',
                  borderRadius: 'var(--qv-radius-lg)',
                  backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                  border: '1px solid var(--qv-border-glass)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1.25rem',
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                  <div
                    style={{
                      width: '4.5rem',
                      height: '4.5rem',
                      borderRadius: 'var(--qv-radius-lg)',
                      backgroundColor: values.color || 'var(--qv-color-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      border: '2px solid var(--qv-border-glass)',
                      flexShrink: 0,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    }}
                  >
                    {values.logoUrl ? (
                      <img
                        src={values.logoUrl}
                        alt="Logo"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <ImageIcon size={28} style={{ color: '#ffffff' }} />
                    )}
                  </div>

                  <div style={{ flex: 1 }}>
                    <strong style={{ fontSize: '1rem', color: 'var(--qv-text-primary)', display: 'block' }}>
                      Emblema Oficial de la Línea
                    </strong>
                    <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8125rem', color: 'var(--qv-text-secondary)', lineHeight: 1.4 }}>
                      Formatos soportados: PNG, JPG, WebP (máx. 2 MB). Se utilizará en mapas, letrero y tarjetas de ruta.
                    </p>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      padding: '0.6rem 1.25rem',
                      borderRadius: 'var(--qv-radius-md)',
                      backgroundColor: 'var(--qv-color-primary)',
                      color: '#ffffff',
                      fontSize: '0.8125rem',
                      fontWeight: 700,
                      cursor: isUploadingLogo ? 'wait' : 'pointer',
                      boxShadow: '0 2px 8px color-mix(in srgb, var(--qv-color-primary) 30%, transparent)',
                    }}
                  >
                    <Upload size={15} />
                    <span>{isUploadingLogo ? 'Subiendo emblema...' : 'Subir imagen de logo'}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      style={{ display: 'none' }}
                      disabled={isUploadingLogo}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleLogoUpload(file);
                      }}
                    />
                  </label>

                  {values.logoUrl && (
                    <Button
                      variant="ghost"
                      type="button"
                      size="sm"
                      onClick={() => setField('logoUrl', '')}
                    >
                      <Trash2 size={14} style={{ color: 'var(--qv-color-danger)', marginRight: '4px' }} />
                      <span>Quitar logo</span>
                    </Button>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--qv-border-glass)', width: '100%' }}>
                <Button variant="ghost" type="button" onClick={() => setActiveSection('01')} size="sm">
                  <ArrowLeft size={14} style={{ marginRight: '6px' }} />
                  <span>Identidad (01)</span>
                </Button>
                <Button type="button" onClick={() => setActiveSection('03')} size="sm">
                  <span>Siguiente: Paleta (03)</span>
                  <ArrowRight size={14} style={{ marginLeft: '6px' }} />
                </Button>
              </div>
            </section>
          )}

          {/* ── SECCIÓN 03: Paleta y Colores ── */}
          {activeSection === '03' && (
            <section
              className="vehicle-panel-main"
              aria-label="Paleta y Colores"
              style={{
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.25rem',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  borderBottom: '1px solid var(--qv-border-glass)',
                  paddingBottom: '0.75rem',
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '1.85rem',
                    height: '1.85rem',
                    borderRadius: '50%',
                    backgroundColor: 'color-mix(in srgb, var(--qv-color-primary) 15%, transparent)',
                    color: 'var(--qv-color-primary)',
                    fontWeight: 800,
                    fontSize: '0.8125rem',
                  }}
                >
                  03
                </span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--qv-text-primary)' }}>
                    Paleta Cromática y Colores Oficiales
                  </h3>
                  <p style={{ margin: '0.1rem 0 0 0', fontSize: '0.75rem', color: 'var(--qv-text-secondary)' }}>
                    Define la combinación de colores institucional para señalización, mapa y letreros.
                  </p>
                </div>
              </div>

              {/* Presets de Color */}
              <div
                style={{
                  padding: '1.15rem 1.25rem',
                  borderRadius: 'var(--qv-radius-lg)',
                  backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                  border: '1px solid var(--qv-border-glass)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                  <Palette size={15} style={{ color: 'var(--qv-color-primary)' }} />
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--qv-text-secondary)' }}>
                    Estilos y Paletas Sugeridas (1-Click)
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.65rem', width: '100%' }}>
                  {COLOR_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => aplicarPreset(preset)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.55rem 0.85rem',
                        borderRadius: 'var(--qv-radius-md)',
                        backgroundColor: 'var(--qv-surface-card)',
                        border: '1px solid var(--qv-border-glass)',
                        cursor: 'pointer',
                        transition: 'all var(--qv-transition-fast)',
                      }}
                    >
                      <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--qv-text-primary)' }}>
                        {preset.label}
                      </span>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <span style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: preset.values.color }} />
                        <span style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: preset.values.colorSecundario }} />
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Selectores de Color Detallados */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', width: '100%' }}>
                <FormField htmlFor="color-principal" label="Color Principal" helperText="Dominante en mapa y letrero.">
                  <ColorPicker id="color-principal" value={values.color} onChange={(val) => setField('color', val)} />
                </FormField>

                <FormField htmlFor="color-secundario" label="Color de Acento" helperText="Bordes y detalles destacados.">
                  <ColorPicker id="color-secundario" value={values.colorSecundario} onChange={(val) => setField('colorSecundario', val)} />
                </FormField>

                <FormField htmlFor="color-terciario" label="Color de Apoyo" helperText="Banderitas y distinciones.">
                  <ColorPicker id="color-terciario" value={values.colorTerciario} onChange={(val) => setField('colorTerciario', val)} />
                </FormField>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', width: '100%' }}>
                <FormField htmlFor="color-texto" label="Color de Texto" helperText="Lectura sobre el color principal.">
                  <ColorPicker id="color-texto" value={values.colorTexto} onChange={(val) => setField('colorTexto', val)} />
                </FormField>

                <FormField htmlFor="color-fondo" label="Fondo de Tarjetas" helperText="Fondo claro para paneles.">
                  <ColorPicker id="color-fondo" value={values.colorFondo} onChange={(val) => setField('colorFondo', val)} />
                </FormField>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--qv-border-glass)', width: '100%' }}>
                <Button variant="ghost" type="button" onClick={() => setActiveSection('02')} size="sm">
                  <ArrowLeft size={14} style={{ marginRight: '6px' }} />
                  <span>Símbolo (02)</span>
                </Button>
                <Button type="button" onClick={() => setActiveSection('04')} size="sm">
                  <span>Siguiente: Señalización (04)</span>
                  <ArrowRight size={14} style={{ marginLeft: '6px' }} />
                </Button>
              </div>
            </section>
          )}

          {/* ── SECCIÓN 04: Señalización y Banderita ── */}
          {activeSection === '04' && (() => {
            const marker = values.distintivoValor?.trim() || '';
            const isBanderita = values.distintivoTipo === 'banderita' || marker.toLowerCase().includes('bander');
            const parsedDistintivo = parsearDistintivoBanderita(marker);

            return (
              <section
                className="vehicle-panel-main"
                aria-label="Señalización y Banderita"
                style={{
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1.25rem',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    borderBottom: '1px solid var(--qv-border-glass)',
                    paddingBottom: '0.75rem',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '1.85rem',
                      height: '1.85rem',
                      borderRadius: '50%',
                      backgroundColor: 'color-mix(in srgb, var(--qv-color-primary) 15%, transparent)',
                      color: 'var(--qv-color-primary)',
                      fontWeight: 800,
                      fontSize: '0.8125rem',
                    }}
                  >
                    04
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--qv-text-primary)' }}>
                          Señalización y Distintivos de Recorrido
                        </h3>
                        <span
                          style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            padding: '0.1rem 0.45rem',
                            borderRadius: 'var(--qv-radius-full)',
                            backgroundColor: 'color-mix(in srgb, var(--qv-text-secondary) 15%, transparent)',
                            color: 'var(--qv-text-secondary)',
                            border: '1px solid var(--qv-border-glass)',
                          }}
                        >
                          Opcional
                        </span>
                      </div>
                      <p style={{ margin: '0.1rem 0 0 0', fontSize: '0.75rem', color: 'var(--qv-text-secondary)' }}>
                        El uso de banderita o distintivo es 100% opcional: solo configúralo si la línea utiliza distintivos gráficos adicionales.
                      </p>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', width: '100%' }}>
                  <FormField htmlFor="distintivo-tipo" label="Tipo de Distintivo (Opcional)" helperText="Selecciona 'Ninguno' si la línea no lleva banderita.">
                    <Select
                      id="distintivo-tipo"
                      options={[
                        { label: 'Ninguno (sin distintivo / estándar)', value: 'ninguno' },
                        { label: 'Banderita gráfica oficial', value: 'banderita' },
                        { label: 'Cartel auxiliar', value: 'cartel' },
                        { label: 'Número distintivo', value: 'numero' },
                        { label: 'Texto libre', value: 'texto' },
                        { label: 'Símbolo especial', value: 'simbolo' },
                      ]}
                      value={values.distintivoTipo}
                      onChange={(e) => {
                        const newType = e.target.value;
                        setField('distintivoTipo', newType);
                        if (newType === 'ninguno') {
                          setField('distintivoValor', '');
                        }
                      }}
                      fullWidth
                    />
                  </FormField>

                  <FormField htmlFor="distintivo-valor" label="Identificador o Texto de Distintivo (Opcional)" helperText="Déjalo vacío si la línea se identifica solo por número y letrero.">
                    <Input
                      id="distintivo-valor"
                      placeholder="Ej. Banderita Mitad (50/50), Norte (Opcional)"
                      value={values.distintivoValor}
                      onChange={(e) => setField('distintivoValor', e.target.value)}
                      fullWidth
                    />
                  </FormField>
                </div>

                {/* Selector Visual de Tipo de Distintivo */}
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--qv-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Tipo de Distintivo Operativo (Opcional)
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(9.5rem, 1fr))', gap: '0.5rem', width: '100%' }}>
                    {[
                      { tipo: 'ninguno', label: 'Ninguno (Estándar)', icon: X, desc: 'Solo letrero oficial' },
                      { tipo: 'cartel', label: 'Cartel Auxiliar', icon: FileText, desc: 'Rótulo de parabrisas' },
                      { tipo: 'banderita', label: 'Banderita Oficial', icon: Flag, desc: 'Patrón gráfico cromático' },
                      { tipo: 'numero', label: 'Número / Letra', icon: Hash, desc: 'Variante numérica (120-A)' },
                      { tipo: 'texto', label: 'Texto de Ruta', icon: Type, desc: 'Vía destacada (Por San Martín)' },
                      { tipo: 'simbolo', label: 'Símbolo Especial', icon: Shapes, desc: 'Glifo o figura (★, ▲)' },
                    ].map((item) => {
                      const isSelected = values.distintivoTipo === item.tipo || (!values.distintivoTipo && item.tipo === 'ninguno');
                      const IconComponent = item.icon;
                      return (
                        <button
                          key={item.tipo}
                          type="button"
                          onClick={() => {
                            setField('distintivoTipo', item.tipo);
                            if (item.tipo === 'ninguno') {
                              setField('distintivoValor', '');
                            } else if (!values.distintivoValor || isBanderita && item.tipo !== 'banderita') {
                              if (item.tipo === 'cartel') setField('distintivoValor', 'DIRECTO');
                              if (item.tipo === 'banderita') setField('distintivoValor', 'Banderita Sólida');
                              if (item.tipo === 'numero') setField('distintivoValor', `${values.codigo || '120'}-A`);
                              if (item.tipo === 'texto') setField('distintivoValor', 'Por el Puente');
                              if (item.tipo === 'simbolo') setField('distintivoValor', '★ Estrella');
                            }
                          }}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'flex-start',
                            padding: '0.65rem 0.75rem',
                            borderRadius: 'var(--qv-radius-md)',
                            border: isSelected ? '1.5px solid var(--qv-color-primary)' : '1px solid var(--qv-border-glass)',
                            backgroundColor: isSelected ? 'color-mix(in srgb, var(--qv-color-primary) 15%, var(--qv-surface-card))' : 'var(--qv-surface-card)',
                            color: isSelected ? 'var(--qv-color-primary)' : 'var(--qv-text-primary)',
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'all var(--qv-transition-fast)',
                            boxShadow: isSelected ? '0 0 10px color-mix(in srgb, var(--qv-color-primary) 25%, transparent)' : 'none',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 800, fontSize: '0.8rem' }}>
                            <IconComponent size={14} />
                            <span>{item.label}</span>
                          </div>
                          <span style={{ fontSize: '0.68rem', color: 'var(--qv-text-secondary)', marginTop: '0.2rem', lineHeight: 1.2 }}>
                            {item.desc}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* ── CASO 1: CARTEL AUXILIAR PERSONALIZABLE ── */}
                {values.distintivoTipo === 'cartel' && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.85rem',
                      padding: '1.25rem',
                      borderRadius: 'var(--qv-radius-lg)',
                      backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                      border: '1px solid var(--qv-border-glass)',
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.45rem',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          color: 'var(--qv-text-primary)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                        }}
                      >
                        <FileText size={15} style={{ color: 'var(--qv-color-primary)' }} />
                        Personalizador de Cartel Auxiliar (Parabrisas / Lateral)
                      </span>
                    </div>

                    <p style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', margin: 0, lineHeight: 1.4 }}>
                      Selecciona una plantilla rápida o escribe el texto exacto del rótulo auxiliar que portarán las unidades:
                    </p>

                    {/* Plantillas / Chips Rápidos de Cartel */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      {PRESETS_CARTEL.map((preset) => {
                        const isSelected = values.distintivoValor?.toUpperCase() === preset;
                        return (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setField('distintivoValor', preset)}
                            style={{
                              padding: '0.35rem 0.65rem',
                              borderRadius: 'var(--qv-radius-full)',
                              fontSize: '0.72rem',
                              fontWeight: isSelected ? 800 : 600,
                              cursor: 'pointer',
                              border: isSelected ? '1px solid var(--qv-color-primary)' : '1px solid var(--qv-border-glass)',
                              backgroundColor: isSelected ? 'color-mix(in srgb, var(--qv-color-primary) 18%, var(--qv-surface-card))' : 'var(--qv-surface-card)',
                              color: isSelected ? 'var(--qv-color-primary)' : 'var(--qv-text-secondary)',
                              transition: 'all var(--qv-transition-fast)',
                            }}
                          >
                            {preset}
                          </button>
                        );
                      })}
                    </div>

                    <FormField
                      htmlFor="distintivo-valor-cartel"
                      label="Texto del Cartel Auxiliar"
                      helperText="Este rótulo se mostrará en el parabrisas y en la ficha del pasajero."
                    >
                      <Input
                        id="distintivo-valor-cartel"
                        placeholder="Ej. DIRECTO POR AUTOPISTA, RAMAL NORTE"
                        value={values.distintivoValor}
                        onChange={(e) => setField('distintivoValor', e.target.value.toUpperCase())}
                        fullWidth
                      />
                    </FormField>
                  </div>
                )}

                {/* ── CASO 2: BANDERITA OFICIAL PERSONALIZABLE ── */}
                {values.distintivoTipo === 'banderita' && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.85rem',
                      padding: '1.25rem',
                      borderRadius: 'var(--qv-radius-lg)',
                      backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                      border: '1px solid var(--qv-border-glass)',
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.45rem',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          color: 'var(--qv-text-primary)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                        }}
                      >
                        <Flag size={15} style={{ color: 'var(--qv-color-primary)' }} />
                        Catálogo de Variantes de Banderita Oficiales
                      </span>
                    </div>

                    <p style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', margin: 0, lineHeight: 1.4 }}>
                      Haz clic en una variante gráfica para asignarla a la línea:
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))', gap: '0.65rem', width: '100%' }}>
                      {VARIANTES_BANDERITA.map((variante) => {
                        const isSelected = parsedDistintivo.patron === variante.patron;
                        return (
                          <button
                            key={variante.patron}
                            type="button"
                            onClick={() => {
                              setField('distintivoTipo', 'banderita');
                              setField('distintivoValor', `Banderita ${variante.label}`);
                            }}
                            title={variante.descripcion}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.65rem',
                              padding: '0.65rem 0.85rem',
                              borderRadius: 'var(--qv-radius-md)',
                              border: isSelected
                                ? '1.5px solid var(--qv-color-primary)'
                                : '1px solid var(--qv-border-glass)',
                              backgroundColor: isSelected
                                ? 'color-mix(in srgb, var(--qv-color-primary) 15%, var(--qv-surface-card))'
                                : 'var(--qv-surface-card)',
                              color: isSelected ? 'var(--qv-color-primary)' : 'var(--qv-text-primary)',
                              fontSize: '0.8125rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                              textAlign: 'left',
                              transition: 'all var(--qv-transition-fast)',
                              boxShadow: isSelected ? '0 0 10px color-mix(in srgb, var(--qv-color-primary) 25%, transparent)' : 'none',
                            }}
                          >
                            <BanderitaIcon
                              patron={variante.patron}
                              colorPrimario={values.color || '#3226b4'}
                              colorSecundario={values.colorSecundario || '#fd9e15'}
                              colorTerciario={values.colorTerciario || '#10b981'}
                              size={22}
                            />
                            <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {variante.label}
                              </span>
                              <span style={{ fontSize: '0.7rem', color: 'var(--qv-text-secondary)', fontWeight: 500 }}>
                                {variante.descripcion}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <FormField
                      htmlFor="distintivo-valor-banderita"
                      label="Etiqueta o Nombre de la Banderita"
                      helperText="Texto descriptivo del distintivo."
                    >
                      <Input
                        id="distintivo-valor-banderita"
                        placeholder="Ej. Banderita Mitad (50/50)"
                        value={values.distintivoValor}
                        onChange={(e) => setField('distintivoValor', e.target.value)}
                        fullWidth
                      />
                    </FormField>
                  </div>
                )}

                {/* ── CASO 3: NÚMERO / LETRA PERSONALIZABLE ── */}
                {values.distintivoTipo === 'numero' && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.85rem',
                      padding: '1.25rem',
                      borderRadius: 'var(--qv-radius-lg)',
                      backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                      border: '1px solid var(--qv-border-glass)',
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.45rem',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        color: 'var(--qv-text-primary)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      <Hash size={15} style={{ color: 'var(--qv-color-primary)' }} />
                      Variante Numérica o Letra de Ramal
                    </span>

                    <p style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', margin: 0, lineHeight: 1.4 }}>
                      Selecciona un sufijo numérico sugerido o escribe el código distintivo:
                    </p>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      {[
                        `${values.codigo || '120'}-A`,
                        `${values.codigo || '120'}-B`,
                        `${values.codigo || '120'}-C`,
                        `${values.codigo || '120'} BIS`,
                        `${values.codigo || '120'} ROJO`,
                        `${values.codigo || '120'} VERDE`,
                      ].map((preset) => {
                        const isSelected = values.distintivoValor === preset;
                        return (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setField('distintivoValor', preset)}
                            style={{
                              padding: '0.35rem 0.65rem',
                              borderRadius: 'var(--qv-radius-full)',
                              fontSize: '0.72rem',
                              fontWeight: isSelected ? 800 : 600,
                              cursor: 'pointer',
                              border: isSelected ? '1px solid var(--qv-color-primary)' : '1px solid var(--qv-border-glass)',
                              backgroundColor: isSelected ? 'color-mix(in srgb, var(--qv-color-primary) 18%, var(--qv-surface-card))' : 'var(--qv-surface-card)',
                              color: isSelected ? 'var(--qv-color-primary)' : 'var(--qv-text-secondary)',
                            }}
                          >
                            {preset}
                          </button>
                        );
                      })}
                    </div>

                    <FormField
                      htmlFor="distintivo-valor-numero"
                      label="Número Distintivo"
                      helperText="Ej. 120-A, 120-B, Bis."
                    >
                      <Input
                        id="distintivo-valor-numero"
                        placeholder="Ej. 120-A"
                        value={values.distintivoValor}
                        onChange={(e) => setField('distintivoValor', e.target.value)}
                        fullWidth
                      />
                    </FormField>
                  </div>
                )}

                {/* ── CASO 4: TEXTO LIBRE DE RUTA ── */}
                {values.distintivoTipo === 'texto' && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.85rem',
                      padding: '1.25rem',
                      borderRadius: 'var(--qv-radius-lg)',
                      backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                      border: '1px solid var(--qv-border-glass)',
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.45rem',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        color: 'var(--qv-text-primary)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      <Type size={15} style={{ color: 'var(--qv-color-primary)' }} />
                      Texto Descriptivo de Trayecto
                    </span>

                    <p style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', margin: 0, lineHeight: 1.4 }}>
                      Sugerencias de itinerarios y vías destacadas:
                    </p>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      {PRESETS_TEXTO.map((preset) => {
                        const isSelected = values.distintivoValor === preset;
                        return (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setField('distintivoValor', preset)}
                            style={{
                              padding: '0.35rem 0.65rem',
                              borderRadius: 'var(--qv-radius-full)',
                              fontSize: '0.72rem',
                              fontWeight: isSelected ? 800 : 600,
                              cursor: 'pointer',
                              border: isSelected ? '1px solid var(--qv-color-primary)' : '1px solid var(--qv-border-glass)',
                              backgroundColor: isSelected ? 'color-mix(in srgb, var(--qv-color-primary) 18%, var(--qv-surface-card))' : 'var(--qv-surface-card)',
                              color: isSelected ? 'var(--qv-color-primary)' : 'var(--qv-text-secondary)',
                            }}
                          >
                            {preset}
                          </button>
                        );
                      })}
                    </div>

                    <FormField
                      htmlFor="distintivo-valor-texto"
                      label="Descripción de Ruta"
                      helperText="Texto que describe por dónde pasa esta variante."
                    >
                      <Input
                        id="distintivo-valor-texto"
                        placeholder="Ej. Por la Chimba, Cruz de Mayo"
                        value={values.distintivoValor}
                        onChange={(e) => setField('distintivoValor', e.target.value)}
                        fullWidth
                      />
                    </FormField>
                  </div>
                )}

                {/* ── CASO 5: SÍMBOLO ESPECIAL ── */}
                {values.distintivoTipo === 'simbolo' && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.85rem',
                      padding: '1.25rem',
                      borderRadius: 'var(--qv-radius-lg)',
                      backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                      border: '1px solid var(--qv-border-glass)',
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.45rem',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        color: 'var(--qv-text-primary)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      <Shapes size={15} style={{ color: 'var(--qv-color-primary)' }} />
                      Símbolo Gráfico de Recorrido
                    </span>

                    <p style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', margin: 0, lineHeight: 1.4 }}>
                      Selecciona un glifo o símbolo distintivo:
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(7.5rem, 1fr))', gap: '0.5rem' }}>
                      {PRESETS_SIMBOLO.map((item) => {
                        const isSelected = values.distintivoValor?.includes(item.simbolo);
                        return (
                          <button
                            key={item.simbolo}
                            type="button"
                            onClick={() => setField('distintivoValor', `${item.simbolo} ${item.label}`)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.45rem',
                              padding: '0.5rem 0.65rem',
                              borderRadius: 'var(--qv-radius-md)',
                              fontSize: '0.75rem',
                              fontWeight: isSelected ? 800 : 600,
                              cursor: 'pointer',
                              border: isSelected ? '1.5px solid #f59e0b' : '1px solid var(--qv-border-glass)',
                              backgroundColor: isSelected ? 'rgba(245, 158, 11, 0.15)' : 'var(--qv-surface-card)',
                              color: isSelected ? '#f59e0b' : 'var(--qv-text-primary)',
                            }}
                          >
                            <span style={{ fontSize: '1rem' }}>{item.simbolo}</span>
                            <span>{item.label}</span>
                          </button>
                        );
                      })}
                    </div>

                    <FormField
                      htmlFor="distintivo-valor-simbolo"
                      label="Símbolo o Figura"
                      helperText="Glifo gráfico identificador."
                    >
                      <Input
                        id="distintivo-valor-simbolo"
                        placeholder="Ej. ★ Estrella, ▲ Triángulo"
                        value={values.distintivoValor}
                        onChange={(e) => setField('distintivoValor', e.target.value)}
                        fullWidth
                      />
                    </FormField>
                  </div>
                )}

                {/* ── CASO 6: NINGUNO (ESTÁNDAR) ── */}
                {(!values.distintivoTipo || values.distintivoTipo === 'ninguno') && (
                  <div
                    style={{
                      padding: '1rem 1.25rem',
                      borderRadius: 'var(--qv-radius-lg)',
                      backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 45%, transparent)',
                      border: '1px dashed var(--qv-border-glass)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      color: 'var(--qv-text-secondary)',
                      fontSize: '0.78rem',
                      lineHeight: 1.4,
                    }}
                  >
                    <Bus size={18} style={{ color: 'var(--qv-color-primary)', flexShrink: 0 }} />
                    <div>
                      <strong style={{ color: 'var(--qv-text-primary)', display: 'block', marginBottom: '0.15rem' }}>
                        Modo Estándar Activo
                      </strong>
                      Esta línea no utiliza distintivos secundarios. Los vehículos se identificarán únicamente por su código oficial y el letrero de techo superior.
                    </div>
                  </div>
                )}

                <div style={{ width: '100%' }}>
                  <FormField
                    htmlFor="cartel-superior-texto"
                    label="Texto Operativo del Recorrido (Cartel Superior)"
                    helperText="Resumen de destinos y puntos clave que verá el pasajero en la app."
                  >
                    <Input
                      id="cartel-superior-texto"
                      placeholder="Ej. TIQUIPAYA · UNIVALLE · 120"
                      value={values.cartelSuperior}
                      onChange={(e) => setField('cartelSuperior', e.target.value)}
                      fullWidth
                    />
                  </FormField>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--qv-border-glass)', width: '100%' }}>
                  <Button variant="ghost" type="button" onClick={() => setActiveSection('03')} size="sm">
                    <ArrowLeft size={14} style={{ marginRight: '6px' }} />
                    <span>Paleta (03)</span>
                  </Button>
                  <Button type="button" onClick={() => setActiveSection('05')} size="sm">
                    <span>Siguiente: Letrero (05)</span>
                    <ArrowRight size={14} style={{ marginLeft: '6px' }} />
                  </Button>
                </div>
              </section>
            );
          })()}

          {/* ── SECCIÓN 05: Letrero de Techo ── */}
          {activeSection === '05' && (
            <section
              className="vehicle-panel-main"
              aria-label="Letrero de Techo"
              style={{
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.25rem',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  borderBottom: '1px solid var(--qv-border-glass)',
                  paddingBottom: '0.75rem',
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '1.85rem',
                    height: '1.85rem',
                    borderRadius: '50%',
                    backgroundColor: 'color-mix(in srgb, var(--qv-color-primary) 15%, transparent)',
                    color: 'var(--qv-color-primary)',
                    fontWeight: 800,
                    fontSize: '0.8125rem',
                  }}
                >
                  05
                </span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--qv-text-primary)' }}>
                    Composición y Tintas del Letrero de Techo
                  </h3>
                  <p style={{ margin: '0.1rem 0 0 0', fontSize: '0.75rem', color: 'var(--qv-text-secondary)' }}>
                    Estructura física del cartel frontal, títulos de destino y tintas de serigrafía.
                  </p>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', width: '100%' }}>
                <FormField htmlFor="cartel-formato" label="Formato del Letrero">
                  <Select
                    id="cartel-formato"
                    options={[
                      { label: 'Doble clásico (referencia 120)', value: 'doble_clasico' },
                      { label: 'Una sola línea', value: 'simple' },
                      { label: 'Tres renglones', value: 'tres_lineas' },
                    ]}
                    value={values.cartelFormato}
                    onChange={(e) => setField('cartelFormato', e.target.value)}
                    fullWidth
                  />
                </FormField>

                <FormField htmlFor="cartel-num-pos" label="Posición del Número">
                  <Select
                    id="cartel-num-pos"
                    options={[
                      { label: 'A la izquierda', value: 'izquierda' },
                      { label: 'A la derecha', value: 'derecha' },
                    ]}
                    value={values.cartelNumeroPosicion}
                    onChange={(e) => setField('cartelNumeroPosicion', e.target.value)}
                    fullWidth
                  />
                </FormField>

                <FormField htmlFor="cartel-logo-pos" label="Logo en el Letrero">
                  <Select
                    id="cartel-logo-pos"
                    options={[
                      { label: 'Sin logo dentro del letrero', value: 'ninguno' },
                      { label: 'A la izquierda', value: 'izquierda' },
                      { label: 'A la derecha', value: 'derecha' },
                    ]}
                    value={values.cartelLogoPosicion}
                    onChange={(e) => setField('cartelLogoPosicion', e.target.value)}
                    fullWidth
                  />
                </FormField>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', width: '100%' }}>
                <FormField htmlFor="cartel-titulo" label="Título Superior (Destino Principal)">
                  <Input
                    id="cartel-titulo"
                    placeholder="Ej. TIQUIPAYA"
                    value={values.cartelTitulo}
                    onChange={(e) => setField('cartelTitulo', e.target.value)}
                    fullWidth
                  />
                </FormField>

                <FormField htmlFor="cartel-detalle" label="Detalle Inferior (Sub-destino o zona)">
                  <Input
                    id="cartel-detalle"
                    placeholder="Ej. UNIVALLE"
                    value={values.cartelDetalle}
                    onChange={(e) => setField('cartelDetalle', e.target.value)}
                    fullWidth
                  />
                </FormField>
              </div>

              {/* Tintas y Colores del Letrero a Ancho Completo */}
              <div
                style={{
                  padding: '1.15rem 1.25rem',
                  borderRadius: 'var(--qv-radius-lg)',
                  backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                  border: '1px solid var(--qv-border-glass)',
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              >
                <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--qv-text-secondary)', display: 'block', marginBottom: '0.75rem' }}>
                  Tintas de Impresión del Letrero
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.85rem', width: '100%' }}>
                  <FormField htmlFor="cartel-col-num" label="Color Número">
                    <ColorPicker id="cartel-col-num" value={values.cartelColorNumero} onChange={(val) => setField('cartelColorNumero', val)} />
                  </FormField>

                  <FormField htmlFor="cartel-col-tit" label="Color Título">
                    <ColorPicker id="cartel-col-tit" value={values.cartelColorTitulo} onChange={(val) => setField('cartelColorTitulo', val)} />
                  </FormField>

                  <FormField htmlFor="cartel-col-det" label="Color Detalle">
                    <ColorPicker id="cartel-col-det" value={values.cartelColorDetalle} onChange={(val) => setField('cartelColorDetalle', val)} />
                  </FormField>

                  <FormField htmlFor="cartel-col-bor" label="Color Borde">
                    <ColorPicker id="cartel-col-bor" value={values.cartelColorBorde} onChange={(val) => setField('cartelColorBorde', val)} />
                  </FormField>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--qv-border-glass)', width: '100%' }}>
                <Button variant="ghost" type="button" onClick={() => setActiveSection('04')} size="sm">
                  <ArrowLeft size={14} style={{ marginRight: '6px' }} />
                  <span>Señalización (04)</span>
                </Button>
              </div>
            </section>
          )}

        </form>
      </div>

      {/* Columna Derecha: Panel de Vista Previa Fija e Interactiva */}
      <aside className="vehicle-preview-sidebar">
        {/* Barra de progreso de completitud */}
        <div
          style={{
            padding: '0.75rem 0.85rem',
            borderRadius: 'var(--qv-radius-md)',
            backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
            border: '1px solid var(--qv-border-glass)',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.35rem' }}>
            <span style={{ color: 'var(--qv-text-secondary)', fontWeight: 600 }}>Completitud de Ficha</span>
            <strong style={{ color: 'var(--qv-text-primary)', fontWeight: 800 }}>{completionPercentage}%</strong>
          </div>
          <div
            style={{
              width: '100%',
              height: '5px',
              borderRadius: '999px',
              backgroundColor: 'var(--qv-surface-card)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${completionPercentage}%`,
                height: '100%',
                borderRadius: '999px',
                backgroundColor: 'var(--qv-color-primary)',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        </div>

        {/* Componente de Vista Previa en Vivo del Letrero e Identidad */}
        <LineaBoxPreview values={values as unknown as Record<string, string>} />

        {/* ── Acciones Fijas Disponibles en Todo Momento ── */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.45rem',
            paddingTop: '0.85rem',
            borderTop: '1px solid var(--qv-border-glass)',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          <Button
            type="submit"
            form="linea-form"
            disabled={isSaving || isUploadingLogo}
            fullWidth
            size="md"
            style={{
              boxShadow: '0 4px 14px color-mix(in srgb, var(--qv-color-primary) 35%, transparent)',
              fontWeight: 700,
            }}
          >
            <Save size={15} style={{ marginRight: '6px' }} />
            <span>{isSaving ? 'Guardando...' : linea ? 'Guardar cambios' : 'Guardar línea'}</span>
          </Button>
          <Button
            variant="ghost"
            type="button"
            onClick={onClose}
            disabled={isSaving}
            fullWidth
            size="sm"
          >
            Cancelar
          </Button>
        </div>
      </aside>
    </div>
  );
}
