import { Image, Linking, StyleSheet, View } from 'react-native';
import { Badge, Loader, Text } from '@quivo/design-system-native';
import { Button } from '../../shared/components/Button';
import { HojaBurbuja } from '../../shared/components/burbuja';
import { dsColors, dsRadius, dsSpace } from '../../shared/theme/design-system';
import { quivoBubble } from '../../shared/theme/quivo-theme';
import { Ionicons } from '@expo/vector-icons';
import { useVehiculoFoto } from './use-vehiculo-foto';
import { formatFechaHoraBolivia } from '../../shared/format-hora';

interface Props {
  placa: string;
  sesionId: string;
  obtenerAccessToken: () => Promise<string | null>;
}

/** Sección "Foto del vehículo" del Perfil: foto actual, fecha (Bolivia) y tomar/reemplazar. */
export function FotoVehiculoSection({ placa, sesionId, obtenerAccessToken }: Props) {
  const {
    foto,
    cargando,
    estadoFoto,
    estado,
    mensaje,
    permisoDenegado,
    requiereAjustes,
    tomarFoto,
  } = useVehiculoFoto({
    obtenerAccessToken,
    sesionId,
  });
  const ocupado = estado === 'procesando' || estado === 'enviando';
  const fecha = foto ? formatFechaHoraBolivia(foto.fotoActualizadaEn) : null;
  const etiquetaBoton = foto ? 'Cambiar foto' : 'Tomar foto';
  const textoEstado =
    estado === 'procesando' ? 'Preparando la foto…' : estado === 'enviando' ? 'Enviando…' : mensaje;

  return (
    <HojaBurbuja style={styles.card}>
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
          <Loader />
        ) : (
          <View
            style={styles.vacia}
            accessible
            accessibilityLabel={
              estadoFoto === 'desconocido'
                ? 'No se pudo cargar la foto'
                : 'El vehículo no tiene foto'
            }
          >
            <Ionicons name="camera-outline" size={30} color={dsColors.textTertiary} />
            <Text size="sm" variant="secondary">
              {estadoFoto === 'desconocido' ? 'No se pudo cargar la foto' : 'Sin foto'}
            </Text>
          </View>
        )}
      </View>

      {fecha ? (
        <Text size="sm" variant="secondary">
          Actualizada el {fecha} (hora de Bolivia)
        </Text>
      ) : null}

      <Badge
        variant={estado === 'error' ? 'danger' : ocupado ? 'warning' : foto ? 'success' : 'neutral'}
      >
        {estado === 'error' ? 'Error' : ocupado ? 'Subiendo' : foto ? 'Lista' : 'Sin foto'}
      </Badge>

      {textoEstado ? (
        <Text
          size="sm"
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

      <Button
        variant="primary"
        loading={ocupado}
        disabled={ocupado}
        onPress={() => void tomarFoto()}
        style={styles.boton}
      >
        {etiquetaBoton}
      </Button>

      {permisoDenegado && requiereAjustes ? (
        <Button variant="outline" onPress={() => void Linking.openSettings()}>
          Abrir ajustes
        </Button>
      ) : null}
    </HojaBurbuja>
  );
}

const styles = StyleSheet.create({
  card: { gap: dsSpace.sm },
  fotoBox: {
    height: 200,
    borderRadius: quivoBubble.innerRadius,
    backgroundColor: dsColors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  foto: { width: '100%', height: '100%', resizeMode: 'cover' },
  vacia: { alignItems: 'center', gap: dsSpace.xs },
  estado: { color: dsColors.textSecondary },
  estadoError: { color: dsColors.danger },
  estadoOk: { color: dsColors.success },
  boton: { minHeight: 48, borderRadius: dsRadius.full },
});
