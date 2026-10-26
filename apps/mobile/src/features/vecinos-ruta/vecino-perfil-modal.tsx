import { Modal, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, fontStyle } from '@quivo/design-system-native';
import type { VecinoRuta } from '@quivo/shared';
import { useOperacionSettings, useTextScale } from '../perfil/use-operacion-settings';
import { Button } from '../../shared/components/Button';
import { PlacaChapa } from '../../shared/components/placa-chapa';
import { dsColors, dsElevation, dsSpace } from '../../shared/theme/design-system';
import { quivoBubble } from '../../shared/theme/quivo-theme';
import { estadoDistanciaVecino, textoDistancia, type Lado } from './estado-vecinos';
import { SiluetaVehiculo } from './silueta-vehiculo';

interface Props {
  visible: boolean;
  vecino: VecinoRuta | null;
  lado: Lado | null;
  onClose: () => void;
}

const COLOR_DISTANCIA = {
  normal: dsColors.success,
  atencion: dsColors.warningText,
  alerta: dsColors.danger,
};

export function VecinoPerfilModal({ visible, vecino, lado, onClose }: Props) {
  const scale = useTextScale();
  const { settings } = useOperacionSettings();
  if (!vecino || !lado) return null;

  const distancia = textoDistancia(vecino.distanciaM).replace('.', ',');
  const nivelDistancia = lado === 'delante' ? estadoDistanciaVecino(vecino.distanciaM) : null;
  const nombreVehiculo = [vecino.marca, vecino.modelo].filter(Boolean).join(' ');
  const descripcion = [
    nombreVehiculo || 'Vehículo',
    vecino.color ? `· ${vecino.color}` : null,
    vecino.numeroInterno ? `· Interno ${vecino.numeroInterno}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View accessibilityViewIsModal style={styles.card}>
          <View style={styles.imagenVehiculo}>
            <SiluetaVehiculo
              tipo={vecino.tipo}
              color={vecino.color}
              colorSecundario={vecino.colorSecundario}
              ancho={56}
              alto={32}
            />
          </View>

          <View style={styles.detallesFila}>
            <PlacaChapa placa={vecino.placa} scale={scale} textoGrande={settings.textoGrande} />
            <Text
              size="md"
              style={[
                styles.distancia,
                { fontSize: 16 * scale },
                nivelDistancia ? { color: COLOR_DISTANCIA[nivelDistancia] } : null,
              ]}
              allowFontScaling={!settings.textoGrande}
            >
              {lado === 'delante' ? 'Delante' : 'Detrás'} · {distancia}
            </Text>
          </View>

          <Text
            size="md"
            variant="secondary"
            style={[styles.descripcionVehiculo, { fontSize: 16 * scale }]}
            allowFontScaling={!settings.textoGrande}
          >
            {descripcion}
          </Text>

          <View style={styles.proximamente}>
            <View style={styles.proximamenteTitulo}>
              <Ionicons name="time-outline" size={20} color={dsColors.primaryText} />
              <Text
                size="md"
                weight="semibold"
                style={[styles.tituloProximamente, { fontSize: 16 * scale }]}
                allowFontScaling={!settings.textoGrande}
              >
                Próximamente
              </Text>
            </View>
            <Text
              size="sm"
              variant="secondary"
              style={[fontStyle('body', '400'), { fontSize: 14 * scale }]}
              allowFontScaling={!settings.textoGrande}
            >
              Aquí vas a ver la foto del vehículo y los datos del conductor.
            </Text>
          </View>

          <Button variant="outline" size="lg" fullWidth onPress={onClose} style={styles.cerrar}>
            Cerrar
          </Button>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: quivoBubble.edge,
    backgroundColor: quivoBubble.scrim,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    padding: dsSpace.lg,
    gap: dsSpace.md,
    borderRadius: quivoBubble.radius,
    backgroundColor: dsColors.surfaceRaised,
    ...dsElevation(3),
  },
  imagenVehiculo: {
    width: '100%',
    aspectRatio: 16 / 9,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: quivoBubble.innerRadius,
    backgroundColor: dsColors.surfaceSoft,
  },
  detallesFila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: dsSpace.sm,
  },
  distancia: { flexShrink: 1, color: dsColors.textSecondary },
  descripcionVehiculo: { color: dsColors.textPrimary },
  proximamente: {
    gap: dsSpace.xs,
    padding: dsSpace.md,
    borderRadius: quivoBubble.innerRadius,
    backgroundColor: dsColors.primarySubtle,
  },
  proximamenteTitulo: { flexDirection: 'row', alignItems: 'center', gap: dsSpace.sm },
  tituloProximamente: { color: dsColors.primaryText },
  cerrar: { borderRadius: quivoBubble.innerRadius },
});
