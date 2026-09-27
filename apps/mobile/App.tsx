import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_600SemiBold,
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
import { OperationNavigator } from './src/app/operation-navigator';
import { SplashScreen } from './src/features/auth/splash-screen';
import { quivoColors, quivoFonts, quivoSpacing } from './src/shared/theme/quivo-theme';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MODO_DEMO } from './src/demo/flag';
import { DemoProvider } from './src/demo/demo-provider';
import { trufiIdDesdeContexto } from './src/demo/cuentas';
import { useAuthMovilDemo } from './src/demo/use-auth-movil-demo';

const queryClient = new QueryClient();

// docs/plan-apk-demo-conductor.md (paso A): la elección de implementación pasa a nivel de
// MÓDULO (no dentro del componente) — `MODO_DEMO` es una constante de build (lee
// `EXPO_PUBLIC_MOCK_DEMO` una sola vez, ver `src/demo/flag.ts`), así que esto es seguro aunque
// los hooks no puedan llamarse condicionalmente: sin el flag, esta línea siempre resuelve al
// hook real y el camino de código es byte a byte el mismo de siempre.
const useAuth = MODO_DEMO ? useAuthMovilDemo : useAuthMovil;

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
  });
  const [oxaniumLoaded, oxaniumError] = useOxanium({
    Oxanium_400Regular,
    Oxanium_600SemiBold,
    Oxanium_700Bold,
  });
  const [monoLoaded, monoError] = useJetBrainsMono({ JetBrainsMono_400Regular });

  const auth = useAuth();
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
    return <LoadingScreen label="No se pudieron cargar los recursos visuales de QUIVO." error />;
  }

  const contenido = (() => {
    if (auth.estado.etapa === 'restaurando')
      return <View style={styles.page} />; // Queda tapado por el SplashScreen mientras se restaura la sesión
    if (auth.estado.etapa === 'vehiculo') {
      return (
        <VehicleLoginScreen
          loading={auth.estado.cargando}
          error={auth.estado.error}
          onSubmit={auth.autenticarSesion}
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
      const navigator = (
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
      // El motor demo (`src/demo/motor.ts`) necesita saber qué unidad es la propia para
      // arrancar su estado — se deriva de la placa del `contexto` ya logueado (`useAuthMovilDemo`
      // solo construye `contexto` a partir de una `CuentaDemo` real, así que siempre matchea).
      // Sin el flag, este `MODO_DEMO ? ... : navigator` siempre toma la segunda rama: el árbol
      // renderizado es exactamente `navigator`, sin ningún componente demo de por medio.
      return MODO_DEMO ? (
        <DemoProvider trufiPropioId={trufiIdDesdeContexto(contexto)}>{navigator}</DemoProvider>
      ) : (
        navigator
      );
    }
    return <LoadingScreen label="Preparando tu contexto operativo…" />;
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

function LoadingScreen({ label, error = false }: { label: string; error?: boolean }) {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.loading}>
      <StatusBar style="light" backgroundColor={quivoColors.primaryStrong} />
      {!error ? <ActivityIndicator size="large" color={quivoColors.accent} /> : null}
      <Text style={styles.loadingBrand}>QUIVO</Text>
      <Text style={[styles.loadingText, error ? styles.loadingError : null]}>{label}</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F4F6F8' },
  page: { flex: 1, backgroundColor: quivoColors.page },
  loading: {
    flex: 1,
    backgroundColor: quivoColors.primaryStrong,
    alignItems: 'center',
    justifyContent: 'center',
    gap: quivoSpacing.md,
    padding: quivoSpacing.xl,
  },
  loadingBrand: {
    color: quivoColors.white,
    fontFamily: quivoFonts.displayBold,
    fontSize: 30,
    letterSpacing: 2,
  },
  loadingText: {
    color: quivoColors.primarySoft,
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 13,
    textAlign: 'center',
  },
  loadingError: { color: quivoColors.accentSoft },
});
