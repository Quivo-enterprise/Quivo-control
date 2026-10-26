import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@quivo/design-system-native';
import { Burbuja } from '../../shared/components/burbuja';
import { dsColors, dsSpace } from '../../shared/theme/design-system';
import { quivoBubble } from '../../shared/theme/quivo-theme';
import { Ionicons } from '@expo/vector-icons';
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
  const { foto, estadoFoto, estado, mensaje, permisoDenegado, requiereAjustes, tomarFoto } =
    useVehiculoFoto({
      obtenerAccessToken,
      sesionId,
    });
  const { visible, descartar } = useAvisoFoto({ estadoFoto, tracking });
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
            ? requiereAjustes
              ? 'Activa el permiso de cámara para tomar la foto.'
              : 'Necesitamos el permiso de cámara para tomar la foto.'
            : estado === 'error' && mensaje
              ? mensaje
              : 'Tu vehículo no tiene foto';

  return (
    <Burbuja style={styles.fila}>
      <View style={styles.icono}>
        <Ionicons name="camera-outline" size={dsSpace.lg} color={dsColors.primaryText} />
      </View>
      <Text size="sm" style={styles.texto} numberOfLines={1}>
        {texto}
      </Text>
      {!enCurso ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={requiereAjustes ? 'Abrir ajustes' : 'Tomar foto'}
          hitSlop={8}
          style={styles.accion}
          onPress={() => (requiereAjustes ? void Linking.openSettings() : void tomarFoto())}
        >
          <Text size="sm" weight="semibold" style={styles.accionTexto} numberOfLines={1}>
            {requiereAjustes ? 'Abrir ajustes' : 'Tomar foto'}
          </Text>
        </Pressable>
      ) : null}
      {!enCurso ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Descartar aviso de foto por hoy"
          hitSlop={10}
          style={styles.descartar}
          onPress={descartar}
        >
          <Ionicons name="close" size={dsSpace.lg} color={dsColors.primaryText} />
        </Pressable>
      ) : null}
    </Burbuja>
  );
}

const styles = StyleSheet.create({
  fila: { flexDirection: 'row', alignItems: 'center', gap: dsSpace.sm },
  icono: {
    width: quivoBubble.touch,
    height: quivoBubble.touch,
    borderRadius: quivoBubble.innerRadius,
    backgroundColor: dsColors.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texto: { flex: 1, minWidth: 0, color: dsColors.textPrimary },
  accion: { minHeight: quivoBubble.touch, justifyContent: 'center', paddingHorizontal: dsSpace.xs },
  accionTexto: { color: dsColors.primaryText },
  descartar: {
    width: quivoBubble.touch,
    height: quivoBubble.touch,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
