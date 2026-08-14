'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Alert, Button, FormField, Input, PlateBadge, Select } from '@quivo/design-system';
import {
  COLORES_VEHICULO,
  CrearVehiculoSchema,
  MARCAS_VEHICULO_INICIALES,
  PlacaVehiculoSchema,
  TIPOS_VEHICULO,
  normalizarPlacaVehiculo,
  type ActualizarVehiculo,
  type ColorVehiculo,
  type CrearVehiculo,
  type EstadoVehiculo,
  type Socio,
  type TipoVehiculo,
  type Vehiculo,
  type VerificacionPlacaVehiculo,
} from '@quivo/shared';
import {
  AlertTriangle,
  Building2,
  Bus,
  Check,
  Clock3,
  Gauge,
  Package,
  Palette,
  Save,
  ShieldCheck,
  Tag,
  Users,
  Wrench,
  X,
} from 'lucide-react';

interface Option {
  label: string;
  value: string;
}

interface VehicleFormPanelProps {
  vehicle: Vehiculo | null;
  sindicatoIdDelActor: string | null;
  esAdminQuivo: boolean;
  sindicatoOptions: Option[];
  socios: Socio[];
  onClose: () => void;
  onSave: (data: CrearVehiculo | ActualizarVehiculo) => Promise<void>;
  onVerifyPlate: (placa: string) => Promise<VerificacionPlacaVehiculo>;
}

interface FormValues {
  placa: string;
  tipo: TipoVehiculo | '';
  sindicatoId: string;
  socioId: string;
  marcaCatalogo: string;
  marca: string;
  modelo: string;
  color: ColorVehiculo | '';
  colorSecundario: ColorVehiculo | '';
  capacidad: string;
  estado: string;
}

const MARCA_OTRA = '__otra';

const NOMBRE_ESTADO: Record<string, string> = {
  pendiente: 'Pendiente de validación',
  activo: 'Activo',
  inactivo: 'Inactivo',
  suspendido: 'Suspendido',
  mantenimiento: 'En mantenimiento',
};

const ESPECIFICACIONES_TIPO: Record<
  string,
  {
    usoRecomendado: string;
    caracteristicas: string;
    tipoServicio: string;
  }
> = {
  taxi_trufi: {
    usoRecomendado: 'Rutas fijas cortas / Troncal',
    caracteristicas: 'Rapidez y frecuencia alta',
    tipoServicio: 'Transporte público compartido',
  },
  trufi: {
    usoRecomendado: 'Rutas barriales y conexiones',
    caracteristicas: 'Maniobrabilidad y confort',
    tipoServicio: 'Transporte de radio urbano',
  },
  minibus: {
    usoRecomendado: 'Rutas interurbanas y principales',
    caracteristicas: 'Comodidad y buena capacidad',
    tipoServicio: 'Transporte público masivo',
  },
  micro: {
    usoRecomendado: 'Rutas de alta demanda urbana',
    caracteristicas: 'Estructura robusta y gran capacidad',
    tipoServicio: 'Transporte colectivo masivo',
  },
  bus_urbano: {
    usoRecomendado: 'Corredores principales de la ciudad',
    caracteristicas: 'Máximo aforo y accesibilidad',
    tipoServicio: 'Transporte público metropolitano',
  },
  omnibus: {
    usoRecomendado: 'Rutas interdepartamentales / Larga distancia',
    caracteristicas: 'Asientos reclinables y maleteros',
    tipoServicio: 'Transporte interprovincial',
  },
};

function valoresIniciales(vehicle: Vehiculo | null, sindicatoId: string | null): FormValues {
  const marcaEnCatalogo =
    vehicle && MARCAS_VEHICULO_INICIALES.some((marca) => marca === vehicle.marca);
  return {
    placa: vehicle?.placa ?? '',
    tipo: vehicle?.tipo ?? 'minibus',
    sindicatoId: vehicle?.sindicatoId ?? sindicatoId ?? '',
    socioId: vehicle?.socioId ?? '',
    marcaCatalogo: vehicle ? (marcaEnCatalogo ? vehicle.marca : MARCA_OTRA) : '',
    marca: vehicle?.marca ?? '',
    modelo: vehicle?.modelo ?? '',
    color: vehicle?.color ?? 'blanco',
    colorSecundario: vehicle?.colorSecundario ?? '',
    capacidad: String(vehicle?.capacidad ?? 20),
    estado: vehicle?.estado ?? 'activo',
  };
}

