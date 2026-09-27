import { Image, StyleSheet, View } from 'react-native';
import { esColorClaro } from './color-utils';

export interface DemoAvatarRedondoProps {
  /** Data URI de `FOTOS_TRUFI` — sin foto (raro, cobertura de las 8 unidades es completa) cae a
   * un placeholder gris liso. */
  fotoUri?: string;
  colorAnillo: string;
  tamano?: number;
}

/**
 * Foto redonda con anillo del color de línea — reusada por los indicadores adelante/atrás
 * (`indicadores-vecinos.tsx`), la tarjeta de identidad (`operation-screen.tsx`, `DriverRouteCard`)
 * y la lista de placas del modal "Reportar" (`reportar-modal.tsx`). Ver
 * `docs/plan-apk-demo-conductor.md`, paso B.
 *
 * Cuando `colorAnillo` es un color claro (Línea 120, `#ffffff`) suma un hairline oscuro por fuera
 * del anillo — pedido explícito del brief: un anillo blanco puro se pierde contra las glass cards
 * (blur claro) del top overlay sin ese borde extra.
 */
export function DemoAvatarRedondo({ fotoUri, colorAnillo, tamano = 36 }: DemoAvatarRedondoProps) {
  const claro = esColorClaro(colorAnillo);
  const tamanoAnillo = tamano + 6;

  return (
    <View
      style={[
        styles.anillo,
        claro && styles.anilloHairline,
        {
          width: tamanoAnillo,
          height: tamanoAnillo,
          borderRadius: tamanoAnillo / 2,
          backgroundColor: colorAnillo,
        },
      ]}
    >
      {fotoUri ? (
        <Image
          source={{ uri: fotoUri }}
          resizeMode="cover"
          style={{ width: tamano, height: tamano, borderRadius: tamano / 2 }}
        />
      ) : (
        <View style={[styles.placeholder, { width: tamano, height: tamano, borderRadius: tamano / 2 }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  anillo: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 3,
  },
  anilloHairline: {
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.24)',
  },
  placeholder: {
    backgroundColor: '#CBD5E1',
  },
});
