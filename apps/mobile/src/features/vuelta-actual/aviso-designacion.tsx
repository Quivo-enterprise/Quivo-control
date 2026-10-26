import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Heading, Text } from '@quivo/design-system-native';
import { Burbuja, PildoraBurbuja } from '../../shared/components/burbuja';
import { dsColors, dsSpace } from '../../shared/theme/design-system';
import { quivoBubble } from '../../shared/theme/quivo-theme';
import {
  CUERPO_AVISO_CANCELADA,
  TEXTO_AVISO_CANCELADA,
  partesAvisoDesignada,
  textoAvisoDesignada,
} from './vuelta-actual-core';

interface AvisoDesignacionProps {
  /** Hay una designación por confirmar. */
  designada: boolean;
  /** Minutos de espera en Molinos; `null` = salida libre. */
  esperaMin: number | null;
  cancelada: boolean;
  /** La última consulta buena es vieja: se muestra la designación con una marca discreta. */
  sinActualizar?: boolean;
  /** Posición (dp) desde el borde superior, bajo la tarjeta superior. */
  top: number;
  onEntenderDesignacion: () => void;
  onEntenderCancelacion: () => void;
}

/**
 * Aviso grande y PERSISTENTE de la designación a Molinos (o de su cancelación): se queda hasta
 * que el chofer toca "Entendido". A diferencia de `VueltaCompletadaBanner` este SÍ intercepta
 * toques — exige una acción.
 */
export function AvisoDesignacion({
  designada,
  esperaMin,
  cancelada,
  sinActualizar = false,
  top,
  onEntenderDesignacion,
  onEntenderCancelacion,
}: AvisoDesignacionProps) {
  if (!designada && !cancelada) return null;
  // La cancelación manda: si coexisten, lo último que pasó es que se canceló.
  const esCancelacion = cancelada;
  const partes = partesAvisoDesignada(esperaMin, 'min');

  return (
    <View pointerEvents="box-none" style={[styles.contenedor, { top }]}>
      <Burbuja direction="column" style={styles.tarjeta}>
        <View
          style={styles.contenido}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          accessibilityLabel={
            esCancelacion ? TEXTO_AVISO_CANCELADA : textoAvisoDesignada(esperaMin)
          }
        >
          <View style={styles.encabezado}>
            <Ionicons
              name={esCancelacion ? 'close-circle' : 'trail-sign'}
              size={24}
              color={esCancelacion ? dsColors.danger : dsColors.primary}
            />
            <Heading
              size="md"
              style={{ color: esCancelacion ? dsColors.danger : dsColors.primary }}
            >
              {esCancelacion ? 'Designación cancelada' : 'Designación'}
            </Heading>
          </View>
          {esCancelacion ? (
            <Text size="md">{CUERPO_AVISO_CANCELADA}</Text>
          ) : (
            <Text size="md">
              {partes.antes}
              <Text size="md" weight="bold" style={styles.destacado}>
                {partes.destacado}
              </Text>
              {partes.despues}
            </Text>
          )}
          {!esCancelacion && sinActualizar ? (
            <Text size="sm" variant="secondary">
              Sin actualizar
            </Text>
          ) : null}
        </View>
        <Button
          variant="primary"
          onPress={esCancelacion ? onEntenderCancelacion : onEntenderDesignacion}
          accessibilityHint={
            esCancelacion ? 'Cierra el aviso de cancelación' : 'Confirma que leíste la designación'
          }
          style={styles.accion}
        >
          Entendido
        </Button>
      </Burbuja>
    </View>
  );
}

interface ContadorEsperaMolinosProps {
  /** `null` = no está en Molinos (o sin dato): no se dibuja. */
  pastilla: { texto: string; listo: boolean } | null;
  /** Posición (dp) desde el borde inferior, justo sobre el sheet de próximo control. */
  bottom: number;
}

/** "Podés salir en N min" / "Ya podés salir" (o el lugar en la cola si la salida es libre) mientras el vehículo está en el PC de espera.
 * Informativo: no bloquea nada y no intercepta toques. */
export function ContadorEsperaMolinos({ pastilla, bottom }: ContadorEsperaMolinosProps) {
  if (pastilla === null) return null;
  const { texto, listo } = pastilla;
  return (
    <View pointerEvents="none" style={[styles.contador, { bottom }]}>
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        accessibilityLabel={`Molinos: ${texto}`}
      >
        <PildoraBurbuja icono={listo ? 'checkmark-circle' : 'time-outline'}>{texto}</PildoraBurbuja>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: {
    position: 'absolute',
    left: quivoBubble.edge,
    right: quivoBubble.edge,
    zIndex: 1600,
  },
  tarjeta: { alignItems: 'stretch' },
  contenido: { gap: dsSpace.sm, padding: dsSpace.sm },
  encabezado: { flexDirection: 'row', alignItems: 'center', gap: dsSpace.sm },
  destacado: { color: dsColors.primary },
  accion: { minHeight: 48, borderRadius: quivoBubble.innerRadius },
  contador: {
    position: 'absolute',
    left: quivoBubble.edge,
    right: quivoBubble.edge,
    alignItems: 'center',
    zIndex: 1600,
  },
});
