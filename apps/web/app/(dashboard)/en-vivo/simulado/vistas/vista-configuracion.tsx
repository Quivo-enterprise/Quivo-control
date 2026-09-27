'use client';

import { Button, Checkbox, Input, SegmentedControl } from '@quivo/design-system';
import { CheckCircle2, RotateCcw, Save, Settings2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  configDe,
  largoTotalM,
  useFlotaMock,
  validarConfigLinea,
  type ConfigLineaInput,
  type ConfigLineaMock,
  type LineaMockId,
  type ParadaConfigMock,
} from '../../../../../src/lib/mock-flota';
import { VistaPanel, type VistaProps } from './vista-panel';

/**
 * Vista "Configuración" (E08 06:01 del guion — `docs/guion-grabacion-mock.md`): horario,
 * paradas y puntos de control por línea. Todo es un DRAFT local hasta "Guardar cambios" —
 * `validarConfigLinea` corre en el cliente para mostrar errores antes de intentar guardar
 * (el reducer también valida e ignora un input inválido, como segunda defensa).
 */

function aInput(config: ConfigLineaMock): ConfigLineaInput {
  return {
    frecuenciaMin: config.frecuenciaMin,
    horaInicio: config.horaInicio,
    horaFin: config.horaFin,
    paradas: config.paradas.map((p) => ({ ...p })),
  };
}

