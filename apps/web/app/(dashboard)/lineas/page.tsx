'use client';

import { useMemo, useState } from 'react';
import type { EstadoPublicacion, Linea } from '@quivo/shared';
import { Button } from '@quivo/design-system';
import { Info, Palette, Signpost } from 'lucide-react';
import {
  ModuleTablePage,
  type EntityFieldConfig,
  type ModuleDataSource,
  type FormTabConfig,
} from '../../../src/components/module-table-page';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { lineasApi, subirLogoLinea } from '../../../src/lib/api/lineas';
import { useSindicatoOptions } from '../../../src/lib/api/use-sindicato-options';

export default function LineasPage() {
  const { token, user } = useAuth();
  const { options: sindicatoOptions, nombrePorId } = useSindicatoOptions();

  const fields = useMemo<EntityFieldConfig[]>(() => {
    const base: EntityFieldConfig[] = [
      { key: 'codigo', label: 'Código', kind: 'text', required: true },
      { key: 'nombre', label: 'Nombre', kind: 'text', required: true },
      {
        key: 'nombreCorto',
        label: 'Nombre corto',
        kind: 'text',
        maxLength: 40,
        placeholder: 'Ej. 120',
        helperText: 'Identificador visible en la credencial y la app del chofer.',
        section: 'Identidad base',
        sectionDescription: 'Lo que el pasajero reconoce primero al ver la unidad.',
      },
      {
        key: 'lema',
        label: 'Lema de la línea',
        kind: 'text',
        maxLength: 160,
        placeholder: 'Ej. Conectando la ciudad',
        section: 'Identidad base',
      },
      {
        key: 'descripcion',
        label: 'Descripción operativa',
        kind: 'text',
        maxLength: 1000,
        section: 'Identidad base',
      },
      {
        key: 'logoUrl',
        label: 'Símbolo o logo de la línea',
        kind: 'image',
        accept: 'image/png,image/jpeg,image/webp',
        upload: (file) => subirLogoLinea(token ?? '', file),
        helperText: 'Sube el emblema representativo; se usará en tarjetas, cartel y mapa.',
        section: 'Símbolo visual',
        sectionDescription:
          'Un emblema ayuda a reconocer la línea aun cuando el letrero está lejos.',
      },
      {
        key: 'color',
        label: 'Color principal',
        kind: 'color',
        helperText: 'Color dominante en mapa, cartel y elementos de la unidad.',
        section: 'Paleta de la línea',
        sectionDescription: 'Parte de un estilo sugerido o ajusta cada color manualmente.',
        colorPresets: [
          {
            label: 'Universitaria',
            values: {
              color: '#0f766e',
              colorSecundario: '#f59e0b',
              colorTexto: '#ffffff',
              colorTerciario: '#0ea5a4',
              colorFondo: '#f0fdfa',
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
            },
          },
        ],
      },
      {
        key: 'colorSecundario',
        label: 'Color de acento',
        kind: 'color',
        helperText: 'Refuerza bordes, controles y llamados de atención.',
        section: 'Paleta de la línea',
      },
      {
        key: 'colorTerciario',
        label: 'Color de apoyo',
        kind: 'color',
        helperText: 'Para distintivos, etiquetas y señalización secundaria.',
        section: 'Paleta de la línea',
      },
      {
        key: 'colorTexto',
        label: 'Color de texto',
        kind: 'color',
        helperText: 'Debe leerse con claridad encima del color principal.',
        section: 'Paleta de la línea',
      },
      {
        key: 'colorFondo',
        label: 'Fondo de tarjetas',
        kind: 'color',
        helperText: 'Fondo claro para paneles, credenciales y tarjetas.',
        section: 'Paleta de la línea',
      },
      {
        key: 'distintivoTipo',
        label: 'Tipo de distintivo opcional',
        kind: 'select',
        options: [
          { label: 'Banderita', value: 'banderita' },
          { label: 'Cartel', value: 'cartel' },
          { label: 'Número', value: 'numero' },
          { label: 'Texto', value: 'texto' },
          { label: 'Símbolo', value: 'simbolo' },
        ],
        helperText: 'Úsalo solo si la línea lleva una banderita, símbolo o cartel adicional.',
        section: 'Señalización de la unidad',
        sectionDescription:
          'Estos elementos son opcionales: cada línea se identifica de manera distinta.',
      },
      {
        key: 'distintivoValor',
        label: 'Banderita o identificador opcional',
        kind: 'text',
        maxLength: 80,
        placeholder: '🚩, 120, Norte o cualquier símbolo',
        helperText: 'Déjalo vacío si la línea se identifica solo con número y destinos.',
        section: 'Señalización de la unidad',
      },
      {
        key: 'cartelSuperior',
        label: 'Texto operativo del recorrido',
        kind: 'text',
        maxLength: 120,
        placeholder: 'Ej. Tiquipaya · Univalle · 120',
        helperText:
          'Resumen que verá la operación y la app móvil. El diseño físico se compone en la pestaña Letrero.',
        section: 'Señalización de la unidad',
      },
      {
        key: 'cartelFormato',
        label: 'Formato del letrero',
        kind: 'select',
        options: [
          { label: 'Doble clásico (referencia 120)', value: 'doble_clasico' },
          { label: 'Una sola línea', value: 'simple' },
          { label: 'Tres renglones', value: 'tres_lineas' },
        ],
        helperText: 'Define la estructura de lectura de la placa superior.',
        section: 'Estructura física',
        sectionDescription: 'Configura cada elemento que realmente puede llevar el letrero.',
      },
      {
        key: 'cartelNumeroPosicion',
        label: 'Posición del número',
        kind: 'select',
        options: [
          { label: 'A la izquierda', value: 'izquierda' },
          { label: 'A la derecha', value: 'derecha' },
        ],
        helperText: 'En la referencia 120 el número va a la izquierda.',
        section: 'Estructura física',
      },
      {
        key: 'cartelLogoPosicion',
        label: 'Logo dentro del letrero',
        kind: 'select',
        options: [
          { label: 'Sin logo (como la referencia)', value: 'ninguno' },
          { label: 'A la izquierda', value: 'izquierda' },
          { label: 'A la derecha', value: 'derecha' },
        ],
        helperText: 'Opcional: muchas líneas usan solo texto y número.',
        section: 'Estructura física',
      },
      {
        key: 'cartelTitulo',
        label: 'Título superior',
        kind: 'text',
        maxLength: 60,
        placeholder: 'Ej. TIQUIPAYA',
        helperText: 'Primer renglón grande, normalmente el destino principal.',
        section: 'Textos del letrero',
        sectionDescription: 'No se mezclan automáticamente: cada renglón se edita por separado.',
      },
      {
        key: 'cartelDetalle',
        label: 'Detalle inferior',
        kind: 'text',
        maxLength: 80,
        placeholder: 'Ej. UNIVALLE',
        helperText: 'Segundo renglón destacado: universidad, zona, asociación o referencia.',
        section: 'Textos del letrero',
      },
      {
        key: 'cartelColorNumero',
        label: 'Color del número',
        kind: 'color',
        helperText: 'Ej. rojo para el 120 de la referencia.',
        section: 'Tintas y borde',
        sectionDescription:
          'Los colores del letrero pueden ser distintos a la marca general de la línea.',
      },
      {
        key: 'cartelColorTitulo',
        label: 'Color del título superior',
        kind: 'color',
        helperText: 'Ej. rojo para TIQUIPAYA.',
        section: 'Tintas y borde',
      },
      {
        key: 'cartelColorDetalle',
        label: 'Color del detalle inferior',
        kind: 'color',
        helperText: 'Ej. azul para UNIVALLE.',
        section: 'Tintas y borde',
      },
      {
        key: 'cartelColorBorde',
        label: 'Color del borde',
        kind: 'color',
        helperText: 'Borde fino de la placa blanca.',
        section: 'Tintas y borde',
      },
    ];
    if (user?.rol === 'admin_quivo') {
      base.push({
        key: 'sindicatoId',
        label: 'Sindicato',
        kind: 'select',
        options: sindicatoOptions,
        required: true,
      });
    }
    return base;
  }, [token, user?.rol, sindicatoOptions]);

  const dataSource = useMemo<ModuleDataSource<Linea>>(
    () => ({
      list: () => lineasApi.listar(token ?? ''),
      create: (values) => lineasApi.crear(token ?? '', values as never),
      update: (id, values) => lineasApi.actualizar(token ?? '', id, values as never),
    }),
    [token],
  );

  const formTabs = useMemo<FormTabConfig[]>(
    () => [
      {
        value: 'general',
        label: 'Datos generales',
        fieldKeys: ['codigo', 'nombre', 'sindicatoId'],
        description: 'Identifica la línea y define a qué sindicato pertenece.',
      },
      {
        value: 'operacion',
        label: 'Operación y edición',
        fieldKeys: [
          'color',
          'colorSecundario',
          'colorTexto',
          'colorTerciario',
          'colorFondo',
          'nombreCorto',
          'lema',
          'descripcion',
          'logoUrl',
          'distintivoTipo',
          'distintivoValor',
          'cartelSuperior',
        ],
        description:
          'Personaliza la identidad, el distintivo superior y el cartel que ayudarán a ubicar cada unidad.',
      },
      {
        value: 'letrero',
        label: 'Letrero real',
        fieldKeys: [
          'cartelFormato',
          'cartelNumeroPosicion',
          'cartelLogoPosicion',
          'cartelTitulo',
          'cartelDetalle',
          'cartelColorNumero',
          'cartelColorTitulo',
          'cartelColorDetalle',
          'cartelColorBorde',
        ],
        description:
          'Compone la placa que se coloca sobre el trufi: número, dos renglones, logo opcional y tintas.',
      },
    ],
    [],
  );

  return (
    <div className="lineas-page">
      <ModuleTablePage<Linea>
        title="Líneas"
        subtitle="Identidad visual, señalización y ubicación operativa de cada línea."
        entityLabel="línea"
        searchPlaceholder="Buscar línea, cartel o distintivo..."
        searchKeys={[
          'codigo',
          'nombre',
          'nombreCorto',
          'lema',
          'distintivoValor',
          'cartelSuperior',
        ]}
        fields={fields}
        formTabs={formTabs}
        formPresentation="inline"
        renderFormPreview={(values) => <LineaBoxPreview values={values} />}
        createDefaults={{
          sindicatoId: user?.sindicatoId ?? '',
          distintivoTipo: 'cartel',
          cartelFormato: 'doble_clasico',
          cartelNumeroPosicion: 'izquierda',
          cartelLogoPosicion: 'ninguno',
          cartelColorNumero: '#b91c1c',
          cartelColorTitulo: '#b91c1c',
          cartelColorDetalle: '#1d4ed8',
          cartelColorBorde: '#64748b',
        }}
        dataSource={dataSource}
        renderRowActions={(row, replaceRow) => (
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
        )}
        columns={[
          {
            key: 'branding',
            header: 'Identidad',
            render: (row) => (
              <div
                className="line-brand-cell"
                style={{
                  background: row.color ?? 'var(--qv-color-primary)',
                  borderColor: row.colorSecundario ?? 'var(--qv-color-accent)',
                  color: row.colorTexto ?? '#ffffff',
                }}
              >
                <div className="line-brand-heading">
                  {row.logoUrl ? (
                    <img src={row.logoUrl} alt="" className="line-brand-logo" />
                  ) : null}
                  <strong>{row.nombreCorto || row.codigo}</strong>
                  {row.distintivoValor ? (
                    <span className="line-brand-marker">{row.distintivoValor}</span>
                  ) : null}
                </div>
                <span>{row.lema || row.nombre}</span>
                {row.cartelSuperior ? (
                  <small className="line-brand-sign">{row.cartelSuperior}</small>
                ) : null}
              </div>
            ),
          },
          { key: 'codigo', header: 'Código' },
          { key: 'nombre', header: 'Nombre' },
          {
            key: 'publicStatus',
            header: 'App pasajero',
            render: (row) => estadoPublicoEtiqueta(row.publicStatus),
          },
          {
            key: 'color',
            header: 'Paleta',
            render: (row) => (
              <span className="line-palette-cell">
                <span
                  aria-label={`Color primario ${row.color ?? 'sin definir'}`}
                  style={{ background: row.color ?? 'var(--qv-color-primary)' }}
                />
                <span
                  aria-label={`Color secundario ${row.colorSecundario ?? 'sin definir'}`}
                  style={{ background: row.colorSecundario ?? 'var(--qv-color-accent)' }}
                />
                <span
                  aria-label={`Color de apoyo ${row.colorTerciario ?? 'sin definir'}`}
                  style={{ background: row.colorTerciario ?? 'var(--qv-color-primary)' }}
                />
              </span>
            ),
          },
          {
            key: 'sindicatoId',
            header: 'Sindicato',
            render: (row) => nombrePorId[row.sindicatoId] ?? row.sindicatoId,
          },
        ]}
      />
    </div>
  );
}

