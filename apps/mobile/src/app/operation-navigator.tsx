import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ContextoOperativoMovil } from '@quivo/shared';
import { OperationScreen } from '../features/operacion/operation-screen';
import { PerfilScreen } from '../features/perfil/perfil-screen';
import { AjustesScreen } from '../features/perfil/ajustes-screen';
import { GpsProvider } from '../features/operacion/gps-provider';
import { SettingsProvider } from '../features/perfil/use-operacion-settings';
import { MODO_DEMO } from '../demo/flag';
import { HojaDeRutaScreen } from '../demo/pantallas/hoja-de-ruta-screen';

export type OperationStackParamList = {
  Map: undefined;
  Perfil: undefined;
  Ajustes: undefined;
  // docs/plan-apk-demo-conductor.md (paso C, E06 02:45): pantalla nueva, demo-only. Se declara
  // en el param list SIEMPRE (tipado simple, sin condicionales de tipos) pero la ruta solo se
  // REGISTRA con `MODO_DEMO` (ver abajo) — sin el flag, nada la puede alcanzar (el único punto
  // de entrada es el ítem de navegación de `perfil-screen.tsx`, también gateado por el flag) y
  // `navigation.navigate('HojaDeRuta')` seguiría tipando bien pero no tendría ruta que resolver.
  HojaDeRuta: undefined;
};

const Stack = createNativeStackNavigator<OperationStackParamList>();

interface OperationNavigatorProps {
  contexto: ContextoOperativoMovil;
  deviceId: string;
  aviso: string | null;
  sesionNoRevalidada: boolean;
  sesionNoVigente: boolean;
  loading: boolean;
  obtenerAccessToken: () => Promise<string | null>;
  onLogout: () => Promise<void>;
  onSesionNoVigenteFinalizada: () => Promise<void>;
}

export function OperationNavigator(props: OperationNavigatorProps) {
  return (
    <SettingsProvider>
      <GpsProvider
      sesionId={props.contexto.sesionId}
      deviceId={props.deviceId}
      obtenerAccessToken={props.obtenerAccessToken}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Map">
          {(screenProps) => (
            <OperationScreen
              {...screenProps}
              contexto={props.contexto}
              deviceId={props.deviceId}
              aviso={props.aviso}
              sesionNoRevalidada={props.sesionNoRevalidada}
              sesionNoVigente={props.sesionNoVigente}
              loading={props.loading}
              obtenerAccessToken={props.obtenerAccessToken}
              onLogout={props.onLogout}
              onSesionNoVigenteFinalizada={props.onSesionNoVigenteFinalizada}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Perfil">
          {(screenProps) => (
            <PerfilScreen
              {...screenProps}
              contexto={props.contexto}
              obtenerAccessToken={props.obtenerAccessToken}
              onLogout={props.onLogout}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Ajustes">
          {(screenProps) => <AjustesScreen {...screenProps} contexto={props.contexto} />}
        </Stack.Screen>
        {MODO_DEMO && (
          <Stack.Screen name="HojaDeRuta">
            {(screenProps) => <HojaDeRutaScreen {...screenProps} contexto={props.contexto} />}
          </Stack.Screen>
        )}
      </Stack.Navigator>
    </GpsProvider>
    </SettingsProvider>
  );
}
