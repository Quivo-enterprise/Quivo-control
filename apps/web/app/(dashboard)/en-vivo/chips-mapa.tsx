'use client';

import type { SelectOption } from '@quivo/design-system';
import type { Linea } from '@quivo/shared';
import { ChevronDown, Ellipsis, History, ListFilter, Maximize2, Navigation, RefreshCw, Route } from 'lucide-react';
import { MenuAcciones, type ItemMenuAcciones } from '../../../src/components/menu-acciones';
import { useSaludRefresco, type SaludRefresco } from '../../../src/lib/en-vivo/use-salud-refresco';

const TEXTO_ESTADO: Record<SaludRefresco['estado'], string> = {
  ok: 'En vivo',
  lento: 'Actualización lenta',
  sin_conexion: 'Sin conexión',
};

/** Hoja: el tick de 1 Hz de `useSaludRefresco` re-renderiza solo esto, nunca el mapa. */
function ChipSalud({ consulta, enServicio, total }: { consulta: { dataUpdatedAt: number; isError: boolean }; enServicio: number; total: number }) {
  const salud = useSaludRefresco(consulta);
  return (
    <div className={`qv-chip-mapa qv-chip-mapa--salud qv-chip-mapa--${salud.estado}`}>
      <i className="qv-chip-mapa__punto" aria-hidden="true" />
      {/* Solo el estado va en la región viva: los segundos cambian cada 1 s y spamearían al lector. */}
      <span role="status" className="qv-visually-hidden">
        {TEXTO_ESTADO[salud.estado]}
      </span>
      {salud.estado === 'sin_conexion' ? (
        'Sin conexión'
      ) : (
        <>
          <span>
            {enServicio} de {total}
          </span>
          <span className="qv-chip-mapa__seg">· hace {salud.segundos}&nbsp;s</span>
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
  refrescando: boolean;
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
  const itemsMas: ItemMenuAcciones[] = [
    { clave: 'flota', etiqueta: 'Flota', icono: <ListFilter size={20} aria-hidden="true" />, disabled: !p.hayHud, onSelect: p.onToggleFlota },
    ...(p.puedeVerDias
      ? [{ clave: 'dias', etiqueta: 'Días anteriores', icono: <History size={20} aria-hidden="true" />, onSelect: p.onDias }]
      : []),
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
      icono: <RefreshCw size={20} aria-hidden="true" className={p.refrescando ? 'qv-live-ico-girando' : undefined} />,
      disabled: !p.hayHud,
      onSelect: p.onRefrescar,
    },
  ];
  return (
    <div className="qv-chips-mapa">
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
          etiqueta="Más opciones del mapa"
          className="qv-chip-mapa qv-chip-mapa--mas"
          items={itemsMas}
          dataDisparador="disparador-flota"
        >
          <Ellipsis size={24} aria-hidden="true" />
        </MenuAcciones>
      </div>
      <ChipSalud consulta={p.consulta} enServicio={p.enServicio} total={p.total} />
    </div>
  );
}
