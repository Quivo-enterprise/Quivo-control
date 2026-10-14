import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../../shared/theme/quivo-theme';
import { useAvisoFoto } from './use-aviso-foto';
import { useVehiculoFoto } from './use-vehiculo-foto';

interface Props {
  sesionId: string;
  tracking: boolean;
  obtenerAccessToken: () => Promise<string | null>;
}

/**
 * Aviso discreto "sin foto" de la pantalla de operación. Solo antes de iniciar el recorrido
 * (`tracking` false), nunca bloquea, y se puede descartar por el resto del día (hora de Bolivia).
 */
export function AvisoFotoVehiculo({ sesionId, tracking, obtenerAccessToken }: Props) {
  const { foto, cargando, estado, mensaje, permisoDenegado, tomarFoto } = useVehiculoFoto({
    obtenerAccessToken,
    sesionId,
  });
  const { visible, descartar } = useAvisoFoto({ cargando, tieneFoto: foto !== null, tracking });
  const ocupado = estado === 'procesando' || estado === 'enviando';

  // Mientras se toma/envía/queda pendiente, el aviso se mantiene para mostrar el progreso.
  const enCurso = ocupado || estado === 'pendiente';
  if (!visible && !enCurso) return null;
  if (tracking || foto) return null;

  const texto =
    estado === 'procesando'
      ? 'Preparando la foto…'
      : estado === 'enviando'
        ? 'Enviando la foto…'
        : estado === 'pendiente'
          ? 'Se enviará al reconectar.'
          : permisoDenegado
            ? 'Activa el permiso de cámara para tomar la foto.'
            : estado === 'error' && mensaje
              ? mensaje
              : 'Tu vehículo no tiene foto';

  return (
    <View style={styles.fila}>
      <Ionicons name="camera-outline" size={16} color={quivoColors.accentStrong} />
      <Text style={styles.texto} numberOfLines={2}>
        {texto}
      </Text>
      {!enCurso ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={permisoDenegado ? 'Abrir ajustes' : 'Tomar foto'}
          hitSlop={8}
          style={styles.accion}
          onPress={() => (permisoDenegado ? void Linking.openSettings() : void tomarFoto())}
        >
          <Text style={styles.accionTexto}>{permisoDenegado ? 'Abrir ajustes' : 'Tomar foto'}</Text>
        </Pressable>
      ) : null}
      {!enCurso ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Descartar aviso de foto por hoy"
          hitSlop={10}
          onPress={descartar}
        >
          <Ionicons name="close" size={16} color={quivoColors.accentStrong} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: quivoSpacing.sm,
    backgroundColor: quivoColors.accentSoft,
    borderRadius: quivoRadius.md,
    paddingHorizontal: quivoSpacing.md,
    paddingVertical: quivoSpacing.sm,
  },
  texto: { flex: 1, color: quivoColors.accentStrong, fontFamily: quivoFonts.bodyMedium, fontSize: 11 },
  accion: { paddingVertical: quivoSpacing.xs },
  accionTexto: {
    color: quivoColors.accentStrong,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 11,
    textDecorationLine: 'underline',
  },
});
