import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Vibration } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Heading } from '@quivo/design-system-native';
import { Burbuja } from '../../shared/components/burbuja';
import { dsColors, dsDuration, dsEasing } from '../../shared/theme/design-system';
import { quivoBubble } from '../../shared/theme/quivo-theme';
import type { DeteccionPuntoControl } from '../../gps/geofence';
import { debeMostrarToast, type IdentidadToastMostrado } from './control-feedback-toast.logic';

interface ControlFeedbackToastProps {
  ultimaDeteccion: DeteccionPuntoControl | null;
  /** Borde inferior real de la barra más el gap del slot de avisos. */
  top: number;
  /** Número del PC en el orden efectivo de la vuelta; `undefined` = sin número (como la voz). */
  numeroDePuntoControl: (puntoControlId: string) => number | undefined;
}

export function ControlFeedbackToast({
  ultimaDeteccion,
  top,
  numeroDePuntoControl,
}: ControlFeedbackToastProps) {
  const [queue, setQueue] = useState<DeteccionPuntoControl[]>([]);
  const [current, setCurrent] = useState<DeteccionPuntoControl | null>(null);
  const opacidad = useRef(new Animated.Value(0)).current;
  // ENTREGA 9 (plan post-piloto 2026-09-09, "deduplicar el toast de confirmación", síntoma 11):
  // comparación por identidad análoga a `ultimoSonado` (`gps-provider.tsx`) — identidad de la
  // última detección ya encolada, para no pushear de nuevo solo porque cambió la REFERENCIA de
  // `ultimaDeteccion` (re-render) sin que cambiara el `{puntoControlId, pasada}` real. Ver
  // `debeMostrarToast`. NO es el mismo ref: éste vive en este componente (se pierde al
  // desmontar) y dedupea `ultimaDeteccion` (evidencia, `pasada` opcional), no
  // `ultimoAnuncioLlegada` (decisión ya tomada, `pasada` siempre presente).
  const ultimoMostrado = useRef<IdentidadToastMostrado | null>(null);

  useEffect(() => {
    // FIX (revisión, hallazgo 1): `ultimaDeteccion` vuelve a `null` al arrancar un recorrido
    // nuevo (`ejecutarIniciar`, `use-gps-operativo.ts`) — sin este reset, la identidad de la
    // última confirmación del recorrido ANTERIOR sobrevive, y como `pasada` arranca de nuevo en
    // 1 por sesión (`claveCumplimiento` es `${sesionId}:${puntoControlId}`, `geofence.ts`), la
    // primera confirmación de la sesión nueva en el MISMO punto de control (recorridos que
    // empiezan/terminan en el mismo punto) quedaría deduplicada por error.
    if (!ultimaDeteccion) {
      ultimoMostrado.current = null;
      return;
    }
    if (!debeMostrarToast(ultimoMostrado.current, ultimaDeteccion)) return;
    const detectada = ultimaDeteccion; // `debeMostrarToast` ya validó `cumplido`.
    // Solo se actualiza la identidad cuando `pasada` viene definida (el caso normal, ver el
    // docblock de `debeMostrarToast`) — si faltara, no hay identidad estable que recordar y el
    // toast queda en modo fail-open (siempre se muestra), igual que antes de esta entrega.
    if (detectada.pasada !== undefined) {
      ultimoMostrado.current = {
        puntoControlId: detectada.puntoControlId,
        pasada: detectada.pasada,
      };
    }
    setQueue((prev) => [...prev, detectada]);
  }, [ultimaDeteccion]);

  useEffect(() => {
    if (current || queue.length === 0) return;
    setCurrent(queue[0]!);
    setQueue((prev) => prev.slice(1));
  }, [queue, current]);

  useEffect(() => {
    if (!current) return;
    Vibration.vibrate(100);
    opacidad.setValue(0);
    const animacion = Animated.sequence([
      Animated.timing(opacidad, {
        toValue: 1,
        duration: dsDuration.base,
        easing: dsEasing.easeOut,
        useNativeDriver: true,
      }),
      Animated.delay(2500),
      Animated.timing(opacidad, {
        toValue: 0,
        duration: dsDuration.base,
        easing: dsEasing.easeIn,
        useNativeDriver: true,
      }),
    ]);
    animacion.start(({ finished }) => {
      if (finished) setCurrent(null);
    });
    return () => animacion.stop();
  }, [current, opacidad]);

  if (!current) return null;
  const numero = numeroDePuntoControl(current.puntoControlId);
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.contenedor, { top, opacity: opacidad }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Control registrado automáticamente. Punto de control. Hora: ${new Date().toLocaleTimeString('es-BO')}`}
    >
      <Burbuja style={styles.burbuja}>
        <Ionicons name="checkmark-circle" size={24} color={dsColors.success} />
        <Heading size="md" style={styles.texto}>
          {numero === undefined ? 'Punto registrado' : `Punto ${numero} registrado`}
        </Heading>
      </Burbuja>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  contenedor: {
    position: 'absolute',
    left: quivoBubble.edge,
    right: quivoBubble.edge,
    alignItems: 'center',
    zIndex: 1500,
  },
  // Ocupa todo el ancho del slot para tapar el aviso inferior mientras confirma el control.
  burbuja: { width: '100%', minHeight: quivoBubble.touch + 2 * quivoBubble.padding },
  texto: { color: dsColors.textPrimary, flexShrink: 1 },
});
