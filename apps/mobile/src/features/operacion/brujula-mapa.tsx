import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { quivoColors } from '../../shared/theme/quivo-theme';
import type { EmisorRumbo } from '../mapa/rumbo-mapa';

const COLOR_NORTE = quivoColors.danger;
const COLOR_SUR = '#3127B1';

/**
 * Brújula propia del mapa (reemplaza la nativa de Google, apagada con `showsCompass={false}`): una
 * aguja con la punta norte roja que gira `-rumbo` para seguir apuntando al norte real. Se suscribe
 * al `emisorRumbo` y mueve un `Animated.Value` directamente, así que el rumbo (que llega a ~30 Hz en
 * navegación) NO re-renderiza ni este componente ni la pantalla. Lo que hace el toque lo decide la
 * pantalla (solo se muestra en navegación: alterna norte/rumbo). `norteFijo` marca con un aro
 * que la cámara está bloqueada con el norte arriba.
 */
export function BrujulaMapa({
  emisor,
  onPress,
  norteFijo,
  accessibilityLabel,
  style,
}: {
  emisor: EmisorRumbo;
  onPress: () => void;
  norteFijo: boolean;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}) {
  const giro = useRef(new Animated.Value(-emisor.actual())).current;

  useEffect(() => {
    giro.setValue(-emisor.actual());
    return emisor.suscribir((grados) => giro.setValue(-grados));
  }, [emisor, giro]);

  const rotate = giro.interpolate({ inputRange: [-360, 360], outputRange: ['-360deg', '360deg'] });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: norteFijo }}
      style={[style, norteFijo && styles.norteFijo]}
      onPress={onPress}
    >
      <Animated.View style={{ transform: [{ rotate }] }}>
        <Svg width={26} height={26} viewBox="0 0 24 24">
          <Path d="M12 2.5 17 12H7Z" fill={COLOR_NORTE} />
          <Path d="M12 21.5 7 12h10Z" fill={COLOR_SUR} fillOpacity={0.85} />
        </Svg>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  norteFijo: { borderColor: COLOR_SUR, borderWidth: 2 },
});
