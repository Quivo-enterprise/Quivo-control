import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';
import { colors, fontSize, fontStyle, space } from '@quivo/design-system-native';
import { SALUDOS } from '../saludos';

const DURACION_PALABRA = 2500;
const DURACION_TRANSICION = 600;
const c = colors.light;

/** Dos capas permanentes evitan saltos de layout al cambiar de idioma. */
export function SaludoIdiomas({ pausado }: { pausado: boolean }) {
  const [reducirMovimiento, setReducirMovimiento] = useState(true);
  const [indices, setIndices] = useState<[number, number]>([0, 1]);
  const activoRef = useRef<0 | 1>(0);
  const indiceRef = useRef(0);
  const opacidades = useRef<[Animated.Value, Animated.Value]>([
    new Animated.Value(1),
    new Animated.Value(0),
  ]).current;
  const entrada = useRef<[Animated.Value, Animated.Value]>([
    new Animated.Value(0),
    new Animated.Value(space.sm),
  ]).current;
  const escalas = useRef<[Animated.Value, Animated.Value]>([
    new Animated.Value(1),
    new Animated.Value(0.96),
  ]).current;
  const visible = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let vigente = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((valor) => {
      if (vigente) setReducirMovimiento(valor);
    });
    const suscripcion = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReducirMovimiento,
    );
    return () => {
      vigente = false;
      suscripcion.remove();
    };
  }, []);

  // Con el teclado abierto desaparece suavemente; el bloque flexible libera la zona de acción.
  useEffect(() => {
    const animacion = Animated.timing(visible, {
      toValue: pausado ? 0 : 1,
      duration: reducirMovimiento ? 0 : 150,
      useNativeDriver: true,
    });
    animacion.start();
    return () => animacion.stop();
  }, [pausado, reducirMovimiento, visible]);

  useEffect(() => {
    if (reducirMovimiento) {
      indiceRef.current = 0;
      activoRef.current = 0;
      setIndices([0, 1]);
      opacidades[0].setValue(1);
      opacidades[1].setValue(0);
      entrada[0].setValue(0);
      escalas[0].setValue(1);
      return;
    }
    if (pausado) return;

    let animacion: Animated.CompositeAnimation | null = null;
    let inicio: ReturnType<typeof setTimeout> | null = null;
    const intervalo = setInterval(() => {
      const anterior = activoRef.current;
      const siguiente: 0 | 1 = anterior === 0 ? 1 : 0;
      const indiceNuevo = (indiceRef.current + 1) % SALUDOS.length;
      setIndices((actuales) => {
        const copia: [number, number] = [...actuales];
        copia[siguiente] = indiceNuevo;
        return copia;
      });
      opacidades[siguiente].setValue(0);
      entrada[siguiente].setValue(space.sm);
      escalas[siguiente].setValue(0.96);
      // Espera un cuadro para que React pinte la palabra nueva antes del fundido cruzado.
      inicio = setTimeout(() => {
        animacion = Animated.parallel([
          Animated.timing(opacidades[anterior], {
            toValue: 0,
            duration: DURACION_TRANSICION,
            useNativeDriver: true,
          }),
          Animated.timing(opacidades[siguiente], {
            toValue: 1,
            duration: DURACION_TRANSICION,
            useNativeDriver: true,
          }),
          Animated.timing(entrada[siguiente], {
            toValue: 0,
            duration: DURACION_TRANSICION,
            useNativeDriver: true,
          }),
          Animated.timing(escalas[siguiente], {
            toValue: 1,
            duration: DURACION_TRANSICION,
            useNativeDriver: true,
          }),
        ]);
        animacion.start(({ finished }) => {
          if (finished) {
            activoRef.current = siguiente;
            indiceRef.current = indiceNuevo;
          }
        });
      }, 0);
    }, DURACION_PALABRA);
    return () => {
      clearInterval(intervalo);
      if (inicio) clearTimeout(inicio);
      animacion?.stop();
      const activo = activoRef.current;
      opacidades[activo].setValue(1);
      opacidades[activo === 0 ? 1 : 0].setValue(0);
    };
  }, [entrada, escalas, opacidades, pausado, reducirMovimiento]);

  return (
    <Animated.View
      accessible
      accessibilityLabel="Bienvenido"
      style={[styles.raiz, { opacity: visible }]}
    >
      {indices.map((indice, indiceCapa) => {
        const capa = indiceCapa as 0 | 1;
        return (
          <Animated.View
            key={capa}
            style={[
              styles.capa,
              {
                opacity: opacidades[capa],
                transform: [{ translateY: entrada[capa] }, { scale: escalas[capa] }],
              },
            ]}
          >
            <Animated.Text numberOfLines={1} adjustsFontSizeToFit style={styles.palabra}>
              {SALUDOS[indice]!.palabra}
            </Animated.Text>
            <Animated.Text style={styles.idioma}>{SALUDOS[indice]!.idioma}</Animated.Text>
          </Animated.View>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  raiz: { width: '100%', height: 96, justifyContent: 'center', alignItems: 'center' },
  capa: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
  palabra: { color: c.white, fontSize: 44, ...fontStyle('display', '700'), textAlign: 'center' },
  idioma: { color: c.white, opacity: 0.7, fontSize: fontSize.sm, ...fontStyle('body', '500') },
});
