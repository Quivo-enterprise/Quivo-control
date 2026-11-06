'use client';

import type { SelectOption } from '@quivo/design-system';
import type { GravedadRegla, Linea } from '@quivo/shared';
import { BellRing, ChevronDown, Ellipsis, History, ListFilter, Maximize2, Navigation, RefreshCw, Route } from 'lucide-react';
import { MenuAcciones, type ItemMenuAcciones } from '../../../src/components/menu-acciones';
import { ETIQUETA_NIVEL, NIVELES_DESC, resumenAlertasDia, textoAlertasAbiertas } from '../../../src/lib/en-vivo/alertas';
import { useSaludRefresco } from '../../../src/lib/en-vivo/use-salud-refresco';
import { SALUD } from './barra-mando';
import { IconoNivel } from './panel-vehiculo';

/** Hoja: el tick de 1 Hz de `useSaludRefresco` re-renderiza solo esto, nunca el mapa. */
function ChipSalud({ consulta, enServicio, total }: { consulta: { dataUpdatedAt: number; isError: boolean }; enServicio: number; total: number }) {
  const salud = useSaludRefresco(consulta);
  return (
    <div className={`qv-chip-mapa qv-chip-mapa--salud qv-chip-mapa--${salud.estado}`}>
      <i className="qv-chip-mapa__punto" aria-hidden="true" />
      {/* Solo el estado va en la región viva: los segundos cambian cada 1 s y spamearían al lector. */}
      <span role="status" className="qv-visually-hidden">
        {SALUD[salud.estado].texto}
      </span>
      {salud.estado === 'sin_conexion' ? (
        'Sin conexión'
      ) : (
        <>
          <span>
            {enServicio} de {total}
          </span>
          <span className="qv-chip-mapa__seg">
            · <span className="qv-chip-mapa__hace">hace </span>
            {salud.segundos}&nbsp;s
          </span>
        </>
      )}
    </div>
  );
}

interface ChipsMapaProps {
  consulta: { dataUpdatedAt: number; isError: boolean };
  /** Flota de la línea elegida: los mismos números que el panel de flota (`resumenFlota`). */
  enServicio: number;
  total: number;
  lineas: Linea[];
  lineaOptions: SelectOption[];
  lineaFilter: string;
  onLinea: (id: string) => void;
  puedeVerDias: boolean;
  onDias: () => void;
  /** Sin HUD de flota (vacío) no hay panel, seguimiento, encuadre ni datos que refrescar. */
  hayHud: boolean;
  onToggleFlota: () => void;
  seguir: boolean;
  puedeSeguir: boolean;
  onSeguir: () => void;
  onAmpliar: () => void;
  onRefrescar: () => void;
  // Alertas: los mismos datos y handlers que `BarraMando` (el operador no tiene la pestaña Alertas).
  conteoNiveles: Record<GravedadRegla, number>;
  nivelFiltro: GravedadRegla | null;
  onNivel: (nivel: GravedadRegla | null) => void;
  alertasPendientes: number;
  alertasEnMapa: number;
  abiertasHoy: number | 'cargando' | 'error';
  puedeVerAlertas: boolean;
  onSiguienteAlerta: () => void;
}