export function VistaConfiguracion({ lineaId, onCerrar, onResaltarLinea }: VistaProps & { onResaltarLinea?: (lineaId: LineaMockId | null) => void }) {
  const { estado, lineas, guardarConfigLinea } = useFlotaMock();
  const [lineaSel, setLineaSel] = useState<LineaMockId>(lineaId ?? 'z12');
  const [draft, setDraft] = useState<ConfigLineaInput>(() => aInput(configDe(estado, lineaSel)));
  const [errores, setErrores] = useState<string[]>([]);
  const [guardadoOk, setGuardadoOk] = useState(false);

  const linea = lineas[lineaSel];

  // `onResaltarLinea` vive en un ref para que los dos efectos de abajo (mount+cambio / solo
  // unmount) no tengan que declararlo como dependencia — C2 puede pasar una arrow function
  // nueva en cada render sin que estos efectos se re-disparen de más.
  const onResaltarLineaRef = useRef(onResaltarLinea);
  useEffect(() => {
    onResaltarLineaRef.current = onResaltarLinea;
  }, [onResaltarLinea]);

  useEffect(() => {
    onResaltarLineaRef.current?.(lineaSel);
  }, [lineaSel]);

  useEffect(() => {
    return () => onResaltarLineaRef.current?.(null);
  }, []);

  // Al cambiar de línea, el draft vuelve a cargar la config EN VIVO de la nueva línea (se
  // descarta cualquier edición sin guardar de la línea anterior — mismo criterio que un
  // formulario de "editar X" que cambia de entidad).
  useEffect(() => {
    setDraft(aInput(configDe(estado, lineaSel)));
    setErrores([]);
    setGuardadoOk(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo debe correr al cambiar de línea, no en cada tick de `estado`.
  }, [lineaSel]);

  function actualizarParada(id: string, cambios: Partial<ParadaConfigMock>) {
    setDraft((prev) => ({
      ...prev,
      paradas: prev.paradas.map((p) => (p.id === id ? { ...p, ...cambios } : p)),
    }));
    setGuardadoOk(false);
  }

  function handleGuardar() {
    const erroresValidacion = validarConfigLinea(draft);
    setErrores(erroresValidacion);
    if (erroresValidacion.length > 0) {
      setGuardadoOk(false);
      return;
    }
    guardarConfigLinea(lineaSel, draft);
    setGuardadoOk(true);
  }

  function handleDescartar() {
    setDraft(aInput(configDe(estado, lineaSel)));
    setErrores([]);
    setGuardadoOk(false);
  }

  const largoKm = (largoTotalM(linea.polilinea) / 1000).toFixed(1);
  const cantidadParadas = linea.paradas.length;
  const cantidadPuntosControl = draft.paradas.filter((p) => p.esPuntoControl).length;

  return (
    <VistaPanel titulo="Configuración" icono={<Settings2 size={18} aria-hidden="true" />} onCerrar={onCerrar}>
      <section className="qv-vista-section" aria-label="Línea">
        <h3 className="qv-vista-section__title">Línea</h3>
        <SegmentedControl
          value={lineaSel}
          onValueChange={(value) => setLineaSel(value as LineaMockId)}
          items={[
            { value: 'z12', label: 'Z12' },
            { value: 'l120', label: 'Línea 120' },
          ]}
        />
      </section>

      <section className="qv-vista-section" aria-label="Horario">
        <h3 className="qv-vista-section__title">Horario</h3>
        <div className="qv-config-horario">
          <Input
            type="time"
            label="Hora de inicio"
            value={draft.horaInicio}
            onChange={(e) => {
              setDraft((prev) => ({ ...prev, horaInicio: e.target.value }));
              setGuardadoOk(false);
            }}
          />
          <Input
            type="time"
            label="Hora de fin"
            value={draft.horaFin}
            onChange={(e) => {
              setDraft((prev) => ({ ...prev, horaFin: e.target.value }));
              setGuardadoOk(false);
            }}
          />
          <Input
            type="number"
            label="Frecuencia (min)"
            min={3}
            max={60}
            value={draft.frecuenciaMin}
            onChange={(e) => {
              setDraft((prev) => ({ ...prev, frecuenciaMin: Number(e.target.value) }));
              setGuardadoOk(false);
            }}
          />
        </div>
      </section>

      <section className="qv-vista-section" aria-label="Recorrido">
        <h3 className="qv-vista-section__title">Recorrido</h3>
        <div className="qv-config-resumen">
          <span>
            <strong className="qv-tabular">{largoKm} km</strong> de recorrido
          </span>
          <span>
            <strong className="qv-tabular">{cantidadParadas}</strong> paradas
          </span>
          <span>
            <strong className="qv-tabular">{cantidadPuntosControl}</strong> puntos de control
          </span>
        </div>
      </section>

      <section className="qv-vista-section" aria-label="Paradas">
        <h3 className="qv-vista-section__title">Paradas</h3>
        <ol className="qv-config-paradas">
          {linea.paradas.map((paradaFija) => {
            const paradaDraft = draft.paradas.find((p) => p.id === paradaFija.id);
            if (!paradaDraft) return null;
            return (
              <li key={paradaFija.id} className="qv-config-parada">
                <Input
                  label="Nombre de la parada"
                  value={paradaDraft.nombre}
                  onChange={(e) => actualizarParada(paradaFija.id, { nombre: e.target.value })}
                  fullWidth
                />
                <div className="qv-config-parada__fila">
                  <Checkbox
                    label="Es punto de control"
                    checked={paradaDraft.esPuntoControl}
                    onChange={(e) => actualizarParada(paradaFija.id, { esPuntoControl: e.target.checked })}
                  />
                  <Input
                    type="number"
                    label="Radio de tolerancia (m)"
                    min={10}
                    max={200}
                    value={paradaDraft.radioToleranciaM}
                    disabled={!paradaDraft.esPuntoControl}
                    onChange={(e) => actualizarParada(paradaFija.id, { radioToleranciaM: Number(e.target.value) })}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <div aria-live="polite" className="qv-config-feedback">
        {errores.length > 0 && (
          <ul className="qv-config-errores">
            {errores.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
        {guardadoOk && errores.length === 0 && (
          <span className="qv-config-exito">
            <CheckCircle2 size={14} aria-hidden="true" />
            Cambios guardados.
          </span>
        )}
      </div>

      <div className="qv-config-acciones">
        <Button variant="ghost" onClick={handleDescartar}>
          <RotateCcw size={14} aria-hidden="true" />
          Descartar
        </Button>
        <Button variant="primary" onClick={handleGuardar}>
          <Save size={14} aria-hidden="true" />
          Guardar cambios
        </Button>
      </div>
    </VistaPanel>
  );
}
