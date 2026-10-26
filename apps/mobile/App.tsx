import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_600SemiBold,
  Montserrat_700Bold,
  useFonts as useMontserrat,
} from '@expo-google-fonts/montserrat';
import {
  Oxanium_400Regular,
  Oxanium_600SemiBold,
  Oxanium_700Bold,
  useFonts as useOxanium,
} from '@expo-google-fonts/oxanium';
import {
  JetBrainsMono_400Regular,
  useFonts as useJetBrainsMono,
} from '@expo-google-fonts/jetbrains-mono';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AssignmentSelectionScreen } from './src/features/auth/assignment-selection-screen';
import { contextoDe, useAuthMovil } from './src/features/auth/use-auth-movil';
import { VehicleLoginScreen } from './src/features/auth/vehicle-login-screen';
import { guardarUltimaPlaca } from './src/features/auth/ultima-placa';
import { OperationNavigator } from './src/app/operation-navigator';
import { SplashScreen } from './src/features/auth/splash-screen';
import { quivoColors } from './src/shared/theme/quivo-theme';
import { useCallback, useEffect, useRef, useState } from 'react';
import { limpiarCanalesObsoletos } from './src/features/operacion/anuncio-punto-control';
import { useActualizacionesAutomaticas } from './src/features/actualizaciones/use-actualizaciones-automaticas';
import { esPantallaPreOperacion } from './src/features/actualizaciones/actualizaciones-core';
import { PantallaCarga } from './src/features/auth/components/pantalla-carga';

const queryClient = new QueryClient();

