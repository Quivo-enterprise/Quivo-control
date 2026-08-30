import { useMemo } from 'react';
import type { Linea } from '@quivo/shared';
import {
  type EntityFieldConfig,
  type FormTabConfig,
  type ModuleDataSource,
} from '../../../src/components/module-table-page';
import { lineasApi, subirLogoLinea } from '../../../src/lib/api/lineas';

/**
 * Configuración de campos del formulario de líneas: identidad, paleta y estructura física
 * del letrero. Depende de `token` (subida de logo), del rol del actor (solo admin_quivo
 * puede reasignar sindicato) y de las opciones de sindicato ya resueltas.
 */
export function useLineaFields(
  token: string,
  esAdminQuivo: boolean,
  sindicatoOptions: { label: string; value: string }[],
): EntityFieldConfig[] {
  return useMemo<EntityFieldConfig[]>(() => {
    const base: EntityFieldConfig[] = [
      {
        key: 'codigo',
        label: 'Código',
        kind: 'text',
        required: true,
        placeholder: 'Ej. 120',
        section: 'Identidad base',
        sectionDescription: 'Identificación oficial de la línea en el sistema de transporte.',
      },
      {
        key: 'nombre',
        label: 'Nombre de la línea',
        kind: 'text',
        required: true,
        placeholder: 'Ej. Línea 120 Tiquipaya',
        section: 'Identidad base',
      },
      {
        key: 'nombreCorto',
        label: 'Nombre corto',
        kind: 'text',
        maxLength: 40,
        placeholder: 'Ej. 120',
        helperText: 'Identificador visible en la credencial y la app del chofer.',
        section: 'Identidad base',
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
        upload: (file) => subirLogoLinea(token, file),
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
        placeholder: '120, Norte, Banderín o símbolo distintivo',
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
    if (esAdminQuivo) {
      base.push({
        key: 'sindicatoId',
        label: 'Sindicato',
        kind: 'select',
        options: sindicatoOptions,
        required: true,
      });
    }
    return base;
  }, [token, esAdminQuivo, sindicatoOptions]);
}

/** Estático: 5 herramientas de configuración estructuradas para el formulario de líneas. */
export const LINEA_FORM_TABS: FormTabConfig[] = [
  {
    value: 'identidad',
    label: '01 Identidad Base',
    fieldKeys: ['codigo', 'nombre', 'nombreCorto', 'lema', 'descripcion', 'sindicatoId'],
    description: 'Código, nombre oficial, lema y sindicato al que pertenece la línea.',
  },
  {
    value: 'simbolo',
    label: '02 Símbolo y Emblema',
    fieldKeys: ['logoUrl'],
    description: 'Sube o actualiza el emblema oficial representativo de la línea.',
  },
  {
    value: 'paleta',
    label: '03 Paleta y Colores',
    fieldKeys: ['color', 'colorSecundario', 'colorTerciario', 'colorTexto', 'colorFondo'],
    description: 'Colores oficiales de la línea: primario, acento, apoyo, texto y fondos.',
  },
  {
    value: 'distintivos',
    label: '04 Señalización y Banderita',
    fieldKeys: ['distintivoTipo', 'distintivoValor', 'cartelSuperior'],
    description: 'Banderitas, distintivos gráficos de recorrido y resumen operativo.',
  },
  {
    value: 'letrero',
    label: '05 Letrero de Techo',
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
      'Composición física del letrero frontal: formato, posición del número y tintas de impresión.',
  },
];

/** Encapsula cómo `ModuleTablePage` obtiene/crea/actualiza líneas — la página no conoce `lineasApi`. */
export function useLineasDataSource(token: string): ModuleDataSource<Linea> {
  return useMemo<ModuleDataSource<Linea>>(
    () => ({
      list: () => lineasApi.listar(token),
      create: (values) => lineasApi.crear(token, values as never),
      update: (id, values) => lineasApi.actualizar(token, id, values as never),
    }),
    [token],
  );
}