export function VehicleFormPanel({
  vehicle,
  sindicatoIdDelActor,
  esAdminQuivo,
  sindicatoOptions,
  socios,
  onClose,
  onSave,
  onVerifyPlate,
}: VehicleFormPanelProps) {
  const [values, setValues] = useState<FormValues>(() =>
    valoresIniciales(vehicle, sindicatoIdDelActor),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isVerifyingPlate, setIsVerifyingPlate] = useState(false);
  const [plateVerification, setPlateVerification] = useState<VerificacionPlacaVehiculo | null>(
    null,
  );

  useEffect(() => {
    setValues(valoresIniciales(vehicle, sindicatoIdDelActor));
    setErrors({});
    setFormError(null);
    setPlateVerification(null);
  }, [vehicle, sindicatoIdDelActor]);

  const sociosDisponibles = useMemo(
    () =>
      socios.filter(
        (socio) => socio.sindicatoId === values.sindicatoId && socio.estado === 'activo',
      ),
    [socios, values.sindicatoId],
  );

  const tipoSeleccionado =
    TIPOS_VEHICULO.find((t) => t.codigo === values.tipo) ?? TIPOS_VEHICULO[2];
  const capacidad = Number(values.capacidad);
  const capacidadAtipica =
    tipoSeleccionado &&
    Number.isInteger(capacidad) &&
    ((tipoSeleccionado.capacidadMinReferencial !== null &&
      capacidad < tipoSeleccionado.capacidadMinReferencial) ||
      (tipoSeleccionado.capacidadMaxReferencial !== null &&
        capacidad > tipoSeleccionado.capacidadMaxReferencial));
  const placaNormalizada = normalizarPlacaVehiculo(values.placa);
  const placaTieneFormatoValido = PlacaVehiculoSchema.safeParse(values.placa).success;
  const completionChecks = [
    placaTieneFormatoValido,
    Boolean(values.tipo),
    Boolean(values.sindicatoId),
    Boolean(values.marca.trim()),
    Boolean(values.modelo.trim()),
    Boolean(values.color),
    Number.isInteger(capacidad) && capacidad >= 1 && capacidad <= 200,
  ];
  const completedFields = completionChecks.filter(Boolean).length;
  const completionPercentage = Math.round((completedFields / completionChecks.length) * 100);

  const setField = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => {
      if (!previous[key]) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };

  const handlePlateChange = (value: string) => {
    setField(
      'placa',
      value
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 7),
    );
    setPlateVerification(null);
  };

  const verifyPlate = async () => {
    const parsed = PlacaVehiculoSchema.safeParse(values.placa);
    if (!parsed.success) {
      setErrors((previous) => ({
        ...previous,
        placa: parsed.error.issues[0]?.message ?? 'La placa no es válida.',
      }));
      setPlateVerification(null);
      return;
    }
    if (placaNormalizada === vehicle?.placaNormalizada) return;
    setIsVerifyingPlate(true);
    try {
      setPlateVerification(await onVerifyPlate(values.placa));
    } catch {
      setPlateVerification(null);
    } finally {
      setIsVerifyingPlate(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    if (plateVerification && !plateVerification.disponible) {
      setErrors((previous) => ({
        ...previous,
        placa: 'Ya existe un vehículo registrado con esta placa.',
      }));
      document.getElementById('vehiculo-placa')?.focus();
      return;
    }

    const payload = {
      placa: values.placa,
      tipo: values.tipo,
      sindicatoId: values.sindicatoId,
      socioId: values.socioId || null,
      marca: values.marca,
      modelo: values.modelo,
      color: values.color,
      colorSecundario: values.colorSecundario || null,
      capacidad,
      estado: vehicle ? (values.estado as EstadoVehiculo) : ('pendiente' as const),
    };

    const parsed = CrearVehiculoSchema.safeParse(payload);
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        nextErrors[key] ??= issue.message;
      }
      setErrors(nextErrors);
      const firstField = String(parsed.error.issues[0]?.path[0] ?? '');
      document.getElementById(`vehiculo-${firstField}`)?.focus();
      return;
    }

    setIsSaving(true);
    try {
      if (vehicle) {
        const update: ActualizarVehiculo = {
          placa: parsed.data.placa,
          socioId: parsed.data.socioId,
          tipo: parsed.data.tipo,
          marca: parsed.data.marca,
          modelo: parsed.data.modelo,
          color: parsed.data.color,
          colorSecundario: parsed.data.colorSecundario,
          capacidad: parsed.data.capacidad,
        };
        await onSave(update);
      } else {
        await onSave(parsed.data);
      }
    } catch (error: unknown) {
      setFormError(error instanceof Error ? error.message : 'No se pudo guardar el vehículo.');
    } finally {
      setIsSaving(false);
    }
  };

  const marcaOptions = [
    ...MARCAS_VEHICULO_INICIALES.map((marca) => ({ label: marca, value: marca })),
    { label: 'Otra marca', value: MARCA_OTRA },
  ];

  const especificaciones = ESPECIFICACIONES_TIPO[values.tipo] || {
    usoRecomendado: 'Transporte público urbano',
    caracteristicas: 'Comodidad y seguridad',
    tipoServicio: 'Transporte de pasajeros',
  };
  const colorPrincipalNombre =
    COLORES_VEHICULO.find((color) => color.codigo === values.color)?.nombre ?? 'Sin definir';
  const colorSecundarioNombre = values.colorSecundario
    ? COLORES_VEHICULO.find((color) => color.codigo === values.colorSecundario)?.nombre
    : null;

  return (
    <div className="vehicle-form-panel">
      {/* Encabezado del Panel */}
      <header className="vehicle-panel-header">
        <div className="vehicle-panel-header__info">
          <div className="vehicle-panel-header__icon">
            <Bus size={22} />
          </div>
          <div>
            <span className="vehicle-panel-header__eyebrow">
              {vehicle ? 'Ficha técnica de la unidad' : 'Nueva unidad · Registro guiado'}
            </span>
            <h2>{vehicle ? 'Editar vehículo' : 'Registrar vehículo'}</h2>
            <p>
              {vehicle
                ? 'Modifica la información general y técnica de la unidad.'
                : 'Completa la información para agregar un nuevo vehículo a la flota.'}
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
        <Alert variant="danger" title="No se pudo guardar" style={{ margin: '0 1.5rem 1.5rem' }}>
          {formError}
        </Alert>
      )}

      {/* Formulario Principal + Panel Lateral */}
      <form id="vehicle-form" className="vehicle-panel-body" onSubmit={handleSubmit} noValidate>
        <div className="vehicle-panel-main">
          {/* Fila: Placa e Insignia Boliviana */}
          <section className="vehicle-form-section">
            <div className="vehicle-form-section__heading">
              <span>01</span>
              <div>
                <h3>Identificación de la unidad</h3>
                <p>La placa se normaliza y verifica automáticamente en toda la red QUIVO.</p>
              </div>
            </div>
            <div className="vehicle-plate-row">
              <div className="vehicle-plate-row__input">
                <FormField
                  label="Placa *"
                  htmlFor="vehiculo-placa"
                  required
                  error={errors.placa}
                  helperText={
                    isVerifyingPlate
                      ? 'Verificando disponibilidad...'
                      : plateVerification?.disponible
                        ? 'Formato RUAT válido · placa disponible'
                        : placaNormalizada === vehicle?.placaNormalizada
                          ? 'Placa actual de esta unidad'
                          : 'Formato RUAT: 123ABC o 1234ABC, sin espacios ni guiones'
                  }
                >
                  <Input
                    id="vehiculo-placa"
                    value={values.placa}
                    onChange={(event) => handlePlateChange(event.target.value)}
                    onBlur={verifyPlate}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder="1234ABC"
                    maxLength={7}
                    pattern="[0-9]{3,4}[A-Za-z]{3}"
                    fullWidth
                  />
                </FormField>
                {plateVerification && !plateVerification.disponible && (
                  <Alert variant="danger" title="Placa duplicada" style={{ marginTop: '0.5rem' }}>
                    Ya registrada en{' '}
                    {plateVerification.coincidencia?.sindicatoNombre ?? 'otro sindicato'}.
                  </Alert>
                )}
                {plateVerification?.disponible && (
                  <div className="vehicle-plate-validation vehicle-plate-validation--success">
                    <Check size={15} strokeWidth={3} aria-hidden="true" />
                    <span>La placa cumple el formato boliviano y está disponible.</span>
                  </div>
                )}
              </div>

              <PlateBadge
                plate={placaNormalizada || '123ABC'}
                className="vehicle-form-live-plate"
              />
            </div>
          </section>

          {/* Selector de Tipo de Vehículo */}
          <section className="vehicle-form-section">
            <div className="vehicle-form-section__heading">
              <span>02</span>
              <div>
                <h3>Configuración operativa</h3>
                <p>Selecciona la carrocería para obtener referencias de capacidad y uso.</p>
              </div>
            </div>
            <div className="vehicle-type-section">
              <label className="vehicle-type-section__label">Tipo de vehículo *</label>
              <div
                className="vehicle-type-cards-grid"
                role="radiogroup"
                aria-label="Tipo de vehículo"
              >
                {TIPOS_VEHICULO.map((t) => {
                  const selected = values.tipo === t.codigo;
                  return (
                    <button
                      key={t.codigo}
                      type="button"
                      className={`vehicle-type-card-btn ${selected ? 'vehicle-type-card-btn--active' : ''}`}
                      onClick={() => setField('tipo', t.codigo as TipoVehiculo)}
                      role="radio"
                      aria-checked={selected}
                    >
                      {selected && (
                        <span className="vehicle-type-card-btn__badge">
                          <Check size={12} strokeWidth={3} />
                        </span>
                      )}
                      <VehicleIconIllustration tipo={t.codigo as TipoVehiculo} />
                      <span className="vehicle-type-card-btn__title">{t.nombre}</span>
                    </button>
                  );
                })}
              </div>
              <small className="vehicle-type-section__hint">
                Selecciona el tipo de vehículo que mejor lo describe.
              </small>
            </div>
          </section>

          {/* Grid de Formulario de 2 Columnas (Layout Exacto del Mockup) */}
          <section className="vehicle-form-section">
            <div className="vehicle-form-section__heading">
              <span>03</span>
              <div>
                <h3>Propiedad y ficha técnica</h3>
                <p>Completa los datos que identificarán la unidad en controles y reportes.</p>
              </div>
            </div>
            <div className="vehicle-form-grid">
              {/* Fila 1: Sindicato | Color principal */}
              {esAdminQuivo && !vehicle ? (
                <FormField
                  label="Sindicato *"
                  htmlFor="vehiculo-sindicatoId"
                  required
                  error={errors.sindicatoId}
                >
                  <Select
                    id="vehiculo-sindicatoId"
                    options={sindicatoOptions}
                    placeholder="Selecciona un sindicato"
                    value={values.sindicatoId}
                    onChange={(event) => {
                      setField('sindicatoId', event.target.value);
                      setField('socioId', '');
                    }}
                    fullWidth
                  />
                </FormField>
              ) : (
                <FormField label="Sindicato *" htmlFor="vehiculo-sindicato-disabled">
                  <Input
                    id="vehiculo-sindicato-disabled"
                    value={
                      sindicatoOptions.find((o) => o.value === values.sindicatoId)?.label ??
                      'Sindicato 1º de Mayo'
                    }
                    disabled
                    leftSlot={<Building2 size={16} className="input-icon" />}
                    fullWidth
                  />
                </FormField>
              )}

              <FormField
                label="Color principal *"
                htmlFor="vehiculo-color"
                required
                error={errors.color}
              >
                <div className="color-select-wrapper">
                  <span
                    className="color-dot-indicator"
                    style={{ background: colorMuestra(values.color) }}
                  />
                  <Select
                    id="vehiculo-color"
                    options={COLORES_VEHICULO.map((c) => ({ label: c.nombre, value: c.codigo }))}
                    value={values.color}
                    onChange={(event) => setField('color', event.target.value as ColorVehiculo)}
                    fullWidth
                  />
                </div>
              </FormField>

              {/* Fila 2: Socio propietario | Color secundario */}
              <FormField
                label="Socio propietario *"
                htmlFor="vehiculo-socioId"
                error={errors.socioId}
                helperText={!values.socioId ? 'Sin propietario no podrá activarse' : undefined}
              >
                <Select
                  id="vehiculo-socioId"
                  options={sociosDisponibles.map((socio) => ({
                    label: `${socio.nombre} · ${socio.documentoIdentidad}`,
                    value: socio.id,
                  }))}
                  placeholder={
                    values.sindicatoId ? 'Selecciona un socio' : 'Selecciona primero el sindicato'
                  }
                  value={values.socioId}
                  onChange={(event) => setField('socioId', event.target.value)}
                  disabled={!values.sindicatoId}
                  fullWidth
                />
              </FormField>

              <FormField
                label="Color secundario"
                htmlFor="vehiculo-colorSecundario"
                error={errors.colorSecundario}
              >
                <div className="color-select-wrapper">
                  <span
                    className="color-dot-indicator"
                    style={{
                      background: values.colorSecundario
                        ? colorMuestra(values.colorSecundario)
                        : '#cbd5e1',
                    }}
                  />
                  <Select
                    id="vehiculo-colorSecundario"
                    options={[
                      { label: 'Ninguno', value: '' },
                      ...COLORES_VEHICULO.map((c) => ({ label: c.nombre, value: c.codigo })),
                    ]}
                    value={values.colorSecundario}
                    onChange={(event) =>
                      setField('colorSecundario', event.target.value as ColorVehiculo)
                    }
                    fullWidth
                  />
                </div>
              </FormField>

              {/* Fila 3: Marca | Capacidad */}
              <FormField
                label="Marca *"
                htmlFor="vehiculo-marcaCatalogo"
                required
                error={errors.marca}
              >
                <Select
                  id="vehiculo-marcaCatalogo"
                  options={marcaOptions}
                  placeholder="Selecciona una marca"
                  value={values.marcaCatalogo}
                  onChange={(event) => {
                    const selected = event.target.value;
                    setField('marcaCatalogo', selected);
                    setField('marca', selected === MARCA_OTRA ? '' : selected);
                  }}
                  fullWidth
                />
              </FormField>

              <FormField
                label="Capacidad *"
                htmlFor="vehiculo-capacidad"
                required
                error={errors.capacidad}
              >
                <Input
                  id="vehiculo-capacidad"
                  type="number"
                  min={1}
                  max={200}
                  step={1}
                  value={values.capacidad}
                  onChange={(event) => setField('capacidad', event.target.value)}
                  leftSlot={<Users size={16} className="input-icon" />}
                  rightSlot="pasajeros"
                  fullWidth
                />
              </FormField>

              {values.marcaCatalogo === MARCA_OTRA && (
                <FormField
                  label="Otra marca *"
                  htmlFor="vehiculo-marca-otra"
                  required
                  error={errors.marca}
                >
                  <Input
                    id="vehiculo-marca-otra"
                    value={values.marca}
                    onChange={(event) => setField('marca', event.target.value)}
                    placeholder="Especifica la marca"
                    maxLength={50}
                    fullWidth
                  />
                </FormField>
              )}

              <FormField label="Modelo *" htmlFor="vehiculo-modelo" required error={errors.modelo}>
                <Input
                  id="vehiculo-modelo"
                  value={values.modelo}
                  onChange={(event) => setField('modelo', event.target.value)}
                  placeholder="Ej. LO-915"
                  maxLength={50}
                  leftSlot={<Package size={16} className="input-icon" />}
                  fullWidth
                />
              </FormField>

              <div className="vehicle-state-summary">
                <span
                  className={`vehicle-state-summary__dot vehicle-state-summary__dot--${vehicle ? values.estado : 'pendiente'}`}
                  aria-hidden="true"
                />
                <div>
                  <small>Estado de la unidad</small>
                  <strong>{NOMBRE_ESTADO[vehicle ? values.estado : 'pendiente']}</strong>
                  <span>
                    {vehicle
                      ? 'El estado se gestiona desde las acciones del listado.'
                      : 'Toda unidad nueva se registra pendiente hasta completar su validación.'}
                  </span>
                </div>
              </div>
            </div>

            {capacidadAtipica && (
              <div className="vehicle-capacity-warning" role="status">
                <AlertTriangle size={18} aria-hidden="true" />
                <span>
                  La capacidad es poco habitual para el tipo seleccionado. Verifica el dato antes de
                  guardar.
                </span>
              </div>
            )}
          </section>
        </div>

        {/* Panel Lateral Derecho: Vista Previa y Especificaciones */}
        <aside className="vehicle-preview-sidebar">
          <div className="vehicle-preview-sidebar__header">
            <div>
              <span className="vehicle-preview-sidebar__eyebrow">Ficha en vivo</span>
              <h3>Vista previa</h3>
              <p>Los cambios se reflejan mientras completas el registro.</p>
            </div>
            <div
              className="vehicle-preview-sidebar__progress"
              aria-label={`${completionPercentage}% completo`}
            >
              <div>
                <span>Datos esenciales</span>
                <strong>{completionPercentage}%</strong>
              </div>
              <span className="vehicle-preview-sidebar__progress-track">
                <span style={{ width: `${completionPercentage}%` }} />
              </span>
            </div>
          </div>

          {/* Imagen / Ilustración Destacada del Vehículo */}
          <div className="vehicle-preview-sidebar__graphic">
            <VehicleDetailedIllustration tipo={values.tipo || 'minibus'} color={values.color} />
            <PlateBadge
              plate={placaNormalizada || 'SIN PLACA'}
              className="vehicle-preview-sidebar__plate-badge"
            />
          </div>

          <div className="vehicle-preview-sidebar__tags">
            <div className="vehicle-preview-sidebar__tag">
              <Tag size={14} />
              <span>{tipoSeleccionado?.nombre ?? 'Minibús'}</span>
            </div>
            <div className="vehicle-preview-sidebar__colors" aria-label="Colores seleccionados">
              <span style={{ background: colorMuestra(values.color) }} title="Color principal" />
              {values.colorSecundario && (
                <span
                  style={{ background: colorMuestra(values.colorSecundario) }}
                  title="Color secundario"
                />
              )}
            </div>
          </div>

          <p className="vehicle-preview-sidebar__description">
            {tipoSeleccionado?.descripcion ??
              'Vehículo mediano para transporte de pasajeros en rutas interurbanas.'}
          </p>

          <hr className="vehicle-preview-sidebar__divider" />

          {/* Lista de Especificaciones Típicas */}
          <div className="vehicle-preview-sidebar__specs">
            <div className="spec-item">
              <div className="spec-item__icon">
                <Gauge size={16} />
              </div>
              <div className="spec-item__text">
                <span className="spec-item__label">Capacidad estimada</span>
                <span className="spec-item__value">
                  {tipoSeleccionado?.capacidadMinReferencial &&
                  tipoSeleccionado?.capacidadMaxReferencial
                    ? `${tipoSeleccionado.capacidadMinReferencial} - ${tipoSeleccionado.capacidadMaxReferencial} pasajeros`
                    : `${values.capacidad || 20} pasajeros`}
                </span>
              </div>
            </div>

            <div className="spec-item">
              <div className="spec-item__icon">
                <Palette size={16} />
              </div>
              <div className="spec-item__text">
                <span className="spec-item__label">Configuración visual</span>
                <span className="spec-item__value">
                  {colorPrincipalNombre}
                  {colorSecundarioNombre ? ` + ${colorSecundarioNombre}` : ''}
                </span>
              </div>
            </div>

            <div className="spec-item">
              <div className="spec-item__icon">
                <ShieldCheck size={16} />
              </div>
              <div className="spec-item__text">
                <span className="spec-item__label">Uso recomendado</span>
                <span className="spec-item__value">{especificaciones.usoRecomendado}</span>
              </div>
            </div>

            <div className="spec-item">
              <div className="spec-item__icon">
                <Wrench size={16} />
              </div>
              <div className="spec-item__text">
                <span className="spec-item__label">Características</span>
                <span className="spec-item__value">{especificaciones.caracteristicas}</span>
              </div>
            </div>

            <div className="spec-item">
              <div className="spec-item__icon">
                <Bus size={16} />
              </div>
              <div className="spec-item__text">
                <span className="spec-item__label">Tipo de servicio</span>
                <span className="spec-item__value">{especificaciones.tipoServicio}</span>
              </div>
            </div>
          </div>
        </aside>
      </form>

      {/* Footer con Botones de Acción */}
      <footer className="vehicle-panel-footer">
        <div className="vehicle-panel-footer__note">
          <Clock3 size={15} aria-hidden="true" />
          <span>
            {vehicle
              ? 'Los cambios quedarán registrados.'
              : 'Podrás completar la validación después.'}
          </span>
        </div>
        <Button variant="ghost" onClick={onClose} disabled={isSaving}>
          Cancelar
        </Button>
        <Button type="submit" form="vehicle-form" disabled={isSaving}>
          <Save size={16} style={{ marginRight: '6px' }} />
          {isSaving ? 'Guardando...' : vehicle ? 'Guardar cambios' : 'Guardar vehículo'}
        </Button>
      </footer>
    </div>
  );
}

