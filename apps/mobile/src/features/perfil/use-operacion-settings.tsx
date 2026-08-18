import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface OperacionSettings {
  navegacionVoz: boolean;
  // Sonido de confirmación al registrar un punto de control (distinto de `navegacionVoz`: el
  // sonido da certeza de que quedó registrado, la voz informa la distancia). Preferencia propia,
  // mismo patrón que `navegacionVoz` — ver `gps-provider.tsx` y `confirmacion-sonido.ts`.
  sonidoConfirmacion: boolean;
  registroAutomatico: boolean;
  ahorroDatos: boolean;
  trabajarOffline: boolean;
  textoGrande: boolean;
}

const DEFAULT_SETTINGS: OperacionSettings = {
  navegacionVoz: true,
  sonidoConfirmacion: true,
  registroAutomatico: true,
  ahorroDatos: false,
  trabajarOffline: true,
  textoGrande: false,
};

const SETTINGS_KEY = '@quivo_operacion_settings';

interface SettingsContextValue {
  settings: OperacionSettings;
  isLoaded: boolean;
  updateSetting: <K extends keyof OperacionSettings>(key: K, value: OperacionSettings[K]) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<OperacionSettings>(DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);

  // Cargar estado inicial
  useEffect(() => {
    async function loadSettings() {
      try {
        const stored = await AsyncStorage.getItem(SETTINGS_KEY);
        if (stored) {
          setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(stored) });
        }
      } catch (e) {
        console.error('Error cargando ajustes:', e);
      } finally {
        setIsLoaded(true);
      }
    }
    loadSettings();
  }, []);

  // Función para actualizar y persistir de manera optimista
  const updateSetting = useCallback(async <K extends keyof OperacionSettings>(
    key: K,
    value: OperacionSettings[K]
  ) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next)).catch((e) => {
        console.error('Error guardando ajustes:', e);
      });
      return next;
    });
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, isLoaded, updateSetting }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useOperacionSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error('useOperacionSettings debe ser usado dentro de un SettingsProvider');
  }
  return ctx;
}

// Hook de conveniencia para aplicar "Texto grande" en componentes aislados sin ThemeProvider
export function useTextScale() {
  const { settings } = useOperacionSettings();
  return settings.textoGrande ? 1.2 : 1.0;
}
