'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  FormField,
  Input,
  PlateBadge,
  Select,
} from '@quivo/design-system';
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
  type Socio,
  type TipoVehiculo,
  type Vehiculo,
  type VerificacionPlacaVehiculo,
} from '@quivo/shared';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Bus,
  Check,
  Clock3,
  Compass,
  Gauge,
  Layers,
  Map as MapIcon,
  Navigation,
  Package,
  Palette,
  Radio,
  Save,
  ShieldCheck,
  Sparkles,
  Tag,
  Users,
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
  numeroInterno: string;
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
    numeroInterno: vehicle?.numeroInterno ?? '',
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
  const [activeSection, setActiveSection] = useState<'01' | '02' | '03' | 'all'>('01');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isVerifyingPlate, setIsVerifyingPlate] = useState(false);
  const [plateVerification, setPlateVerification] = useState<VerificacionPlacaVehiculo | null>(
    null,
  );
  const [previewTab, setPreviewTab] = useState<'carroceria' | 'mapa'>('carroceria');

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
  const placaTieneFormatoValido = /^\d{3,4}[A-Z]{3}$/.test(placaNormalizada);

  const completionChecks = [
    placaTieneFormatoValido,
    Boolean(values.tipo),
    Boolean(values.sindicatoId),
    Boolean(values.socioId),
    Boolean(values.marca.trim()) && values.marca.trim().length >= 2,
    Boolean(values.modelo.trim()) && values.modelo.trim().length >= 2,
    Boolean(values.color),
    Number.isInteger(capacidad) && capacidad >= 1 && capacidad <= 200,
  ];
  const completedFields = completionChecks.filter(Boolean).length;
  const completionPercentage = Math.round((completedFields / completionChecks.length) * 100);

  // Funciones de validación en tiempo real campo a campo
  const validarCampo = (campo: keyof FormValues, valor: string): string | null => {
    switch (campo) {
      case 'placa': {
        const clean = normalizarPlacaVehiculo(valor);
        if (!clean) return 'Ingresa la placa del vehículo.';
        if (clean.length < 6 || clean.length > 7) {
          return 'La placa debe tener 6 o 7 caracteres (ej. 1234ABC o 123ABC).';
        }
        if (!/^\d{3,4}[A-Z]{3}$/.test(clean)) {
          return 'Formato RUAT: Los primeros 3 o 4 caracteres deben ser números y los 3 últimos letras (ej. 1234ABC).';
        }
        return null;
      }
      case 'numeroInterno': {
        if (!valor.trim()) return null;
        if (valor.trim().length > 30) return 'El número interno no puede exceder 30 caracteres.';
        if (!/^[\p{L}\p{N} .\-/]+$/u.test(valor.trim())) {
          return 'El número interno contiene caracteres especiales no permitidos.';
        }
        return null;
      }
      case 'sindicatoId': {
        if (!valor.trim()) return 'Selecciona el sindicato al que pertenece la unidad.';
        return null;
      }
      case 'socioId': {
        if (!valor.trim()) return 'Selecciona el socio propietario del vehículo.';
        return null;
      }
      case 'tipo': {
        if (!valor.trim()) return 'Selecciona el tipo de carrocería.';
        return null;
      }
      case 'marca': {
        const trim = valor.trim();
        if (!trim) return 'Ingresa la marca del vehículo.';
        if (trim.length < 2) return 'La marca debe tener al menos 2 caracteres.';
        if (trim.length > 50) return 'La marca no puede superar 50 caracteres.';
        return null;
      }
      case 'modelo': {
        const trim = valor.trim();
        if (!trim) return 'Ingresa el modelo del vehículo (ej. HiAce, Coaster).';
        if (trim.length < 2) return 'El modelo debe tener al menos 2 caracteres.';
        if (trim.length > 50) return 'El modelo no puede superar 50 caracteres.';
        return null;
      }
      case 'capacidad': {
        if (!valor.trim()) return 'Ingresa la capacidad de pasajeros.';
        const num = Number(valor);
        if (isNaN(num) || !Number.isInteger(num)) return 'La capacidad debe ser un número entero.';
        if (num < 1) return 'La capacidad debe ser de al menos 1 pasajero.';
        if (num > 200) return 'La capacidad no puede superar 200 pasajeros.';
        return null;
      }
      case 'color': {
        if (!valor) return 'Selecciona el color principal del vehículo.';
        return null;
      }
      case 'colorSecundario': {
        if (valor && valor === values.color) {
          return 'El color secundario debe ser diferente al color principal.';
        }
        return null;
      }
      default:
        return null;
    }
  };

  const setField = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    const error = validarCampo(key, value);
    setErrors((previous) => {
      const next = { ...previous };
      if (error) {
        next[key] = error;
      } else {
        delete next[key];
      }
      return next;
    });
  };

  const handleBlur = (campo: keyof FormValues) => {
    const error = validarCampo(campo, values[campo]);
    setErrors((previous) => {
      const next = { ...previous };
      if (error) {
        next[campo] = error;
      } else {
        delete next[campo];
      }
      return next;
    });
  };

  const handlePlateChange = (value: string) => {
    const formatted = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
    setField('placa', formatted);
    setPlateVerification(null);
  };

  const verifyPlate = async () => {
    handleBlur('placa');
    // Normalizar ANTES del safeParse (igual que el submit, más abajo): `values.placa` puede
    // traer puntuación fuera de `[A-Za-z0-9 -]` (ej. un vehículo legado sembrado por script,
    // sin pasar por `PlacaVehiculoSchema` — el `onChange` del input sí filtra en vivo, pero el
    // valor inicial en modo edición viene directo de `vehicle.placa`). Sin normalizar acá,
    // `PlacaVehiculoSchema.safeParse` rechazaba esa placa en silencio (`setPlateVerification(null)`
    // + return mudo) y el operador nunca veía la advertencia de placa duplicada.
    const parsed = PlacaVehiculoSchema.safeParse(placaNormalizada);
    if (!parsed.success) {
      setPlateVerification(null);
      return;
    }
    if (placaNormalizada === vehicle?.placaNormalizada) return;
    setIsVerifyingPlate(true);
    try {
      // Misma razón que el safeParse de arriba: se manda la NORMALIZADA, no `values.placa`
      // crudo — si no, el backend (`verificarPlaca`, que también corre `PlacaVehiculoSchema`)
      // rechazaría con 400 la misma placa legada que acá ya decidimos aceptar.
      setPlateVerification(await onVerifyPlate(placaNormalizada));
    } catch {
      setPlateVerification(null);
    } finally {
      setIsVerifyingPlate(false);
    }
  };

  const validarTodoElFormulario = (): Record<string, string> => {
    const nuevosErrores: Record<string, string> = {};
    (Object.keys(values) as Array<keyof FormValues>).forEach((key) => {
      const error = validarCampo(key, values[key]);
      if (error) {
        nuevosErrores[key] = error;
      }
    });
    return nuevosErrores;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    // Validar en profundidad todos los campos
    const validaciones = validarTodoElFormulario();
    const errorKeys = Object.keys(validaciones);
    if (errorKeys.length > 0) {
      setErrors(validaciones);
      const primerError = errorKeys[0] ?? '';

      // Auto-switch a la sección que contiene el error
      if (['placa', 'sindicatoId', 'socioId', 'numeroInterno'].includes(primerError)) {
        setActiveSection('01');
      } else if (['tipo'].includes(primerError)) {
        setActiveSection('02');
      } else if (['marca', 'modelo', 'color', 'colorSecundario', 'capacidad'].includes(primerError)) {
        setActiveSection('03');
      }

      setTimeout(() => {
        document.getElementById(`vehiculo-${primerError}`)?.focus();
      }, 70);
      return;
    }

    if (plateVerification && !plateVerification.disponible) {
      setErrors((previous) => ({
        ...previous,
        placa: 'Ya existe un vehículo registrado con esta placa en la red.',
      }));
      setActiveSection('01');
      setTimeout(() => {
        document.getElementById('vehiculo-placa')?.focus();
      }, 50);
      return;
    }

    setIsSaving(true);
    try {
      if (vehicle) {
        // Modo edición: construir el payload directamente con los campos editables.
        // No usamos CrearVehiculoSchema (que exige estado:'pendiente') sino ActualizarVehiculo.
        const update: ActualizarVehiculo = {
          placa: normalizarPlacaVehiculo(values.placa),
          socioId: values.socioId || null,
          tipo: values.tipo as TipoVehiculo,
          marca: values.marca.trim(),
          modelo: values.modelo.trim(),
          color: values.color as ColorVehiculo,
          colorSecundario: (values.colorSecundario as ColorVehiculo) || null,
          numeroInterno: values.numeroInterno.trim() || null,
          capacidad,
        };
        await onSave(update);
      } else {
        // Modo creación: validar con el schema completo
        const payload = {
          placa: values.placa,
          tipo: values.tipo,
          sindicatoId: values.sindicatoId,
          socioId: values.socioId || null,
          marca: values.marca,
          modelo: values.modelo,
          color: values.color,
          colorSecundario: values.colorSecundario || null,
          numeroInterno: values.numeroInterno || null,
          capacidad,
          estado: 'pendiente' as const,
        };
        const parsed = CrearVehiculoSchema.safeParse(payload);
        if (!parsed.success) {
          const nextErrors: Record<string, string> = {};
          for (const issue of parsed.error.issues) {
            const key = String(issue.path[0] ?? 'form');
            nextErrors[key] ??= issue.message;
          }
          setErrors(nextErrors);
          return;
        }
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

  // Errores por sección para feedback visual en las pestañas
  const erroresSec01 = Boolean(errors.placa || errors.numeroInterno || errors.sindicatoId || errors.socioId);
  const erroresSec02 = Boolean(errors.tipo);
  const erroresSec03 = Boolean(errors.marca || errors.modelo || errors.color || errors.colorSecundario || errors.capacidad);

  return (
    <div className="vehicle-form-layout">
      {/* Columna Izquierda: Tarjeta Principal del Formulario */}
      <div className="vehicle-form-main-card">
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
              <h2>{vehicle ? `Editar vehículo: ${vehicle.placaNormalizada}` : 'Registrar vehículo'}</h2>
              <p>
                {vehicle
                  ? 'Actualiza los datos técnicos, afiliación y especificaciones de la unidad.'
                  : 'Completa la información técnica, afiliación y especificaciones para incorporar la unidad.'}
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

        {/* Barra de Navegación Exclusiva de Secciones con Indicadores de Validación */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.45rem',
            padding: '0.75rem 1.5rem',
            backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 65%, transparent)',
            borderBottom: '1px solid var(--qv-border-glass)',
            overflowX: 'auto',
            flexWrap: 'nowrap',
          }}
        >
          <button
            type="button"
            onClick={() => setActiveSection('01')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.45rem 0.9rem',
              borderRadius: 'var(--qv-radius-full)',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: 'pointer',
              border: activeSection === '01' ? '1px solid var(--qv-color-primary)' : '1px solid var(--qv-border-glass)',
              backgroundColor: activeSection === '01' ? 'var(--qv-color-primary)' : 'var(--qv-surface-card)',
              color: activeSection === '01' ? '#ffffff' : 'var(--qv-text-primary)',
              transition: 'all var(--qv-transition-fast)',
              whiteSpace: 'nowrap',
              boxShadow: activeSection === '01' ? '0 2px 8px color-mix(in srgb, var(--qv-color-primary) 30%, transparent)' : 'none',
              position: 'relative',
            }}
          >
            <span style={{ fontWeight: 800 }}>01</span>
            <span>Identificación y Padrón</span>
            {erroresSec01 && (
              <AlertCircle size={13} style={{ color: activeSection === '01' ? '#ffffff' : 'var(--qv-color-danger)' }} />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('02')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.45rem 0.9rem',
              borderRadius: 'var(--qv-radius-full)',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: 'pointer',
              border: activeSection === '02' ? '1px solid var(--qv-color-primary)' : '1px solid var(--qv-border-glass)',
              backgroundColor: activeSection === '02' ? 'var(--qv-color-primary)' : 'var(--qv-surface-card)',
              color: activeSection === '02' ? '#ffffff' : 'var(--qv-text-primary)',
              transition: 'all var(--qv-transition-fast)',
              whiteSpace: 'nowrap',
              boxShadow: activeSection === '02' ? '0 2px 8px color-mix(in srgb, var(--qv-color-primary) 30%, transparent)' : 'none',
            }}
          >
            <span style={{ fontWeight: 800 }}>02</span>
            <span>Tipo de Carrocería</span>
            {erroresSec02 && (
              <AlertCircle size={13} style={{ color: activeSection === '02' ? '#ffffff' : 'var(--qv-color-danger)' }} />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('03')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.45rem 0.9rem',
              borderRadius: 'var(--qv-radius-full)',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: 'pointer',
              border: activeSection === '03' ? '1px solid var(--qv-color-primary)' : '1px solid var(--qv-border-glass)',
              backgroundColor: activeSection === '03' ? 'var(--qv-color-primary)' : 'var(--qv-surface-card)',
              color: activeSection === '03' ? '#ffffff' : 'var(--qv-text-primary)',
              transition: 'all var(--qv-transition-fast)',
              whiteSpace: 'nowrap',
              boxShadow: activeSection === '03' ? '0 2px 8px color-mix(in srgb, var(--qv-color-primary) 30%, transparent)' : 'none',
            }}
          >
            <span style={{ fontWeight: 800 }}>03</span>
            <span>Ficha Mecánica y Colores</span>
            {erroresSec03 && (
              <AlertCircle size={13} style={{ color: activeSection === '03' ? '#ffffff' : 'var(--qv-color-danger)' }} />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('all')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.45rem 0.85rem',
              borderRadius: 'var(--qv-radius-full)',
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor: 'pointer',
              border: activeSection === 'all' ? '1px solid var(--qv-color-primary)' : '1px solid var(--qv-border-glass)',
              backgroundColor: activeSection === 'all' ? 'color-mix(in srgb, var(--qv-color-primary) 15%, var(--qv-surface-card))' : 'transparent',
              color: activeSection === 'all' ? 'var(--qv-color-primary)' : 'var(--qv-text-secondary)',
              transition: 'all var(--qv-transition-fast)',
              whiteSpace: 'nowrap',
              marginLeft: 'auto',
            }}
          >
            <Layers size={13} />
            <span>Ver todo</span>
          </button>
        </div>

        {/* Contenedor del Formulario a Ancho Completo */}
        <form id="vehicle-form" className="vehicle-panel-body" onSubmit={handleSubmit} noValidate style={{ width: '100%', boxSizing: 'border-box' }}>
          {/* SECCIÓN 01: IDENTIFICACIÓN Y PADRÓN SINDICAL */}
          {(activeSection === 'all' || activeSection === '01') && (
            <section
              id="seccion-01"
              className="vehicle-form-section"
              style={{
                backgroundColor: 'var(--qv-surface-card)',
                padding: '1.5rem 1.75rem',
                borderRadius: 'var(--qv-radius-lg)',
                border: '1px solid var(--qv-border-glass)',
                width: '100%',
                boxSizing: 'border-box',
              }}
            >
              <div className="vehicle-form-section__heading">
                <span>01</span>
                <div>
                  <h3>Identificación y Padrón Sindical</h3>
                  <p>La placa se normaliza en formato RUAT boliviano (3 o 4 números seguidos de 3 letras).</p>
                </div>
              </div>

              <div className="vehicle-plate-row">
                <FormField
                  label="Placa vehicular RUAT *"
                  htmlFor="vehiculo-placa"
                  required
                  error={errors.placa}
                  helperText={
                    isVerifyingPlate
                      ? 'Verificando disponibilidad en red QUIVO...'
                      : plateVerification?.disponible
                        ? 'Placa válida y disponible para registrar'
                        : placaNormalizada === vehicle?.placaNormalizada
                          ? 'Placa actual de esta unidad'
                          : 'Ejemplo: 1234ABC (4 números y 3 letras) o 123ABC (3 números y 3 letras)'
                  }
                >
                  <div className="vehicle-plate-input-container">
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
                    <PlateBadge
                      plate={placaNormalizada || '123ABC'}
                      className="vehicle-form-live-plate"
                    />
                  </div>
                </FormField>

                {plateVerification && !plateVerification.disponible && (
                  <Alert
                    variant="danger"
                    title="Placa duplicada"
                    style={{ marginTop: '0.25rem' }}
                  >
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

              <div className="vehicle-form-grid" style={{ marginTop: '1.25rem' }}>
                <FormField
                  label="Número interno / Móvil"
                  htmlFor="vehiculo-numeroInterno"
                  error={errors.numeroInterno}
                  helperText="Código de flota asignado en el sindicato, ej. 120-01 o Int. 24."
                >
                  <Input
                    id="vehiculo-numeroInterno"
                    value={values.numeroInterno}
                    onChange={(event) => setField('numeroInterno', event.target.value)}
                    onBlur={() => handleBlur('numeroInterno')}
                    placeholder="Ej. 120-01"
                    maxLength={30}
                    leftSlot={<Tag size={16} className="input-icon" />}
                    fullWidth
                  />
                </FormField>

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
                  label="Socio propietario *"
                  htmlFor="vehiculo-socioId"
                  required
                  error={errors.socioId}
                  helperText={!values.socioId ? 'Obligatorio: sin propietario la unidad no podrá operar.' : undefined}
                >
                  <Select
                    id="vehiculo-socioId"
                    options={sociosDisponibles.map((socio) => ({
                      label: `${socio.nombre} · ${socio.documentoIdentidad}`,
                      value: socio.id,
                    }))}
                    placeholder={
                      values.sindicatoId
                        ? 'Selecciona un socio'
                        : 'Selecciona primero el sindicato'
                    }
                    value={values.socioId}
                    onChange={(event) => setField('socioId', event.target.value)}
                    disabled={!values.sindicatoId}
                    fullWidth
                  />
                </FormField>
              </div>

              {activeSection === '01' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--qv-border-glass)' }}>
                  <Button type="button" onClick={() => setActiveSection('02')} size="sm">
                    <span>Siguiente: Tipo de Carrocería</span>
                    <ArrowRight size={14} style={{ marginLeft: '6px' }} />
                  </Button>
                </div>
              )}
            </section>
          )}

          {/* SECCIÓN 02: TIPO DE CARROCERÍA */}
          {(activeSection === 'all' || activeSection === '02') && (
            <section
              id="seccion-02"
              className="vehicle-form-section"
              style={{
                backgroundColor: 'var(--qv-surface-card)',
                padding: '1.5rem 1.75rem',
                borderRadius: 'var(--qv-radius-lg)',
                border: '1px solid var(--qv-border-glass)',
                width: '100%',
                boxSizing: 'border-box',
              }}
            >
              <div className="vehicle-form-section__heading">
                <span>02</span>
                <div>
                  <h3>Tipo de Carrocería</h3>
                  <p>Selecciona la tipología para asociar capacidades y aforos sugeridos.</p>
                </div>
              </div>

              <div className="vehicle-type-section">
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
                {errors.tipo && (
                  <span style={{ color: 'var(--qv-color-danger)', fontSize: '0.78rem', marginTop: '0.35rem' }}>
                    {errors.tipo}
                  </span>
                )}
                <small className="vehicle-type-section__hint">
                  {tipoSeleccionado?.descripcion ?? 'Selecciona el tipo de carrocería principal.'}
                </small>
              </div>

              {activeSection === '02' && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--qv-border-glass)' }}>
                  <Button variant="ghost" type="button" onClick={() => setActiveSection('01')} size="sm">
                    <ArrowLeft size={14} style={{ marginRight: '6px' }} />
                    <span>Identificación (01)</span>
                  </Button>
                  <Button type="button" onClick={() => setActiveSection('03')} size="sm">
                    <span>Siguiente: Ficha Mecánica</span>
                    <ArrowRight size={14} style={{ marginLeft: '6px' }} />
                  </Button>
                </div>
              )}
            </section>
          )}

          {/* SECCIÓN 03: ESPECIFICACIONES MECÁNICAS Y COLORES */}
          {(activeSection === 'all' || activeSection === '03') && (
            <section
              id="seccion-03"
              className="vehicle-form-section"
              style={{
                backgroundColor: 'var(--qv-surface-card)',
                padding: '1.5rem 1.75rem',
                borderRadius: 'var(--qv-radius-lg)',
                border: '1px solid var(--qv-border-glass)',
                width: '100%',
                boxSizing: 'border-box',
              }}
            >
              <div className="vehicle-form-section__heading">
                <span>03</span>
                <div>
                  <h3>Ficha Mecánica y Colores Oficiales</h3>
                  <p>Configura la marca, modelo, capacidad de pasajeros y el esquema cromático.</p>
                </div>
              </div>

              <div className="vehicle-form-grid">
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
                  label="Capacidad de pasajeros *"
                  htmlFor="vehiculo-capacidad"
                  required
                  error={errors.capacidad}
                  helperText="Capacidad total autorizada (1 a 200 pasajeros)."
                >
                  <Input
                    id="vehiculo-capacidad"
                    type="number"
                    min={1}
                    max={200}
                    step={1}
                    value={values.capacidad}
                    onChange={(event) => setField('capacidad', event.target.value)}
                    onBlur={() => handleBlur('capacidad')}
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
                      onBlur={() => handleBlur('marca')}
                      placeholder="Especifica la marca (ej. Foton, Jinbei)"
                      maxLength={50}
                      fullWidth
                    />
                  </FormField>
                )}

                <FormField
                  label="Modelo *"
                  htmlFor="vehiculo-modelo"
                  required
                  error={errors.modelo}
                  helperText="Denominación comercial del chasis o carrocería."
                >
                  <Input
                    id="vehiculo-modelo"
                    value={values.modelo}
                    onChange={(event) => setField('modelo', event.target.value)}
                    onBlur={() => handleBlur('modelo')}
                    placeholder="Ej. HiAce / LO-915"
                    maxLength={50}
                    leftSlot={<Package size={16} className="input-icon" />}
                    fullWidth
                  />
                </FormField>
                {/* Colores: principal y secundario en la misma fila */}
                <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
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
                        options={COLORES_VEHICULO.map((c) => ({
                          label: c.nombre,
                          value: c.codigo,
                        }))}
                        value={values.color}
                        onChange={(event) => setField('color', event.target.value as ColorVehiculo)}
                        fullWidth
                      />
                    </div>
                  </FormField>

                  <FormField
                    label="Color secundario"
                    htmlFor="vehiculo-colorSecundario"
                    error={errors.colorSecundario}
                    helperText="Opcional. Franja o techo secundario."
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
                </div>

                <div className="vehicle-state-summary" style={{ gridColumn: '1 / -1' }}>
                  <span
                    className={`vehicle-state-summary__dot vehicle-state-summary__dot--${vehicle ? values.estado : 'pendiente'}`}
                    aria-hidden="true"
                  />
                  <div>
                    <small>Estado operativo de la unidad</small>
                    <strong>{NOMBRE_ESTADO[vehicle ? values.estado : 'pendiente']}</strong>
                    <span>
                      {vehicle
                        ? 'El estado se actualiza mediante la acción de cambio de estado en la tabla de vehículos.'
                        : 'Toda unidad nueva se registra pendiente hasta completar su validación administrativa.'}
                    </span>
                  </div>
                </div>
              </div>

              {capacidadAtipica && (
                <div className="vehicle-capacity-warning" role="status" style={{ marginTop: '1rem' }}>
                  <AlertTriangle size={18} aria-hidden="true" />
                  <span>
                    La capacidad ingresada ({capacidad} pasajeros) está fuera del rango típico para {tipoSeleccionado?.nombre} (
                    {tipoSeleccionado?.capacidadMinReferencial} - {tipoSeleccionado?.capacidadMaxReferencial} pas.).
                  </span>
                </div>
              )}

              {activeSection === '03' && (
                <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--qv-border-glass)' }}>
                  <Button variant="ghost" type="button" onClick={() => setActiveSection('02')} size="sm">
                    <ArrowLeft size={14} style={{ marginRight: '6px' }} />
                    <span>Carrocería (02)</span>
                  </Button>
                </div>
              )}
            </section>
          )}
        </form>
      </div>

      {/* Columna Derecha: Ficha en Vivo Fija e Independiente */}
      <aside className="vehicle-preview-sidebar">
        {/* ── Header: Vista previa + badge En vivo ── */}
        <div className="vehicle-preview-sidebar__header">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <h3 style={{ margin: 0 }}>Vista previa</h3>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3rem',
                padding: '0.2rem 0.6rem',
                borderRadius: 'var(--qv-radius-full)',
                fontSize: '0.68rem',
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                background: 'color-mix(in srgb, var(--qv-color-success, #22c55e) 15%, transparent)',
                color: 'var(--qv-color-success, #16a34a)',
                border: '1px solid color-mix(in srgb, var(--qv-color-success, #22c55e) 35%, transparent)',
              }}
              aria-label="En vivo"
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: 'var(--qv-color-success, #22c55e)',
                  animation: 'qv-live-pulse 1.6s ease-in-out infinite',
                  flexShrink: 0,
                }}
              />
              En vivo
            </span>
          </div>
          <div
            className="vehicle-preview-sidebar__progress"
            aria-label={`${completionPercentage}% completo`}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', marginBottom: '0.25rem' }}>
              <span>Datos esenciales</span>
              <strong>{completionPercentage}%</strong>
            </div>
            <span className="vehicle-preview-sidebar__progress-track">
              <span style={{ width: `${completionPercentage}%` }} />
            </span>
          </div>
        </div>

        {/* Selector de Modo de Vista Previa: [ Carrocería ] [ En Mapa ] */}
        <div
          style={{
            display: 'flex',
            gap: '0.35rem',
            padding: '0.25rem',
            borderRadius: 'var(--qv-radius-md)',
            backgroundColor: 'color-mix(in srgb, var(--qv-surface-soft) 80%, transparent)',
            border: '1px solid var(--qv-border-glass)',
            marginTop: '0.75rem',
          }}
        >
          <button
            type="button"
            onClick={() => setPreviewTab('carroceria')}
            style={{
              flex: 1,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.4rem',
              padding: '0.35rem 0.5rem',
              borderRadius: 'var(--qv-radius-sm)',
              fontSize: '0.72rem',
              fontWeight: previewTab === 'carroceria' ? 800 : 600,
              cursor: 'pointer',
              border: previewTab === 'carroceria' ? '1px solid var(--qv-color-primary)' : '1px solid transparent',
              backgroundColor: previewTab === 'carroceria' ? 'var(--qv-surface-card)' : 'transparent',
              color: previewTab === 'carroceria' ? 'var(--qv-color-primary)' : 'var(--qv-text-secondary)',
              transition: 'all var(--qv-transition-fast)',
              boxShadow: previewTab === 'carroceria' ? '0 2px 6px rgba(0,0,0,0.15)' : 'none',
            }}
          >
            <Bus size={13} />
            <span>Carrocería</span>
          </button>

          <button
            type="button"
            onClick={() => setPreviewTab('mapa')}
            style={{
              flex: 1,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.4rem',
              padding: '0.35rem 0.5rem',
              borderRadius: 'var(--qv-radius-sm)',
              fontSize: '0.72rem',
              fontWeight: previewTab === 'mapa' ? 800 : 600,
              cursor: 'pointer',
              border: previewTab === 'mapa' ? '1px solid var(--qv-color-primary)' : '1px solid transparent',
              backgroundColor: previewTab === 'mapa' ? 'var(--qv-surface-card)' : 'transparent',
              color: previewTab === 'mapa' ? 'var(--qv-color-primary)' : 'var(--qv-text-secondary)',
              transition: 'all var(--qv-transition-fast)',
              boxShadow: previewTab === 'mapa' ? '0 2px 6px rgba(0,0,0,0.15)' : 'none',
            }}
          >
            <MapIcon size={13} />
            <span>En Mapa</span>
          </button>
        </div>

        {/* ── MODO 1: Carrocería e Identificación del vehículo ── */}
        {previewTab === 'carroceria' && (
          <div
            style={{
              marginTop: '0.85rem',
              borderRadius: 'var(--qv-radius-lg)',
              border: '1px solid var(--qv-border-glass)',
              background: 'color-mix(in srgb, var(--qv-surface-card) 55%, transparent)',
              overflow: 'hidden',
            }}
          >
            {/* Imagen panorámica — se escala grande para recortar el espacio blanco interno del PNG */}
            <div
              style={{
                background: 'var(--qv-surface-card)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '85px',
                width: '100%',
                overflow: 'hidden',
                borderBottom: '1px solid var(--qv-border-glass)',
              }}
            >
              <div style={{ transform: 'scale(2.2)', transformOrigin: 'center center', flexShrink: 0 }}>
                <VehicleDetailedIllustration tipo={values.tipo || 'minibus'} color={values.color} />
              </div>
            </div>

            {/* Fila inferior: placa y número interno en columnas */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                padding: '0.6rem 0.75rem',
                gap: '0.5rem',
                alignItems: 'center',
              }}
            >
              {/* Columna izquierda: Placa */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                <span style={{ fontSize: '0.6rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--qv-text-secondary)' }}>
                  Placa
                </span>
                <div style={{ transform: 'scale(0.82)', transformOrigin: 'left center' }}>
                  <PlateBadge
                    plate={placaNormalizada || 'SIN PLACA'}
                    className="vehicle-preview-sidebar__plate-badge"
                  />
                </div>
              </div>

              {/* Columna derecha: Tipo + Interno */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', alignItems: 'flex-end' }}>
                <div className="vehicle-preview-sidebar__tag" style={{ margin: 0 }}>
                  <Tag size={11} />
                  <span style={{ fontSize: '0.67rem' }}>{tipoSeleccionado?.nombre ?? 'Minibús'}</span>
                </div>
                {values.numeroInterno && (
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      padding: '0.15rem 0.45rem',
                      borderRadius: 'var(--qv-radius-full)',
                      background: 'color-mix(in srgb, #f59e0b 18%, transparent)',
                      border: '1px solid color-mix(in srgb, #f59e0b 35%, transparent)',
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      color: '#d97706',
                    }}
                  >
                    #{values.numeroInterno}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── MODO 2: Simulación del Vehículo en Mapa en Vivo ── */}
        {previewTab === 'mapa' && (
          <div
            style={{
              marginTop: '0.85rem',
              position: 'relative',
              borderRadius: 'var(--qv-radius-lg)',
              border: `1px solid color-mix(in srgb, ${values.color ? COLORES_VEHICULO.find((c) => c.codigo === values.color)?.muestra ?? '#2563eb' : '#2563eb'} 40%, var(--qv-border-glass))`,
              backgroundColor: '#0c121e',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: `0 4px 18px rgba(0,0,0,0.4)`,
            }}
          >
            {/* Cabecera del Mapa en Vivo */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.45rem 0.75rem',
                backgroundColor: 'rgba(15, 23, 42, 0.85)',
                backdropFilter: 'blur(12px)',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                zIndex: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Compass size={13} style={{ color: '#38bdf8' }} />
                <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#ffffff', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  Posición Satelital
                </span>
              </div>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  fontSize: '0.65rem',
                  color: '#34d399',
                  fontWeight: 700,
                }}
              >
                <Radio size={11} className="animate-pulse" />
                <span>42 km/h</span>
              </div>
            </div>

            {/* Lienzo Cartográfico Simulado */}
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: '175px',
                backgroundColor: '#090e17',
                backgroundImage: `
                  radial-gradient(circle at 50% 50%, color-mix(in srgb, #2563eb 12%, transparent) 0%, transparent 70%),
                  linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
                  linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px)
                `,
                backgroundSize: '100% 100%, 20px 20px, 20px 20px',
                overflow: 'hidden',
              }}
            >
              {/* Calles y Traza de Ruta */}
              {/* Calles y Vías Urbanas Simuladas con Coordenadas Normalizadas */}
              <svg
                viewBox="0 0 400 210"
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'none',
                }}
              >
                <line x1="0" y1="45" x2="400" y2="45" stroke="#1e293b" strokeWidth="2" />
                <line x1="0" y1="150" x2="400" y2="150" stroke="#1e293b" strokeWidth="2" />
                <line x1="75" y1="0" x2="75" y2="210" stroke="#1e293b" strokeWidth="2" />
                <line x1="315" y1="0" x2="315" y2="210" stroke="#1e293b" strokeWidth="2" />

                <path
                  d="M 25 175 C 110 165 145 130 200 105 C 255 80 300 55 375 42"
                  fill="none"
                  stroke={values.color ? COLORES_VEHICULO.find((c) => c.codigo === values.color)?.muestra ?? '#2563eb' : '#2563eb'}
                  strokeWidth="4.5"
                  strokeLinecap="round"
                  strokeDasharray="6 3"
                  style={{
                    filter: `drop-shadow(0 0 7px ${values.color ? COLORES_VEHICULO.find((c) => c.codigo === values.color)?.muestra ?? '#2563eb' : '#2563eb'})`,
                  }}
                />

                <circle cx="45" cy="170" r="4.5" fill="#0f172a" stroke="#ffffff" strokeWidth="2" />
                <circle cx="360" cy="45" r="4.5" fill="#0f172a" stroke="#ffffff" strokeWidth="2" />
              </svg>

              {/* Cursor Direccional: Cápsula Suave Centrada Exactamente sobre la Línea */}
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%) rotate(-24deg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 20,
                  filter: `drop-shadow(0 4px 12px rgba(0,0,0,0.7)) drop-shadow(0 0 10px ${values.color ? COLORES_VEHICULO.find((c) => c.codigo === values.color)?.muestra ?? '#2563eb' : '#2563eb'})`,
                }}
                title={`Vehículo ${placaNormalizada || '123ABC'}`}
              >
                {/* Onda de Radar Pulsante */}
                <div
                  style={{
                    position: 'absolute',
                    inset: '-8px -12px',
                    borderRadius: '999px',
                    border: `1.5px solid ${values.color ? COLORES_VEHICULO.find((c) => c.codigo === values.color)?.muestra ?? '#2563eb' : '#2563eb'}`,
                    backgroundColor: `color-mix(in srgb, ${values.color ? COLORES_VEHICULO.find((c) => c.codigo === values.color)?.muestra ?? '#2563eb' : '#2563eb'} 22%, transparent)`,
                    animation: 'qv-live-pulse 1.8s ease-in-out infinite',
                    pointerEvents: 'none',
                  }}
                />

                {/* Cápsula SVG con Contornos Suaves, Esquinas Redondeadas */}
                <svg
                  width={Math.max(56, Math.max(20, (values.numeroInterno ? `#${values.numeroInterno}` : placaNormalizada || '123').length * 8.5) + 36)}
                  height="28"
                  viewBox={`0 0 ${Math.max(56, Math.max(20, (values.numeroInterno ? `#${values.numeroInterno}` : placaNormalizada || '123').length * 8.5) + 36)} 28`}
                  fill="none"
                  style={{ overflow: 'visible', flexShrink: 0 }}
                >
                  {(() => {
                    const label = values.numeroInterno ? `#${values.numeroInterno}` : (placaNormalizada || '123');
                    const labelLen = label.length;
                    const textSpan = Math.max(20, labelLen * 8.5);
                    const totalLength = Math.max(56, textSpan + 32);
                    const radius = 12;
                    const leftArcCenter = radius + 2;
                    const bodyRight = totalLength - 15;
                    const tipX = totalLength - 2;
                    const shoulderX = bodyRight + 6;
                    const centerX = (2 + tipX) / 2;
                    const vColor = values.color ? COLORES_VEHICULO.find((c) => c.codigo === values.color)?.muestra ?? '#2563eb' : '#2563eb';

                    const pathSmooth = `
                      M ${leftArcCenter} 2
                      L ${bodyRight} 2
                      Q ${bodyRight + 4} 2 ${shoulderX} 6
                      L ${tipX - 3} 12
                      Q ${tipX} 14 ${tipX - 3} 16
                      L ${shoulderX} 22
                      Q ${bodyRight + 4} 26 ${bodyRight} 26
                      L ${leftArcCenter} 26
                      A ${radius} ${radius} 0 0 1 ${leftArcCenter} 2
                      Z
                    `.replace(/\s+/g, ' ').trim();

                    return (
                      <>
                        <path
                          d={pathSmooth}
                          fill={vColor}
                          stroke="#ffffff"
                          strokeWidth="2"
                          strokeLinejoin="round"
                          strokeLinecap="round"
                        />
                        <text
                          x={centerX}
                          y="18.5"
                          fill="#ffffff"
                          fontSize="12"
                          fontWeight="900"
                          fontFamily="var(--qv-font-body, system-ui, sans-serif)"
                          textAnchor="middle"
                          letterSpacing="0.5px"
                        >
                          {label}
                        </text>
                      </>
                    );
                  })()}
                </svg>
              </div>

              {/* Telemetría Flotante Inferior */}
              <div
                style={{
                  position: 'absolute',
                  bottom: '0.45rem',
                  left: '0.5rem',
                  right: '0.5rem',
                  padding: '0.4rem 0.6rem',
                  borderRadius: 'var(--qv-radius-md)',
                  backgroundColor: 'rgba(15, 23, 42, 0.92)',
                  backdropFilter: 'blur(16px)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.5rem',
                  zIndex: 15,
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <strong style={{ fontSize: '0.7rem', color: '#ffffff' }}>
                    {tipoSeleccionado?.nombre} · {values.marca || 'Toyota'} {values.modelo || ''}
                  </strong>
                  <span style={{ fontSize: '0.62rem', color: 'var(--qv-text-secondary)' }}>
                    {colorPrincipalNombre} {colorSecundarioNombre ? `+ ${colorSecundarioNombre}` : ''}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    color: '#34d399',
                    backgroundColor: 'rgba(52, 211, 153, 0.12)',
                    padding: '0.15rem 0.4rem',
                    borderRadius: 'var(--qv-radius-sm)',
                    border: '1px solid rgba(52, 211, 153, 0.25)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  GPS Activo
                </span>
              </div>
            </div>

            <div
              style={{
                padding: '0.4rem 0.75rem',
                backgroundColor: 'rgba(15, 23, 42, 0.6)',
                borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '0.68rem',
                color: 'var(--qv-text-secondary)',
              }}
            >
              <span>Visualización en mapa operativo en vivo</span>
              <Sparkles size={12} style={{ color: '#38bdf8' }} />
            </div>
          </div>
        )}

        {/* ── Detalles Clave: lista vertical ── */}
        <div className="vehicle-preview-sidebar__specs" style={{ marginTop: '0.85rem' }}>
          <div className="spec-item">
            <div className="spec-item__icon">
              <Gauge size={14} />
            </div>
            <div className="spec-item__text">
              <span className="spec-item__label">Capacidad</span>
              <span className="spec-item__value">{values.capacidad || 20} pasajeros</span>
            </div>
          </div>

          <div className="spec-item">
            <div className="spec-item__icon">
              <Palette size={14} />
            </div>
            <div className="spec-item__text">
              <span className="spec-item__label">Colores</span>
              <span className="spec-item__value">
                {colorPrincipalNombre}{colorSecundarioNombre ? ` + ${colorSecundarioNombre}` : ''}
              </span>
            </div>
          </div>

          <div className="spec-item">
            <div className="spec-item__icon">
              <ShieldCheck size={14} />
            </div>
            <div className="spec-item__text">
              <span className="spec-item__label">Uso</span>
              <span className="spec-item__value">{especificaciones.usoRecomendado}</span>
            </div>
          </div>

          <div className="spec-item">
            <div className="spec-item__icon">
              <Bus size={14} />
            </div>
            <div className="spec-item__text">
              <span className="spec-item__label">Servicio</span>
              <span className="spec-item__value">{especificaciones.tipoServicio}</span>
            </div>
          </div>
        </div>

        {/* Descripción del tipo */}
        <p
          style={{
            fontSize: '0.73rem',
            color: 'var(--qv-text-secondary)',
            margin: '0.5rem 0 0',
            lineHeight: 1.5,
          }}
        >
          {tipoSeleccionado?.descripcion ?? 'Vehículo mediano para transporte de pasajeros en rutas interurbanas.'}
        </p>

        {/* Spacer flexible para empujar los botones al fondo */}
        <div style={{ flex: 1 }} />

        {/* ── Acciones ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid var(--qv-border-glass)' }}>
          <Button
            type="submit"
            form="vehicle-form"
            disabled={isSaving}
            fullWidth
            size="md"
            style={{
              boxShadow: '0 4px 14px color-mix(in srgb, var(--qv-color-primary) 35%, transparent)',
              fontWeight: 700,
            }}
          >
            <Save size={15} style={{ marginRight: '6px' }} />
            {isSaving ? 'Guardando...' : vehicle ? 'Guardar cambios' : 'Guardar vehículo'}
          </Button>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isSaving}
            fullWidth
            size="sm"
          >
            Cancelar
          </Button>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              color: 'var(--qv-text-muted)',
              fontSize: '0.68rem',
              justifyContent: 'center',
              textAlign: 'center',
            }}
          >
            <Clock3 size={12} style={{ color: 'var(--qv-color-primary)', flexShrink: 0 }} />
            <span>
              {vehicle ? 'Cambios registrados en auditoría' : 'Activación sujeta a validación'}
            </span>
          </div>
        </div>
      </aside>
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
        <ellipse cx="130" cy="128" rx="100" ry="8" fill="#e2e8f0" />
        <g id="vehicle-body">
          <path
            d="M20 98 V45 C20 38 26 32 34 32 H195 C208 32 220 40 226 52 L242 85 V98 H20 Z"
            fill="url(#bodyGradient)"
            stroke="#1e293b"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <path d="M20 80 Q90 85 240 76 V88 Q110 94 20 88 Z" fill={mainColor} opacity="0.85" />
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
          <path
            d="M222 56 L232 58 V66 L222 62 Z"
            fill="#475569"
            stroke="#1e293b"
            strokeWidth="1.5"
          />
        </g>
        <g id="wheels">
          <circle cx="62" cy="98" r="18" fill="#1e293b" stroke="#0f172a" strokeWidth="2" />
          <circle cx="62" cy="98" r="10" fill="#94a3b8" />
          <circle cx="62" cy="98" r="5" fill="#f8fafc" />
          <circle cx="196" cy="98" r="18" fill="#1e293b" stroke="#0f172a" strokeWidth="2" />
          <circle cx="196" cy="98" r="10" fill="#94a3b8" />
          <circle cx="196" cy="98" r="5" fill="#f8fafc" />
        </g>
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
