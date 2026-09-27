'use client';

import { Button, DatePicker, Select } from '@quivo/design-system';
import { CheckCircle2, MessageCircle, User, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  construirUrlWhatsApp,
  fechaPlazoValida,
  infraccionActivaDe,
  infraccionesDe,
  mensajeParaConductor,
  PLAZO_MAX_DIAS,
  SEVERIDAD_META,
  useFlotaMock,
  type LineaMock,
  type ModoAplicacion,
  type TrufiMock,
} from '../../../../src/lib/mock-flota';

/**
 * Ficha lateral flotante del trufi seleccionado (Decisiones 6/7/8/9 del plan). No usa
 * `<Modal>` del design-system a propósito: ese componente centra un diálogo bloqueante y
 * este panel es un panel NO bloqueante, anclado al costado del mapa (el usuario sigue
 * viendo/moviendo el mapa detrás) — mismo criterio visual que `.qv-live-hud-bottom`, pero
 * con semántica de `role="dialog"` + cierre por Escape porque tiene foco propio de tarea.
 */

interface TrufiPanelProps {
  trufi: TrufiMock;
  linea: LineaMock;
  onClose: () => void;
}

/**
 * Formatea una fecha `yyyy-mm-dd` (sin hora, la que entrega `<DatePicker>`) como `dd/mm`.
 * Se parsea a mano SPLITEANDO el string (nunca con `new Date(iso)`): el motor de JS lo
 * interpretaría como medianoche UTC, y de ahí no hay ninguna forma de volver al día
 * calendario LOCAL sin arriesgarse a correrlo un día (mismo motivo que `fechaPlazoValida` en
 * `estado.ts`, y el mismo bug que `hoyISO`/`maxPlazoISO` de abajo evitan). Como `iso` es
 * literalmente `yyyy-mm-dd`, separar por `-` ya da los componentes exactos sin pasar por
 * ningún huso horario.
 */
function formatearFechaCorta(iso: string): string {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!partes) return iso;
  const [, , mes, dia] = partes;
  return `${dia}/${mes}`;
}

/** Fecha `yyyy-mm-dd` de un `Date`, en su día calendario LOCAL (nunca `toISOString()`, que
 * convierte a UTC y en cualquier huso negativo —Bolivia, UTC-4— puede correr la fecha un día
 * hacia adelante cerca de la medianoche local). */
