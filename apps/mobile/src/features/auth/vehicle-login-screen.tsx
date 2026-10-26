import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Vibration,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { normalizarPlacaVehiculo } from '@quivo/shared';
import {
  Button,
  Heading,
  Text,
  colors,
  duration,
  fontSize,
  fontStyle,
  radius,
  space,
} from '@quivo/design-system-native';
import { Input } from '../../shared/components/Input';
import { Burbuja } from '../../shared/components/burbuja';
import { quivoBubble } from '../../shared/theme/quivo-theme';
import { FondoLogin } from './components/fondo-login';
import { SaludoIdiomas } from './components/saludo-idiomas';
import logoWhite from '../../../assets/images/logo-white.png';
import { vehicleLoginSchema } from './vehicle-login-schema';
import { agregarDigito, borrarDigito, cantidadPuntos, puedeEnviar } from './teclado-pin';
import { leerUltimaPlaca } from './ultima-placa';

interface VehicleLoginScreenProps {
  loading: boolean;
  error: string | null;
  onSubmit: (placa: string, pin: string) => Promise<void>;
}

type Vista = 'cargando' | 'placa' | 'pin';
const c = colors.light;
// Aire reservado para marca, cabecera, ayuda y márgenes en pantallas bajas.
const RESERVA_VERTICAL_LOGIN = 288;
const filasTeclado = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['borrar', '0', 'ingresar'],
] as const;

