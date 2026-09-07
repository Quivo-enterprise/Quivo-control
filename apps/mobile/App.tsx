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
import { useState } from 'react';

const queryClient = new QueryClient();

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

  const auth = useAuthMovil();
  const fontsLoaded = montserratLoaded && oxaniumLoaded && monoLoaded;
  const fontError = montserratError ?? oxaniumError ?? monoError;

  const [splashReady, setSplashReady] = useState(false);

  if (!fontsLoaded && !fontError) {
    // Show nothing or a solid color until fonts load to avoid flicker before splash
    return <View style={{ flex: 1, backgroundColor: '#0F1B5C' }} />;
  }
  if (fontError) {
    console.error('Font load error:', fontError);
    return <LoadingScreen label="No se pudieron cargar los recursos visuales de QUIVO." error />;
  }

  const contenido = (() => {
    if (auth.estado.etapa === 'restaurando')
      return <View style={styles.page} />; // Will be covered by SplashScreen
    if (auth.estado.etapa === 'vehiculo') {
      return (
        <VehicleLoginScreen
          loading={auth.estado.cargando}
          error={auth.estado.error}
          onSubmit={auth.autenticarVehiculo}
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
          loading={auth.estado.cargando}
          obtenerAccessToken={auth.obtenerAccessToken}
          onLogout={auth.logout}
        />
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
        <SplashScreen
          onLoadData={async () => {
            // Give auth hook time to finish restoring if it hasn't already
            // We just wait a minimum time for the animation to look nice (e.g., 2 seconds)
            await new Promise(r => setTimeout(r, 2000));
          }}
          onReady={() => setSplashReady(true)}
        />
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