const SIGUIENTE_ESTADO: Record<EstadoPublicacion, EstadoPublicacion | null> = {
  borrador: 'validado',
  validado: 'publicado',
  publicado: 'validado',
  archivado: 'borrador',
};

const ETIQUETA_TRANSICION: Record<EstadoPublicacion, string> = {
  borrador: 'Validar',
  validado: 'Publicar',
  publicado: 'Quitar de la app',
  archivado: 'Reabrir',
};

function estadoPublicoEtiqueta(status: EstadoPublicacion) {
  return status === 'publicado' ? 'Visible' : status === 'validado' ? 'Lista para publicar' : 'No visible';
}

function LineaPublicationAction({
  linea,
  token,
  onUpdated,
}: {
  linea: Linea;
  token: string;
  onUpdated: (publication: { status: EstadoPublicacion; publishedAt: string | null }) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextStatus = SIGUIENTE_ESTADO[linea.publicStatus];

  if (!nextStatus) return null;

  const updatePublication = async () => {
    setSaving(true);
    setError(null);
    try {
      const publication = await lineasApi.actualizarPublicacion(token, linea.id, nextStatus);
      onUpdated(publication);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar la publicación.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <span title={error ?? undefined}>
      <Button variant="ghost" size="sm" onClick={updatePublication} disabled={saving || !token}>
        {saving ? 'Actualizando...' : ETIQUETA_TRANSICION[linea.publicStatus]}
      </Button>
    </span>
  );
}

function LineaBoxPreview({ values }: { values: Record<string, string> }) {
  const primary = values.color || '#3226b4';
  const secondary = values.colorSecundario || '#fd9e15';
  const background = values.colorFondo || '#f8fafc';
  const code = values.nombreCorto || values.codigo || '120';
  const marker = values.distintivoValor?.trim() || '';
  const hasMarker = marker.length > 0;
  const roofSign = values.cartelSuperior || 'TIQUIPAYA · UNIVALLE';
  const name = values.nombre || 'Nueva línea';
  const destinations = roofSign
    .split(/\s*(?:↔|→|⇄|·|\||—|–)\s*/)
    .map((destination) => destination.trim())
    .filter(Boolean);
  const bannerTop = values.cartelTitulo || destinations[0] || roofSign;
  const bannerBottom =
    values.cartelDetalle || destinations.slice(1).join(' · ') || values.lema || 'RUTA URBANA';
  const bannerFormat = values.cartelFormato || 'doble_clasico';
  const numberPosition = values.cartelNumeroPosicion || 'izquierda';
  const logoPosition = values.cartelLogoPosicion || 'ninguno';
  const numberColor = values.cartelColorNumero || primary;
  const titleColor = values.cartelColorTitulo || primary;
  const detailColor = values.cartelColorDetalle || secondary;
  const borderColor = values.cartelColorBorde || '#64748b';
  const showsLogo = Boolean(values.logoUrl && logoPosition !== 'ninguno');

  return (
    <aside className="line-box-preview" aria-label="Vista previa del letrero de trufi">
      <div className="line-box-preview__header">
        <div>
          <span className="line-box-preview__eyebrow">Referencia de calle</span>
          <h3>Letrero sobre techo</h3>
        </div>
        <span className="line-box-preview__live">
          <span aria-hidden="true" /> A escala
        </span>
      </div>

      <div
        className="trufi-sign-preview"
        style={{
          background: `linear-gradient(145deg, ${background}, color-mix(in srgb, ${primary} 7%, white))`,
          borderColor: `${primary}2e`,
        }}
      >
        <span className="trufi-sign-preview__caption">
          Maqueta del cartel · vista frontal aislada
        </span>
        <div className="trufi-sign-preview__workbench">
          <div
            className={`trufi-sign-preview__banner trufi-sign-preview__banner--${bannerFormat} trufi-sign-preview__banner--number-${numberPosition}`}
            style={{ borderColor, boxShadow: `0 0.42rem 0.8rem ${borderColor}30` }}
          >
            {showsLogo && logoPosition === 'izquierda' ? (
              <span className="trufi-sign-preview__logo">
                <img src={values.logoUrl} alt="" />
              </span>
            ) : null}
            <span
              className="trufi-sign-preview__number"
              style={{ borderColor, color: numberColor }}
            >
              {code}
            </span>
            <div className="trufi-sign-preview__destinations">
              <strong className="trufi-sign-preview__destination-top" style={{ color: titleColor }}>
                {bannerTop.toUpperCase()}
              </strong>
              <strong
                className="trufi-sign-preview__destination-bottom"
                style={{ color: detailColor }}
              >
                {bannerBottom.toUpperCase()}
              </strong>
            </div>
            {showsLogo && logoPosition === 'derecha' ? (
              <span className="trufi-sign-preview__logo">
                <img src={values.logoUrl} alt="" />
              </span>
            ) : null}
          </div>
        </div>
        <div className="trufi-sign-preview__reading">
          <span>
            <Info size={14} aria-hidden="true" /> Letrero de techo
          </span>
          <strong>
            {bannerTop} · {bannerBottom}
          </strong>
        </div>
      </div>

      <div className="line-box-preview__identity">
        {values.logoUrl ? (
          <img src={values.logoUrl} alt="" className="line-box-preview__logo" />
        ) : (
          <span className="line-box-preview__logo-fallback" style={{ background: primary }}>
            {code.slice(0, 3)}
          </span>
        )}
        <div>
          <span className="line-box-preview__identity-label">Línea configurada</span>
          <strong>{name}</strong>
          <small>
            {hasMarker
              ? `${values.distintivoTipo || 'Distintivo'}: ${marker}`
              : 'Sin distintivo adicional'}
          </small>
        </div>
      </div>

      <div className="line-box-preview__checks">
        <div>
          <Signpost size={16} style={{ color: secondary }} aria-hidden="true" />
          <span>
            <small>Texto del letrero</small>
            <strong>
              {bannerTop} · {bannerBottom}
            </strong>
          </span>
        </div>
        <div>
          <Palette size={16} style={{ color: primary }} aria-hidden="true" />
          <span>
            <small>Color del rótulo</small>
            <strong>{primary.toUpperCase()}</strong>
          </span>
        </div>
      </div>

      <div className="line-box-preview__palette">
        <span>
          <Palette size={15} aria-hidden="true" /> Colores aplicados
        </span>
        <div aria-label="Colores de la línea">
          <i style={{ background: primary }} />
          <i style={{ background: secondary }} />
          <i style={{ background: values.colorTerciario || '#0f766e' }} />
        </div>
      </div>
    </aside>
  );
}