export function VehicleLoginScreen({
  loading: parentLoading,
  error,
  onSubmit,
}: VehicleLoginScreenProps) {
  const { width, height } = useWindowDimensions();
  const [altoDisponible, setAltoDisponible] = useState<number | null>(null);
  // La cuadrícula crece con el área segura medida sin quitar espacio al título ni al pie.
  const diametroTecla = Math.max(
    56,
    Math.min(
      88,
      Math.floor(((altoDisponible ?? height - 48) - RESERVA_VERTICAL_LOGIN) / 4),
      Math.floor((width - 2 * space.md - 2 * quivoBubble.padding - 2 * space.sm) / 3),
    ),
  );
  const anchoTeclado = 3 * diametroTecla + 2 * space.sm;
  const radioTeclado = diametroTecla / 2 + quivoBubble.padding;
  const [vista, setVista] = useState<Vista>('cargando');
  const [placaRecordada, setPlacaRecordada] = useState<string | null>(null);
  const [placa, setPlaca] = useState('');
  const [errorPlaca, setErrorPlaca] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [mostrarError, setMostrarError] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [tecladoAbierto, setTecladoAbierto] = useState(false);
  const temblor = useRef(new Animated.Value(0)).current;
  const loading = parentLoading || enviando;

  useEffect(() => {
    const abrir = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setTecladoAbierto(true),
    );
    const cerrar = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setTecladoAbierto(false),
    );
    return () => {
      abrir.remove();
      cerrar.remove();
    };
  }, []);

  // Esperar la lectura evita que aparezca un formulario vacío antes de la placa recordada.
  useEffect(() => {
    let vigente = true;
    void leerUltimaPlaca().then((guardada) => {
      if (!vigente) return;
      setPlacaRecordada(guardada);
      setPlaca(guardada ?? '');
      setVista(guardada ? 'pin' : 'placa');
    });
    return () => {
      vigente = false;
    };
  }, []);

  // Un rechazo limpia el PIN y comunica el error sin volver a enfocar el teclado del sistema.
  useEffect(() => {
    if (!error) return;
    setPin('');
    setMostrarError(true);
    Vibration.vibrate(40);
    Animated.sequence([
      Animated.timing(temblor, {
        toValue: -space.sm,
        duration: duration.fast / 2,
        useNativeDriver: true,
      }),
      Animated.timing(temblor, {
        toValue: space.sm,
        duration: duration.fast / 2,
        useNativeDriver: true,
      }),
      Animated.timing(temblor, {
        toValue: -space.xs,
        duration: duration.fast / 2,
        useNativeDriver: true,
      }),
      Animated.timing(temblor, { toValue: 0, duration: duration.fast / 2, useNativeDriver: true }),
    ]).start();
  }, [error, temblor]);

  const continuar = useCallback(() => {
    const normalizada = normalizarPlacaVehiculo(placa);
    const resultado = vehicleLoginSchema.shape.placa.safeParse(placa);
    if (!resultado.success) {
      setErrorPlaca(resultado.error.issues[0]?.message ?? 'Escribe una placa válida');
      return;
    }
    setPlaca(normalizada);
    setErrorPlaca(null);
    setPin('');
    setMostrarError(false);
    setVista('pin');
  }, [placa]);

  const tocarTecla = useCallback(
    (tecla: string) => {
      if (loading) return;
      Vibration.vibrate(10);
      if (tecla === 'borrar') {
        setPin(borrarDigito);
        return;
      }
      if (tecla === 'ingresar') {
        if (!puedeEnviar(pin)) return;
        setEnviando(true);
        void onSubmit(placa, pin).finally(() => setEnviando(false));
        return;
      }
      setMostrarError(false);
      setPin((actual) => agregarDigito(actual, tecla));
    },
    [loading, onSubmit, pin, placa],
  );

  const volverARecordada = () => {
    if (!placaRecordada) return;
    setPlaca(placaRecordada);
    setErrorPlaca(null);
    setPin('');
    setMostrarError(false);
    setVista('pin');
  };

  return (
    <View
      style={styles.screen}
      onLayout={(evento) => {
        const alto = Math.round(evento.nativeEvent.layout.height);
        setAltoDisponible((anterior) => (anterior === alto ? anterior : alto));
      }}
    >
      <FondoLogin variante="a" />
      {vista === 'cargando' ? null : vista === 'placa' ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'android' ? 'height' : 'padding'}
          style={styles.body}
        >
          {!tecladoAbierto ? (
            <View style={styles.logoContenedor}>
              <Image source={logoWhite} style={styles.logo} resizeMode="contain" />
            </View>
          ) : null}
          <View style={styles.protagonista}>
            <View pointerEvents="none" style={styles.saludoCapa}>
              <SaludoIdiomas pausado={tecladoAbierto} />
            </View>
            {tecladoAbierto ? (
              <View style={[styles.logoContenedor, styles.logoContenedorTeclado]}>
                <Image source={logoWhite} style={styles.logoTeclado} resizeMode="contain" />
              </View>
            ) : null}
          </View>
          <View style={styles.accionPlaca}>
            <Heading level="h1" size="xl" style={styles.titulo}>
              Conecta tu vehículo
            </Heading>
            <Burbuja direction="column" style={styles.burbujaPlaca}>
              <Input
                accessibilityLabel="Placa del vehículo"
                controlSize="lg"
                placeholder="Placa · 1234ABC"
                placeholderTextColor={c.textTertiary}
                error={errorPlaca ?? undefined}
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={continuar}
                maxLength={20}
                value={placa}
                onChangeText={(valor) => {
                  setPlaca(valor.toUpperCase());
                  setErrorPlaca(null);
                }}
                editable={!loading}
                inputShellStyle={styles.campoPlaca}
                style={styles.textoPlaca}
              />
              <Button
                variant="primary"
                size="lg"
                fullWidth
                disabled={loading}
                onPress={continuar}
                style={styles.botonContinuar}
              >
                Continuar
              </Button>
            </Burbuja>
            {placaRecordada ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Volver a ${placaRecordada}`}
                onPress={volverARecordada}
                style={styles.volver}
              >
                <Text size="sm" weight="semibold" style={styles.textoBlanco}>
                  Volver a {placaRecordada}
                </Text>
              </Pressable>
            ) : null}
          </View>
          <Text size="sm" style={styles.ayuda}>
            ¿No tienes tu PIN? Solicítalo a tu sindicato.
          </Text>
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.body}>
          <View style={styles.logoContenedor}>
            <Image source={logoWhite} style={styles.logo} resizeMode="contain" />
          </View>
          <View style={styles.protagonista}>
            <View style={styles.pinSuperior}>
              <Heading level="h1" size="2xl" style={styles.titulo}>
                Ingresa tu PIN
              </Heading>
              <View style={styles.placaPastilla}>
                <Ionicons name="car-outline" size={20} color={c.white} />
                <Text size="md" weight="semibold" style={styles.placaTexto}>
                  {placa}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cambiar placa"
                  disabled={loading}
                  onPress={() => setVista('placa')}
                  style={styles.cambiar}
                >
                  <Text size="sm" weight="semibold" style={styles.textoBlanco}>
                    Cambiar
                  </Text>
                </Pressable>
              </View>
              <Animated.View
                style={[styles.puntosYError, { transform: [{ translateX: temblor }] }]}
              >
                <View
                  accessible
                  accessibilityLiveRegion="polite"
                  accessibilityLabel={`PIN, ${pin.length} dígitos escritos`}
                  style={styles.puntos}
                >
                  {Array.from({ length: cantidadPuntos(pin) }, (_, indice) => (
                    <View
                      key={indice}
                      style={[
                        styles.punto,
                        indice < pin.length ? styles.puntoLleno : styles.puntoVacio,
                        mostrarError && error ? styles.puntoError : null,
                      ]}
                    />
                  ))}
                </View>
                {mostrarError && error ? (
                  <Text size="sm" accessibilityRole="alert" style={styles.error}>
                    {error}
                  </Text>
                ) : null}
              </Animated.View>
            </View>
          </View>
          <View style={styles.pinInferior}>
            <View
              style={[
                styles.tecladoGrupo,
                { width: anchoTeclado + 2 * quivoBubble.padding, borderRadius: radioTeclado },
              ]}
            >
              <View pointerEvents="none" style={styles.tecladoSuperficie} />
              <View style={[styles.teclado, { width: anchoTeclado }]}>
                {filasTeclado.map((fila, indice) => (
                  <View key={indice} style={[styles.filaTeclado, { width: anchoTeclado }]}>
                    {fila.map((tecla) => {
                      const deshabilitada = loading || (tecla === 'ingresar' && !puedeEnviar(pin));
                      const etiqueta =
                        tecla === 'borrar' ? 'Borrar' : tecla === 'ingresar' ? 'Ingresar' : tecla;
                      return (
                        <Pressable
                          key={tecla}
                          accessibilityRole="button"
                          accessibilityLabel={etiqueta}
                          accessibilityState={{ disabled: deshabilitada }}
                          disabled={deshabilitada}
                          onPress={() => tocarTecla(tecla)}
                          onLongPress={
                            tecla === 'borrar'
                              ? () => {
                                  Vibration.vibrate(10);
                                  setPin('');
                                  setMostrarError(false);
                                }
                              : undefined
                          }
                          style={[
                            styles.tecla,
                            {
                              width: diametroTecla,
                              height: diametroTecla,
                              borderRadius: diametroTecla / 2,
                            },
                          ]}
                        >
                          {({ pressed }) => (
                            <>
                              <View
                                style={[
                                  styles.fondoTecla,
                                  {
                                    opacity: pressed ? 0.28 : 0.16,
                                  },
                                ]}
                              />
                              <View
                                style={[
                                  styles.contenidoTecla,
                                  deshabilitada && styles.teclaDeshabilitada,
                                ]}
                              >
                                {tecla === 'ingresar' && loading ? (
                                  <ActivityIndicator color={c.white} />
                                ) : tecla === 'borrar' ? (
                                  <Ionicons
                                    name="backspace-outline"
                                    size={fontSize['2xl']}
                                    color={c.white}
                                  />
                                ) : tecla === 'ingresar' ? (
                                  <Ionicons
                                    name="checkmark"
                                    size={fontSize['3xl']}
                                    color={c.white}
                                  />
                                ) : (
                                  <Text size="xl" weight="bold" style={styles.digito}>
                                    {tecla}
                                  </Text>
                                )}
                              </View>
                            </>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </View>
            </View>
          </View>
          <Text size="sm" style={styles.ayuda}>
            ¿No tienes tu PIN? Solicítalo a tu sindicato.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.primary },
  body: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.sm,
  },
  logoContenedor: { alignSelf: 'flex-start', padding: space.sm, borderRadius: radius.md },
  logoContenedorTeclado: { alignSelf: 'center' },
  logo: { width: 96, height: 38 },
  logoTeclado: { width: 128, height: 52 },
  protagonista: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  saludoCapa: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  titulo: { color: c.white, textAlign: 'center' },
  accionPlaca: { width: '100%', maxWidth: 360, alignItems: 'center', gap: space.sm },
  burbujaPlaca: { width: '100%', alignItems: 'stretch' },
  campoPlaca: {
    height: 52,
    backgroundColor: c.surfaceSoft,
    borderColor: c.borderSubtle,
    borderRadius: quivoBubble.innerRadius,
  },
  textoPlaca: {
    color: c.textPrimary,
    fontSize: fontSize.xl,
    letterSpacing: 1,
    ...fontStyle('display', '600'),
  },
  botonContinuar: { height: 52, borderRadius: quivoBubble.innerRadius },
  volver: { minHeight: quivoBubble.touch, alignItems: 'center', justifyContent: 'center' },
  textoBlanco: { color: c.white },
  pinSuperior: { alignItems: 'center', gap: space.sm, width: '100%' },
  placaPastilla: {
    minHeight: quivoBubble.touch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: space.md,
    paddingRight: space.xs,
    borderRadius: quivoBubble.innerRadius,
    borderWidth: 1,
    borderColor: c.white,
  },
  placaTexto: {
    color: c.white,
    fontSize: fontSize.xl,
    letterSpacing: 1,
    ...fontStyle('display', '600'),
  },
  cambiar: { minHeight: quivoBubble.touch, justifyContent: 'center', paddingHorizontal: space.ms },
  puntosYError: {
    minHeight: quivoBubble.touch,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
  puntos: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  punto: { width: space.ms, height: space.ms, borderRadius: radius.full },
  puntoLleno: { backgroundColor: c.white },
  puntoVacio: { backgroundColor: c.white, opacity: 0.4 },
  puntoError: { backgroundColor: c.danger, opacity: 1 },
  error: { color: c.white, textAlign: 'center', maxWidth: 320 },
  pinInferior: { alignItems: 'center', gap: space.xs, width: '100%' },
  tecladoGrupo: {
    padding: quivoBubble.padding,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  tecladoSuperficie: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: c.white,
    opacity: 0.08,
  },
  teclado: { gap: space.sm, alignItems: 'center' },
  filaTeclado: { flexDirection: 'row', gap: space.sm },
  tecla: { overflow: 'hidden' },
  fondoTecla: { ...StyleSheet.absoluteFillObject, backgroundColor: c.white },
  contenidoTecla: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  teclaDeshabilitada: { opacity: 0.4 },
  digito: { color: c.white, fontSize: fontSize['2xl'], ...fontStyle('display', '700') },
  ayuda: { color: c.white, textAlign: 'center', marginTop: space.sm },
});