function fechaLocalISO(fecha: Date): string {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

function hoyISO(): string {
  return fechaLocalISO(new Date());
}

function maxPlazoISO(): string {
  const max = new Date();
  max.setDate(max.getDate() + PLAZO_MAX_DIAS);
  return fechaLocalISO(max);
}

export function TrufiPanel({ trufi, linea, onClose }: TrufiPanelProps) {
  const { estado, catalogo, asignarParada, aplicarAccion } = useFlotaMock();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLSpanElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const infraccionActiva = infraccionActivaDe(estado, trufi.id);
  const tipoActivo = infraccionActiva ? catalogo.find((t) => t.id === infraccionActiva.tipoId) : undefined;
  const historial = infraccionesDe(estado, trufi.id).filter((i) => i.estado === 'sancionada');
  const estadoTrufi = estado.trufis[trufi.id];

  const [paradaSeleccionada, setParadaSeleccionada] = useState(estadoTrufi?.siguienteParadaId ?? '');
  const [accionId, setAccionId] = useState<string>('');
  const [modo, setModo] = useState<ModoAplicacion>('ahora');
  const [venceEl, setVenceEl] = useState('');
  const [confirmacion, setConfirmacion] = useState<string | null>(null);

  // Al cambiar de trufi seleccionado, el formulario de acción (y su confirmación) vuelve a
  // su estado inicial. OJO: esto depende SOLO de `trufi.id`, no de `infraccionActiva?.id` —
  // `aplicarAccion` hace que la infracción deje de estar "activa" en la MISMA actualización
  // de estado que muestra la confirmación (`handleConfirmarAccion` más abajo), así que un
  // efecto que reaccionara a "la infracción activa cambió" borraría la confirmación un
  // instante después de mostrarla, antes de que el usuario (o un lector de pantalla vía
  // `aria-live`) llegara a verla.
  useEffect(() => {
    setAccionId('');
    setModo('ahora');
    setVenceEl('');
    setConfirmacion(null);
  }, [trufi.id]);

  useEffect(() => {
    setParadaSeleccionada(estadoTrufi?.siguienteParadaId ?? '');
  }, [trufi.id, estadoTrufi?.siguienteParadaId]);

  // Foco al abrir el panel / al cambiar de trufi (WAI-ARIA Authoring Practices para
  // `role="dialog"`): mueve el foco al encabezado (con `tabIndex=-1`, no es tabulable de por
  // sí) para que un lector de pantalla anuncie de inmediato la ficha que se acaba de abrir, en
  // vez de dejar el foco donde estaba (el botón-marcador del mapa, que ya no es lo relevante).
  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    headingRef.current?.focus();
  }, [trufi.id]);

  // Al desmontar (cierre del panel, ver `onClose`/el `&&` en `en-vivo-simulado.tsx`), devuelve
  // el foco al botón-marcador que lo abrió, si todavía existe en el DOM — evita que el foco
  // caiga al `<body>` y el usuario de teclado/lector de pantalla pierda el lugar.
  useEffect(
    () => () => {
      previousFocusRef.current?.focus?.();
    },
    [],
  );

  // Escape cierra el panel — salvo que el Escape ya lo haya consumido un control hijo (el
  // combobox `Select` del design-system: su propio trigger llama `preventDefault()` en
  // Escape cuando está abierto, ver `packages/design-system/src/ui/form.tsx`) o que haya un
  // listbox abierto en pantalla: sin este guard, Escape con el `Select` de "Siguiente parada"
  // abierto cerraba el dropdown Y el panel completo de un solo golpe de tecla.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const panel = panelRef.current;
      if (panel?.querySelector('[aria-expanded="true"]')) return;
      if (document.querySelector('[role="listbox"]')) return;
      onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Confirmación obsoleta (fix de revisión): si aparece una NUEVA infracción activa para este
  // mismo trufi mientras el banner de una acción anterior todavía se muestra, hay que
  // limpiarlo — de lo contrario "Advertencia aplicada ahora" de la infracción YA resuelta
  // sigue viéndose junto a una infracción totalmente distinta. Rastrea el id ANTERIOR con un
  // ref (no derivado de `confirmacion`, que este mismo efecto no debe pisar en el instante en
  // que `handleConfirmarAccion` la fija — ver el comentario del efecto de `trufi.id` arriba):
  // solo limpia cuando el id pasa a ser uno DEFINIDO y distinto del anterior. La transición
  // activa → sancionada (el id pasa a `undefined`) no entra en el `if` y el banner sobrevive,
  // como ya se documentaba arriba.
  const infraccionActivaIdPreviaRef = useRef<string | undefined>(infraccionActiva?.id);
  useEffect(() => {
    const idActual = infraccionActiva?.id;
    if (idActual !== undefined && idActual !== infraccionActivaIdPreviaRef.current) {
      setConfirmacion(null);
    }
    infraccionActivaIdPreviaRef.current = idActual;
  }, [infraccionActiva?.id]);

  const paradaAsignadaNombre = useMemo(() => {
    if (!estadoTrufi?.siguienteParadaId) return null;
    return linea.paradas.find((p) => p.id === estadoTrufi.siguienteParadaId)?.nombre ?? null;
  }, [estadoTrufi?.siguienteParadaId, linea.paradas]);

  const plazoValido = modo === 'ahora' || (venceEl !== '' && fechaPlazoValida(venceEl, new Date().toISOString()));

  function handleAsignar() {
    if (!paradaSeleccionada) return;
    asignarParada(trufi.id, paradaSeleccionada);
  }

  function handleConfirmarAccion() {
    if (!infraccionActiva || !accionId || !plazoValido) return;
    const accion = tipoActivo?.acciones.find((a) => a.id === accionId);
    aplicarAccion(infraccionActiva.id, accionId, modo, modo === 'plazo' ? venceEl : undefined);
    if (accion) {
      setConfirmacion(
        modo === 'plazo'
          ? `${accion.nombre} aplicada — vence el ${formatearFechaCorta(venceEl)}.`
          : `${accion.nombre} aplicada ahora.`,
      );
    }
    // Deja el formulario listo para una FUTURA infracción de este mismo trufi (el `useEffect`
    // de arriba ya no reacciona a esto — ver su comentario) sin tocar `confirmacion`.
    setAccionId('');
    setModo('ahora');
    setVenceEl('');
  }

  const whatsappHref = construirUrlWhatsApp(
    trufi.whatsapp,
    mensajeParaConductor(trufi, linea, infraccionActiva, tipoActivo),
  );

  return (
    <div className="qv-trufi-panel" role="dialog" aria-labelledby={titleId} aria-modal={false} ref={panelRef}>
      <div className="qv-trufi-panel__header">
        <img className="qv-trufi-panel__photo" src={trufi.fotoUrl} alt="" width={56} height={56} />
        <div className="qv-trufi-panel__identity">
          <div className="qv-trufi-panel__plate-row">
            <span className="qv-trufi-panel__plate" id={titleId} ref={headingRef} tabIndex={-1}>
              {trufi.placa}
            </span>
            <span className="qv-trufi-panel__linea-chip" style={{ background: linea.color, color: linea.color === '#ffffff' ? '#0f172a' : '#ffffff' }}>
              {linea.nombre}
            </span>
            <span className="qv-trufi-panel__meta">{trufi.numeroInterno}</span>
          </div>
          <span className="qv-trufi-panel__meta">
            <User size={12} aria-hidden="true" /> {trufi.conductorNombre}
          </span>
        </div>
        <button type="button" className="qv-trufi-panel__close" onClick={onClose} aria-label="Cerrar ficha del trufi">
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="qv-trufi-panel__scroll">
        <div className="qv-trufi-panel__section">
          <h3 className="qv-trufi-panel__section-title">Siguiente parada</h3>
          <div className="qv-trufi-panel__row">
            <Select
              aria-label="Siguiente parada"
              options={linea.paradas.map((p) => ({ label: p.nombre, value: p.id }))}
              placeholder="Elegir parada"
              value={paradaSeleccionada}
              onChange={(e) => setParadaSeleccionada(e.target.value)}
            />
            <Button size="sm" variant="secondary" onClick={handleAsignar} disabled={!paradaSeleccionada}>
              Asignar
            </Button>
          </div>
          {paradaAsignadaNombre && <span className="qv-trufi-panel__hint">Asignada: {paradaAsignadaNombre}</span>}
        </div>

        <div className="qv-trufi-panel__section">
          <h3 className="qv-trufi-panel__section-title">Infracción</h3>
          {infraccionActiva && tipoActivo ? (
            <>
              <div className="qv-trufi-panel__severidad-row">
                <span
                  className="qv-trufi-panel__severidad-chip"
                  style={{ background: SEVERIDAD_META[infraccionActiva.severidad].color }}
                >
                  {SEVERIDAD_META[infraccionActiva.severidad].etiqueta}
                </span>
                <span className="qv-trufi-panel__hora">
                  {new Date(infraccionActiva.ocurridaEn).toLocaleTimeString('es-BO')}
                </span>
              </div>
              <span className="qv-trufi-panel__infraccion-nombre">{tipoActivo.nombre}</span>

              <div className="qv-trufi-panel__acciones" role="radiogroup" aria-label="Acción a aplicar">
                {tipoActivo.acciones.map((accion) => (
                  <label
                    key={accion.id}
                    className={`qv-trufi-panel__accion ${accionId === accion.id ? 'qv-trufi-panel__accion--selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name={`accion-${infraccionActiva.id}`}
                      value={accion.id}
                      checked={accionId === accion.id}
                      onChange={() => setAccionId(accion.id)}
                    />
                    <span className="qv-trufi-panel__accion-texto">
                      <span className="qv-trufi-panel__accion-nombre">{accion.nombre}</span>
                      <span className="qv-trufi-panel__accion-descripcion">{accion.descripcion}</span>
                    </span>
                  </label>
                ))}
              </div>

              <div className="qv-trufi-panel__modo-toggle" role="group" aria-label="Modo de aplicación">
                <button
                  type="button"
                  className={`qv-trufi-panel__modo-btn ${modo === 'ahora' ? 'qv-trufi-panel__modo-btn--active' : ''}`}
                  onClick={() => setModo('ahora')}
                  aria-pressed={modo === 'ahora'}
                >
                  Aplicar ahora
                </button>
                <button
                  type="button"
                  className={`qv-trufi-panel__modo-btn ${modo === 'plazo' ? 'qv-trufi-panel__modo-btn--active' : ''}`}
                  onClick={() => setModo('plazo')}
                  aria-pressed={modo === 'plazo'}
                >
                  Con plazo
                </button>
              </div>

              {modo === 'plazo' && (
                <DatePicker
                  label="Vence el"
                  value={venceEl}
                  min={hoyISO()}
                  max={maxPlazoISO()}
                  onChange={(e) => setVenceEl(e.target.value)}
                  helperText={venceEl && !plazoValido ? `La fecha debe estar entre hoy y ${PLAZO_MAX_DIAS} días.` : undefined}
                />
              )}

              <Button
                size="sm"
                variant="primary"
                onClick={handleConfirmarAccion}
                disabled={!accionId || !plazoValido}
              >
                Confirmar
              </Button>
            </>
          ) : (
            <span className="qv-trufi-panel__hint">Sin infracciones activas.</span>
          )}

          {/* Fuera del ternario a propósito: `aplicarAccion` resuelve la infracción en la
              MISMA actualización que dispara esta confirmación, así que la sección de arriba
              ya cambió a la rama "Sin infracciones activas" para cuando esto se pinta — si el
              banner viviera dentro de la rama `infraccionActiva && tipoActivo`, desaparecería
              del árbol antes de que nadie (persona o lector de pantalla vía `aria-live`)
              llegara a verlo. */}
          <div aria-live="polite">
            {confirmacion && (
              <div className="qv-trufi-panel__confirmacion">
                <CheckCircle2 size={14} aria-hidden="true" />
                <span>{confirmacion}</span>
              </div>
            )}
          </div>
        </div>

        {historial.length > 0 && (
          <div className="qv-trufi-panel__section">
            <h3 className="qv-trufi-panel__section-title">Historial</h3>
            <div className="qv-trufi-panel__historial">
              {historial.map((inf) => {
                const tipo = catalogo.find((t) => t.id === inf.tipoId);
                const accion = tipo?.acciones.find((a) => a.id === inf.accionAplicada?.accionId);
                return (
                  <div key={inf.id} className="qv-trufi-panel__historial-item">
                    <strong>{tipo?.nombre ?? inf.tipoId}</strong>
                    <span>
                      {accion?.nombre ?? inf.accionAplicada?.accionId} ·{' '}
                      {inf.accionAplicada?.modo === 'plazo' && inf.accionAplicada.venceEl
                        ? `vence ${formatearFechaCorta(inf.accionAplicada.venceEl)}`
                        : 'aplicada ahora'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <a
          className="qv-trufi-panel__whatsapp"
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          <MessageCircle size={16} aria-hidden="true" />
          Contactar por WhatsApp
        </a>
      </div>
    </div>
  );
}