function colorMuestra(color: ColorVehiculo | ''): string {
  const muestra = COLORES_VEHICULO.find((item) => item.codigo === color)?.muestra;
  return muestra && !muestra.startsWith('linear') ? muestra : '#3b82f6';
}

function VehicleIconIllustration({ tipo }: { tipo: TipoVehiculo | 'otro' }) {
  switch (tipo) {
    case 'taxi_trufi':
      return (
        <svg
          width="44"
          height="24"
          viewBox="0 0 48 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M6 15L10 8H36L41 15H44V19H4V15H6Z"
            fill="#3b82f6"
            fillOpacity="0.15"
            stroke="#3b82f6"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="19" r="3" fill="#1e293b" />
          <circle cx="36" cy="19" r="3" fill="#1e293b" />
        </svg>
      );
    case 'trufi':
      return (
        <svg
          width="44"
          height="24"
          viewBox="0 0 48 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M4 6C4 4.89543 4.89543 4 6 4H36L44 14V19H4V6Z"
            fill="#3b82f6"
            fillOpacity="0.15"
            stroke="#3b82f6"
            strokeWidth="2"
          />
          <circle cx="12" cy="19" r="3" fill="#1e293b" />
          <circle cx="36" cy="19" r="3" fill="#1e293b" />
        </svg>
      );
    case 'minibus':
      return (
        <svg
          width="48"
          height="24"
          viewBox="0 0 48 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect
            x="3"
            y="4"
            width="41"
            height="15"
            rx="3"
            fill="#3b82f6"
            fillOpacity="0.2"
            stroke="#3b82f6"
            strokeWidth="2"
          />
          <rect x="7" y="7" width="8" height="6" rx="1" fill="#93c5fd" />
          <rect x="18" y="7" width="10" height="6" rx="1" fill="#93c5fd" />
          <rect x="31" y="7" width="9" height="6" rx="1" fill="#93c5fd" />
          <circle cx="11" cy="19" r="3" fill="#1e293b" />
          <circle cx="37" cy="19" r="3" fill="#1e293b" />
        </svg>
      );
    case 'micro':
      return (
        <svg
          width="48"
          height="24"
          viewBox="0 0 48 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Carrocería Micro Tradicional con trompa/capó */}
          <path
            d="M4 8C4 6.34 5.34 5 7 5H28C31 5 33 6.5 34.5 9.5L42 12.5V19H4V8Z"
            fill="#3b82f6"
            fillOpacity="0.2"
            stroke="#3b82f6"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <rect x="7" y="7" width="8" height="6" rx="1" fill="#93c5fd" />
          <rect x="17" y="7" width="9" height="6" rx="1" fill="#93c5fd" />
          <circle cx="11" cy="19" r="3.5" fill="#1e293b" />
          <circle cx="36" cy="19" r="3.5" fill="#1e293b" />
        </svg>
      );
    case 'bus_urbano':
      return (
        <svg
          width="52"
          height="24"
          viewBox="0 0 52 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect
            x="2"
            y="3"
            width="48"
            height="16"
            rx="2"
            fill="#3b82f6"
            fillOpacity="0.2"
            stroke="#3b82f6"
            strokeWidth="2"
          />
          <rect x="6" y="6" width="7" height="6" fill="#93c5fd" />
          <rect x="16" y="6" width="7" height="6" fill="#93c5fd" />
          <rect x="26" y="6" width="7" height="6" fill="#93c5fd" />
          <rect x="36" y="6" width="9" height="6" fill="#93c5fd" />
          <circle cx="12" cy="19" r="3.5" fill="#1e293b" />
          <circle cx="40" cy="19" r="3.5" fill="#1e293b" />
        </svg>
      );
    default:
      return (
        <svg
          width="44"
          height="24"
          viewBox="0 0 48 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect
            x="4"
            y="5"
            width="40"
            height="14"
            rx="2"
            fill="#3b82f6"
            fillOpacity="0.15"
            stroke="#3b82f6"
            strokeWidth="2"
          />
          <circle cx="12" cy="19" r="3" fill="#1e293b" />
          <circle cx="36" cy="19" r="3" fill="#1e293b" />
        </svg>
      );
  }
}

