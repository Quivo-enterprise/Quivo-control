import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../../shared/theme/quivo-theme';
import { useVehiculoFoto } from './use-vehiculo-foto';
import { formatFechaHoraBolivia } from '../../shared/format-hora';

interface Props {
  placa: string;
  sesionId: string;
  obtenerAccessToken: () => Promise<string | null>;
}

/** Sección "Foto del vehículo" del Perfil: foto actual, fecha (Bolivia) y tomar/reemplazar. */
export function FotoVehiculoSection({ placa, sesionId, obtenerAccessToken }: Props) {
  const { foto, cargando, estadoFoto, estado, mensaje, permisoDenegado, requiereAjustes, tomarFoto } = useVehiculoFoto({
    obtenerAccessToken,
    sesionId,
  });
  const ocupado = estado === 'procesando' || estado === 'enviando';
  const fecha = foto ? formatFechaHoraBolivia(foto.fotoActualizadaEn) : null;
  const etiquetaBoton = foto ? 'Reemplazar foto' : 'Tomar foto';
  const textoEstado =
    estado === 'procesando'
      ? 'Preparando la foto…'
      : estado === 'enviando'
        ? 'Enviando…'
        : mensaje;

  return (
    <View style={styles.card}>
      <View style={styles.fotoBox}>
        {foto ? (
          <Image
            key={foto.fotoActualizadaEn}
            source={{ uri: foto.fotoUrl }}
            style={styles.foto}
            accessibilityRole="image"
            accessibilityLabel={`Foto del vehículo ${placa}`}
          />
        ) : cargando ? (
          <ActivityIndicator color={quivoColors.primary} />
        ) : (
          <View style={styles.vacia} accessible accessibilityLabel={
              estadoFoto === 'desconocido' ? 'No se pudo cargar la foto' : 'El vehículo no tiene foto'
            }>
            <Ionicons name="camera-outline" size={30} color={quivoColors.textMuted} />
            <Text style={styles.vaciaTexto}>
              {estadoFoto === 'desconocido' ? 'No se pudo cargar la foto' : 'Sin foto'}
            </Text>
          </View>
        )}
      </View>

      {fecha ? <Text style={styles.fecha}>Actualizada el {fecha} (hora de Bolivia)</Text> : null}

      {textoEstado ? (
        <Text
          accessibilityRole={estado === 'error' ? 'alert' : undefined}
          accessibilityLiveRegion="polite"
          style={[
            styles.estado,
            estado === 'error' && styles.estadoError,
            estado === 'enviada' && styles.estadoOk,
          ]}
        >
          {textoEstado}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={etiquetaBoton}
        accessibilityState={{ disabled: ocupado, busy: ocupado }}
        disabled={ocupado}
        onPress={() => void tomarFoto()}
        style={({ pressed }) => [styles.boton, (pressed || ocupado) && styles.botonPresionado]}
      >
        {ocupado ? (
          <ActivityIndicator color={quivoColors.white} />
        ) : (
          <Ionicons name="camera" size={20} color={quivoColors.white} />
        )}
        <Text style={styles.botonTexto}>{etiquetaBoton}</Text>
      </Pressable>

      {permisoDenegado && requiereAjustes ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Abrir ajustes"
          onPress={() => void Linking.openSettings()}
          style={({ pressed }) => [styles.botonAjustes, pressed && styles.botonPresionado]}
        >
          <Text style={styles.botonAjustesTexto}>Abrir ajustes</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: quivoColors.white,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: quivoSpacing.sm,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  fotoBox: {
    height: 200,
    borderRadius: quivoRadius.md,
    backgroundColor: quivoColors.page,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  foto: { width: '100%', height: '100%', resizeMode: 'cover' },
  vacia: { alignItems: 'center', gap: quivoSpacing.xs },
  vaciaTexto: { color: quivoColors.textMuted, fontFamily: quivoFonts.bodyMedium, fontSize: 12 },
  fecha: { color: '#8A94A6', fontFamily: quivoFonts.bodyRegular, fontSize: 11.5 },
  estado: { color: quivoColors.textSecondary, fontFamily: quivoFonts.bodyMedium, fontSize: 12 },
  estadoError: { color: quivoColors.danger },
  estadoOk: { color: quivoColors.success },
  boton: {
    minHeight: 48,
    borderRadius: quivoRadius.md,
    backgroundColor: quivoColors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: quivoSpacing.sm,
  },
  botonPresionado: { opacity: 0.7 },
  botonTexto: { color: quivoColors.white, fontFamily: quivoFonts.bodySemiBold, fontSize: 14.5 },
  botonAjustes: {
    minHeight: 44,
    borderRadius: quivoRadius.md,
    borderWidth: 1,
    borderColor: quivoColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botonAjustesTexto: { color: quivoColors.primary, fontFamily: quivoFonts.bodySemiBold, fontSize: 14 },
});