/** Móvil (<= 720 px): chips flotantes sobre el mapa (comp B `.fab`). Reemplaza a la barra de mando y a la tarjeta de controles. */
export function ChipsMapa(p: ChipsMapaProps) {
  const actual = p.lineas.find((l) => l.id === p.lineaFilter);
  const nombre = actual ? actual.nombreCorto || `Línea ${actual.codigo}` : 'Todas las líneas';
  const textoChip = actual ? nombre : 'Todas'; // el chip es angosto; el nombre completo va en el aria-label
  const itemsLinea: ItemMenuAcciones[] = [{ value: '', label: 'Todas las líneas' }, ...p.lineaOptions].map((o) => ({
    clave: o.value || 'todas',
    etiqueta: o.label,
    rol: 'menuitemradio',
    marcado: p.lineaFilter === o.value,
    onSelect: () => p.onLinea(o.value),
  }));
  const sinInfracciones = NIVELES_DESC.every((n) => p.conteoNiveles[n] === 0) && !p.nivelFiltro;
  const dia = resumenAlertasDia(p.abiertasHoy, p.alertasEnMapa, p.puedeVerAlertas);
  // El operador no tiene la pestaña Alertas: el conteo del día se ve en el disparador sin abrir el menú.
  const insignia = !p.puedeVerAlertas && typeof p.abiertasHoy === 'number' ? p.abiertasHoy : null;
  const etiquetaMas = [
    'Más opciones del mapa',
    insignia ? textoAlertasAbiertas(insignia) : null,
    p.nivelFiltro ? `Filtro activo: solo alertas ${ETIQUETA_NIVEL[p.nivelFiltro].plural}` : null,
  ]
    .filter(Boolean)
    .join('. ');
  const itemsAlertas: ItemMenuAcciones[] = [
    ...(dia.boton === 'siguiente'
      ? [
          {
            clave: 'siguiente-alerta',
            etiqueta: 'Siguiente alerta',
            icono: <BellRing size={20} aria-hidden="true" />,
            disabled: p.alertasPendientes === 0,
            onSelect: p.onSiguienteAlerta,
          },
        ]
      : []),
    ...(sinInfracciones
      ? []
      : NIVELES_DESC.map((nivel): ItemMenuAcciones => {
          const n = p.conteoNiveles[nivel];
          const activo = p.nivelFiltro === nivel;
          const e = ETIQUETA_NIVEL[nivel];
          return {
            clave: `nivel-${nivel}`,
            etiqueta: `${n} ${n === 1 ? e.singular : e.plural}`,
            icono: <IconoNivel nivel={nivel} size={20} />,
            rol: 'menuitemcheckbox',
            marcado: activo,
            disabled: n === 0 && !activo,
            onSelect: () => p.onNivel(activo ? null : nivel),
          };
        })),
  ];
  const itemsMas: ItemMenuAcciones[] = [
    { clave: 'flota', etiqueta: 'Flota', icono: <ListFilter size={20} aria-hidden="true" />, disabled: !p.hayHud, onSelect: p.onToggleFlota },
    ...(p.puedeVerDias
      ? [{ clave: 'dias', etiqueta: 'Días anteriores', icono: <History size={20} aria-hidden="true" />, onSelect: p.onDias }]
      : []),
    ...itemsAlertas,
    {
      clave: 'seguir',
      etiqueta: 'Seguir',
      icono: <Navigation size={20} aria-hidden="true" />,
      rol: 'menuitemcheckbox',
      marcado: p.seguir && p.puedeSeguir,
      disabled: !p.hayHud || !p.puedeSeguir,
      onSelect: p.onSeguir,
    },
    { clave: 'ampliar', etiqueta: 'Ampliar', icono: <Maximize2 size={20} aria-hidden="true" />, disabled: !p.hayHud, onSelect: p.onAmpliar },
    {
      clave: 'refrescar',
      etiqueta: 'Refrescar',
      icono: <RefreshCw size={20} aria-hidden="true" />,
      disabled: !p.hayHud,
      onSelect: p.onRefrescar,
    },
  ];
  return (
    <header className="qv-chips-mapa" aria-label="Controles de En vivo">
      <h1 className="qv-visually-hidden">En vivo</h1>
      <div className="qv-chips-mapa__izq">
        <MenuAcciones
          etiqueta={`Línea: ${nombre}. Cambiar línea`}
          className="qv-chip-mapa qv-chip-mapa--linea"
          items={itemsLinea}
        >
          <Route size={20} aria-hidden="true" />
          <span className="qv-chip-mapa__nombre">{textoChip}</span>
          <ChevronDown size={18} aria-hidden="true" />
        </MenuAcciones>
        <MenuAcciones
          etiqueta={etiquetaMas}
          className={`qv-chip-mapa qv-chip-mapa--mas${p.nivelFiltro ? ' qv-chip-mapa--activo' : ''}`}
          items={itemsMas}
          dataDisparador="disparador-flota"
          resumen={dia.texto}
          insignia={insignia}
        >
          <Ellipsis size={24} aria-hidden="true" />
        </MenuAcciones>
      </div>
      <ChipSalud consulta={p.consulta} enServicio={p.enServicio} total={p.total} />
    </header>
  );
}