function VehicleDetailedIllustration({
  tipo,
  color,
}: {
  tipo: TipoVehiculo | 'otro';
  color: ColorVehiculo | '';
}) {
  const mainColor = colorMuestra(color);
  const hasImageAsset = ['taxi_trufi', 'trufi', 'minibus', 'micro', 'bus_urbano'].includes(tipo);

  if (hasImageAsset) {
    return (
      <div className={`vehicle-detailed-art vehicle-detailed-art--${tipo}`}>
        <img
          src={`/brand/vehicles/${tipo}.png`}
          alt={`Vista previa de ${tipo}`}
          className="vehicle-studio-img"
        />
      </div>
    );
  }

  return (
    <div className={`vehicle-detailed-art vehicle-detailed-art--${tipo}`}>
      <svg
        width="260"
        height="140"
        viewBox="0 0 260 140"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Sombra de suelo */}
        <ellipse cx="130" cy="128" rx="100" ry="8" fill="#e2e8f0" />

        {/* Cuerpo Principal del Vehículo */}
        <g id="vehicle-body">
          {/* Carrocería */}
          <path
            d="M20 98 V45 C20 38 26 32 34 32 H195 C208 32 220 40 226 52 L242 85 V98 H20 Z"
            fill="url(#bodyGradient)"
            stroke="#1e293b"
            strokeWidth="3"
            strokeLinejoin="round"
          />

          {/* Franja decorativa lateral */}
          <path d="M20 80 Q90 85 240 76 V88 Q110 94 20 88 Z" fill={mainColor} opacity="0.85" />

          {/* Ventanas */}
          <path
            d="M32 40 H75 V66 H32 Z"
            fill="url(#glassGradient)"
            stroke="#334155"
            strokeWidth="2"
          />
          <path
            d="M82 40 H130 V66 H82 Z"
            fill="url(#glassGradient)"
            stroke="#334155"
            strokeWidth="2"
          />
          <path
            d="M137 40 H185 V66 H137 Z"
            fill="url(#glassGradient)"
            stroke="#334155"
            strokeWidth="2"
          />
          <path
            d="M192 40 H204 C212 40 219 45 222 52 L228 66 H192 Z"
            fill="url(#glassGradient)"
            stroke="#334155"
            strokeWidth="2"
          />

          {/* Faros delantero y trasero */}
          <rect
            x="236"
            y="84"
            width="6"
            height="10"
            rx="2"
            fill="#fbbf24"
            stroke="#d97706"
            strokeWidth="1"
          />
          <rect x="20" y="84" width="4" height="12" rx="1" fill="#ef4444" />

          {/* Espejo retrovisor */}
          <path
            d="M222 56 L232 58 V66 L222 62 Z"
            fill="#475569"
            stroke="#1e293b"
            strokeWidth="1.5"
          />
        </g>

        {/* Ruedas y Aros */}
        <g id="wheels">
          {/* Rueda Trasera */}
          <circle cx="62" cy="98" r="18" fill="#1e293b" stroke="#0f172a" strokeWidth="2" />
          <circle cx="62" cy="98" r="10" fill="#94a3b8" />
          <circle cx="62" cy="98" r="5" fill="#f8fafc" />

          {/* Rueda Delantera */}
          <circle cx="196" cy="98" r="18" fill="#1e293b" stroke="#0f172a" strokeWidth="2" />
          <circle cx="196" cy="98" r="10" fill="#94a3b8" />
          <circle cx="196" cy="98" r="5" fill="#f8fafc" />
        </g>

        {/* Definicón de Gradientes */}
        <defs>
          <linearGradient
            id="bodyGradient"
            x1="130"
            y1="32"
            x2="130"
            y2="98"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#ffffff" />
            <stop offset="1" stopColor="#f1f5f9" />
          </linearGradient>
          <linearGradient id="glassGradient" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#bae6fd" stopOpacity="0.9" />
            <stop offset="1" stopColor="#38bdf8" stopOpacity="0.6" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}
