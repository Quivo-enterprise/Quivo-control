import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Heading, Text } from '@quivo/design-system-native';
import { Burbuja } from '../../shared/components/burbuja';
import { dsColors, dsSpace } from '../../shared/theme/design-system';
import { quivoBubble } from '../../shared/theme/quivo-theme';
import {
  TEXTO_SIN_DATO,
  etiquetaAccesibleFila,
  etiquetaLado,
  textoDistancia,
  textoEdad,
  textoVacio,
  type EstadoFila,
  type Lado,
} from './estado-vecinos';

interface Props {
  delante: EstadoFila;
  detras: EstadoFila;
  /** ms desde que se recibió el dato (para envejecer lo mostrado si hay pausa/offline). */
  transcurridoMs: number;
  /** Fallos de red seguidos: lo mostrado puede ser viejo, se avisa en un pie discreto. */
  sinActualizar: boolean;
}

const DISTANCIA_ATENCION_M = 500;
const DISTANCIA_CERCA_M = 300;

function Fila({
  lado,
  estado,
  transcurridoMs,
}: {
  lado: Lado;
  estado: EstadoFila;
  transcurridoMs: number;
}) {
  const vecino = estado.tipo === 'vecino' ? estado.vecino : null;
  const cerca = vecino !== null && vecino.distanciaM <= DISTANCIA_CERCA_M;
  const atencion = vecino !== null && vecino.distanciaM <= DISTANCIA_ATENCION_M;
  const color = cerca ? dsColors.danger : atencion ? dsColors.warning : dsColors.borderSubtle;
  return (
    <View
      style={[styles.fila, { borderColor: color }]}
      accessible
      accessibilityLabel={etiquetaAccesibleFila(lado, estado, transcurridoMs)}
    >
      <Ionicons
        name={
          cerca
            ? 'alert-circle'
            : atencion
              ? 'warning'
              : lado === 'delante'
                ? 'arrow-up'
                : 'arrow-down'
        }
        size={20}
        color={cerca ? dsColors.danger : atencion ? dsColors.warning : dsColors.primary}
      />
      {vecino ? (
        <View style={styles.datos}>
          <View style={styles.linea}>
            <View style={styles.placaBloque}>
              <Text size="sm" weight="semibold" variant="secondary">
                {etiquetaLado(lado).toUpperCase()}
              </Text>
              <Heading size="lg" numberOfLines={1}>
                {vecino.placa}
              </Heading>
            </View>
            <Text size="lg" weight="bold" style={styles.distancia}>
              {textoDistancia(vecino.distanciaM)}
            </Text>
          </View>
          {cerca ? (
            <Text size="sm" weight="semibold" style={styles.alerta}>
              Vehículo de {lado === 'delante' ? 'adelante' : 'atrás'} demasiado cerca
            </Text>
          ) : (
            <Text size="sm" variant="secondary">
              {textoEdad(vecino.edadFixS, transcurridoMs)}
            </Text>
          )}
        </View>
      ) : (
        <Text size="sm" variant="secondary">
          {estado.tipo === 'nadie' ? textoVacio(lado) : TEXTO_SIN_DATO}
        </Text>
      )}
    </View>
  );
}

/** Panel compacto "Delante / Detrás" de la pantalla de operación. */
export const VecinosRutaCard = memo(function VecinosRutaCard({
  delante,
  detras,
  transcurridoMs,
  sinActualizar,
}: Props) {
  return (
    <Burbuja direction="column" style={styles.card}>
      <Fila lado="delante" estado={delante} transcurridoMs={transcurridoMs} />
      <Fila lado="detras" estado={detras} transcurridoMs={transcurridoMs} />
      {sinActualizar ? (
        <Text size="sm" variant="secondary" accessibilityLiveRegion="polite">
          {`Sin actualizar · último dato ${textoEdad(0, transcurridoMs)}`}
        </Text>
      ) : null}
    </Burbuja>
  );
});

const styles = StyleSheet.create({
  card: { width: '100%', alignItems: 'stretch' },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: dsSpace.sm,
    minHeight: quivoBubble.touch,
    padding: dsSpace.sm,
    borderWidth: 1,
    borderRadius: quivoBubble.innerRadius,
    backgroundColor: dsColors.surfaceRaised,
  },
  datos: { flex: 1, minWidth: 0, gap: dsSpace.xs },
  linea: { flexDirection: 'row', alignItems: 'center', gap: dsSpace.sm },
  placaBloque: { flex: 1, minWidth: 0 },
  distancia: { color: dsColors.textPrimary, fontVariant: ['tabular-nums'] },
  alerta: { color: dsColors.danger },
});
