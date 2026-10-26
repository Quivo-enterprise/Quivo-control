import { StyleSheet, View } from 'react-native';
import { Heading } from '@quivo/design-system-native';
import { dsColors, dsRadius, dsSpace } from '../theme/design-system';

/** La chapa se reutiliza sobre fotos sin perder la lectura de la placa. */
export function PlacaChapa({
  placa,
  scale,
  textoGrande,
}: {
  placa: string;
  scale: number;
  textoGrande: boolean;
}) {
  return (
    <View style={styles.chapa}>
      <Heading
        style={[styles.texto, { fontSize: 22 * scale }]}
        allowFontScaling={!textoGrande}
        numberOfLines={1}
      >
        {placa}
      </Heading>
    </View>
  );
}

const styles = StyleSheet.create({
  chapa: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingHorizontal: dsSpace.md,
    paddingVertical: dsSpace.xs,
    borderRadius: dsRadius.full,
    backgroundColor: dsColors.surfaceRaised,
    borderWidth: 1,
    borderColor: dsColors.borderStrong,
  },
  texto: { letterSpacing: 2, color: dsColors.textPrimary },
});
