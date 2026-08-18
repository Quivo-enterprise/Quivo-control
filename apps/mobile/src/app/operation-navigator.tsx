import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ContextoOperativoMovil } from '@quivo/shared';
import { OperationScreen } from '../features/operacion/operation-screen';
import { PerfilScreen } from '../features/perfil/perfil-screen';
import { AjustesScreen } from '../features/perfil/ajustes-screen';
import { GpsProvider } from '../features/operacion/gps-provider';
import { SettingsProvider } from '../features/perfil/use-operacion-settings';

export type OperationStackParamList = {
  Map: undefined;
  Perfil: undefined;
  Ajustes: undefined;
};

const Stack = createNativeStackNavigator<OperationStackParamList>();

interface OperationNavigatorProps {
  contexto: ContextoOperativoMovil;
  deviceId: string;
  aviso: string | null;
  loading: boolean;
  obtenerAccessToken: () => Promise<string | null>;
  onLogout: () => Promise<void>;
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
              loading={props.loading}
              obtenerAccessToken={props.obtenerAccessToken}
              onLogout={props.onLogout}
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
      </Stack.Navigator>
    </GpsProvider>
    </SettingsProvider>
  );
}
