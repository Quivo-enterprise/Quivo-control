import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useVehiculoFoto } from '../vehiculo-foto/use-vehiculo-foto';
import { dsColors } from '../../shared/theme/design-system';
import { quivoBubble } from '../../shared/theme/quivo-theme';

interface Props {
  sesionId: string;
  obtenerAccessToken: () => Promise<string | null>;
}

/** Acceso a la foto dentro de la cabecera: el estado desconocido no se presenta como "sin foto". */
export function FotoVehiculoControl({ sesionId, obtenerAccessToken }: Props) {
  const { foto, estadoFoto, estado, requiereAjustes, tomarFoto } = useVehiculoFoto({
    sesionId,
    obtenerAccessToken,
  });
  const ocupado = estado === 'procesando' || estado === 'enviando' || estado === 'pendiente';

  if (foto) {
    return (
      <Image
        source={{ uri: foto.fotoUrl }}
        accessibilityLabel="Foto del vehículo"
        style={styles.foto}
      />
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        ocupado
          ? 'Foto del vehículo en proceso'
          : requiereAjustes
            ? 'Abrir ajustes para tomar foto del vehículo'
            : 'Tomar foto del vehículo'
      }
      disabled={ocupado || estadoFoto !== 'sin_foto'}
      onPress={(event) => {
        event.stopPropagation();
        if (requiereAjustes) void Linking.openSettings();
        else void tomarFoto();
      }}
      style={styles.control}
    >
      {ocupado || estadoFoto === 'cargando' ? (
        <ActivityIndicator color={dsColors.primaryText} />
      ) : (
        <Ionicons name="car-outline" size={24} color={dsColors.primaryText} />
      )}
      {estadoFoto === 'sin_foto' && !ocupado ? (
        <View style={styles.mas}>
          <Ionicons name="add" size={16} color={dsColors.white} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  control: {
    width: quivoBubble.touch + 2 * quivoBubble.padding,
    alignSelf: 'stretch',
    borderRadius: quivoBubble.innerRadius,
    backgroundColor: dsColors.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  foto: {
    width: quivoBubble.touch + 2 * quivoBubble.padding,
    alignSelf: 'stretch',
    borderRadius: quivoBubble.innerRadius,
  },
  mas: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: quivoBubble.innerRadius,
    height: quivoBubble.innerRadius,
    borderRadius: quivoBubble.innerRadius,
    backgroundColor: dsColors.primaryText,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