// Una vez al arrancar la app (solo Android, fire-and-forget): borra el canal de notificaciones
// obsoleto de los anuncios de punto de control.
limpiarCanalesObsoletos();

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <QuivoApp />
        </NavigationContainer>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function QuivoApp() {
  const [montserratLoaded, montserratError] = useMontserrat({
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
    // `@quivo/design-system-native` pide la familia por nombre corto (`fontFamily.body`/`display`):
    // sin estos alias, `Text`/`Heading`/`Button` caen a la fuente del sistema.
    Montserrat: Montserrat_500Medium,
  });
  const [oxaniumLoaded, oxaniumError] = useOxanium({
    Oxanium_400Regular,
    Oxanium_600SemiBold,
    Oxanium_700Bold,
    Oxanium: Oxanium_600SemiBold,
  });
  const [monoLoaded, monoError] = useJetBrainsMono({ JetBrainsMono_400Regular });

  const auth = useAuthMovil();
  const placaEnviadaRef = useRef<string | null>(null);
  const enviarLogin = useCallback(
    (placa: string, pin: string) => {
      placaEnviadaRef.current = placa;
      return auth.autenticarSesion(placa, pin);
    },
    [auth.autenticarSesion],
  );

  // Solo un login que avance de etapa recuerda la placa; restaurar sesión no escribe nada.
  useEffect(() => {
    if (auth.estado.etapa !== 'asignacion' && auth.estado.etapa !== 'operacion') return;
    const placa = placaEnviadaRef.current;
    if (!placa) return;
    placaEnviadaRef.current = null;
    void guardarUltimaPlaca(placa);
  }, [auth.estado.etapa]);
  // OTA: aplica una actualización ya descargada solo en login/selección de asignación (nunca con
  // un recorrido activo). Ver `use-actualizaciones-automaticas.ts`.
  useActualizacionesAutomaticas(esPantallaPreOperacion(auth.estado.etapa, auth.estado.cargando));
  const fontsLoaded = montserratLoaded && oxaniumLoaded && monoLoaded;
  const fontError = montserratError ?? oxaniumError ?? monoError;

  const [splashReady, setSplashReady] = useState(false);

  // Referencia siempre al día con la etapa actual: esperarRestauracion() puede
  // consultarla en un momento posterior al render donde se definió su closure.
  const etapaActualRef = useRef(auth.estado.etapa);
  etapaActualRef.current = auth.estado.etapa;

  // Guarda el resolve de la promesa que el splash está esperando mientras
  // la restauración de sesión sigue en curso.
  const resolverEsperaRestauracionRef = useRef<() => void>(() => {});

  // Sin cleanup a propósito: React corre el cleanup de un efecto ANTES del body del
  // siguiente render cuando cambia una dependencia (acá, `auth.estado.etapa`) — no sólo al
  // desmontar. Con un `return () => { ref.current = noop }` acá, la única transición que
  // importa ('restaurando' → 'vehiculo'/'operacion') pisaba el ref con un no-op y RECIÉN
  // DESPUÉS el body llamaba a ese no-op: `esperarRestauracion()` nunca resolvía y el splash
  // caía siempre por el timeout de 5s de `checkConnectionAndData`, mostrando "Error de
  // conexión" en un arranque perfectamente sano. Resolver una promesa después de que el
  // componente se desmontó es inofensivo (no dispara ningún `setState`), así que no hace
  // falta limpiar nada al desmontar: total, `resolverEsperaRestauracionRef` deja de usarse
  // solo.
  useEffect(() => {
    if (auth.estado.etapa !== 'restaurando') {
      resolverEsperaRestauracionRef.current();
      resolverEsperaRestauracionRef.current = () => {};
    }
  }, [auth.estado.etapa]);

  // El propio SplashScreen ya garantiza una duración mínima de animación;
  // acá solo resolvemos cuando la restauración de sesión realmente terminó.
  const esperarRestauracion = useCallback(() => {
    if (etapaActualRef.current !== 'restaurando') return Promise.resolve();
    return new Promise<void>((resolve) => {
      resolverEsperaRestauracionRef.current = resolve;
    });
  }, []);

  if (!fontsLoaded && !fontError) {
    // Fondo sólido mientras cargan las fuentes: evita un parpadeo antes de mostrar el splash
    return <View style={{ flex: 1, backgroundColor: '#0F1B5C' }} />;
  }
  if (fontError) {
    console.error('Font load error:', fontError);
    return <PantallaCarga label="No se pudieron cargar los recursos visuales de QUIVO." error />;
  }

  const contenido = (() => {
    if (auth.estado.etapa === 'restaurando') return <View style={styles.page} />; // Queda tapado por el SplashScreen mientras se restaura la sesión
    if (auth.estado.etapa === 'vehiculo') {
      return (
        <VehicleLoginScreen
          loading={auth.estado.cargando}
          error={auth.estado.error}
          onSubmit={enviarLogin}
        />
      );
    }
    if (auth.estado.etapa === 'asignacion') {
      return (
        <AssignmentSelectionScreen
          asignaciones={auth.estado.asignaciones}
          loading={auth.estado.cargando}
          error={auth.estado.error}
          onSelect={auth.seleccionarAsignacion}
          onBack={auth.volverAVehiculo}
        />
      );
    }

    const contexto = contextoDe(auth.estado);
    if (auth.estado.etapa === 'operacion' && contexto && auth.estado.deviceId) {
      return (
        <OperationNavigator
          contexto={contexto}
          deviceId={auth.estado.deviceId}
          aviso={auth.estado.aviso}
          sesionNoRevalidada={auth.estado.sesionNoRevalidada}
          sesionNoVigente={auth.estado.sesionNoVigente}
          loading={auth.estado.cargando}
          obtenerAccessToken={auth.obtenerAccessToken}
          onLogout={auth.logout}
          onSesionNoVigenteFinalizada={auth.finalizarTrasSesionNoVigente}
        />
      );
    }
    return <PantallaCarga label="Preparando tu ruta…" />;
  })();

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <StatusBar
        style={auth.estado.etapa === 'operacion' ? 'dark' : 'light'}
        backgroundColor="transparent"
        translucent
      />
      <View style={styles.page}>{contenido}</View>
      {!splashReady && (
        <SplashScreen onLoadData={esperarRestauracion} onReady={() => setSplashReady(true)} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F4F6F8' },
  page: { flex: 1, backgroundColor: quivoColors.page },
});
