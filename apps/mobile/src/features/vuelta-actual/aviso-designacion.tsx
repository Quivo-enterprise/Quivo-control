import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Text } from '@quivo/design-system-native';
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
  onEntenderDesignacion: () => void;
  onEntenderCancelacion: () => void;
}

/**
 * Aviso PERSISTENTE de la designación a Molinos (o de su cancelación): se queda hasta
 * que el chofer toca "Entendido". A diferencia de `VueltaCompletadaBanner` este SÍ intercepta
 * toques — exige una acción.
 */
export function AvisoDesignacion({
  designada,
  esperaMin,
  cancelada,
  sinActualizar = false,
  onEntenderDesignacion,
  onEntenderCancelacion,
}: AvisoDesignacionProps) {
  if (!designada && !cancelada) return null;
  // La cancelación manda: si coexisten, lo último que pasó es que se canceló.
  const esCancelacion = cancelada;
  const partes = partesAvisoDesignada(esperaMin, 'min');

  return (
    <Burbuja style={styles.aviso}>
      <View
        style={styles.icono}
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
        accessibilityLabel={esCancelacion ? TEXTO_AVISO_CANCELADA : textoAvisoDesignada(esperaMin)}
      >
        <Ionicons
          name={esCancelacion ? 'close-circle' : 'navigate'}
          size={20}
          color={esCancelacion ? dsColors.danger : dsColors.primaryText}
        />
      </View>
      <View style={styles.textoAviso}>
        <Text size="sm" numberOfLines={2}>
          {!esCancelacion && sinActualizar ? (
            <Text size="sm" variant="secondary">
              Sin actualizar ·{' '}
            </Text>
          ) : null}
          {esCancelacion ? (
            <>Se canceló tu designación. {CUERPO_AVISO_CANCELADA}</>
          ) : (
            <>
              {partes.antes}
              <Text size="sm" weight="bold" style={styles.destacado}>
                {partes.destacado}
              </Text>
              {partes.despues}
            </>
          )}
        </Text>
      </View>
      <Button
        variant="ghost"
        onPress={esCancelacion ? onEntenderCancelacion : onEntenderDesignacion}
        accessibilityHint={
          esCancelacion ? 'Cierra el aviso de cancelación' : 'Confirma que leíste la designación'
        }
        style={styles.accion}
      >
        Entendido
      </Button>
    </Burbuja>
  );
}

interface ContadorEsperaMolinosProps {
  /** `null` = no está en Molinos (o sin dato): no se dibuja. */
  pastilla: { texto: string; listo: boolean } | null;
}

/** "Podés salir en N min" / "Ya podés salir" (o el lugar en la cola si la salida es libre) mientras el vehículo está en el PC de espera.
 * Informativo: no bloquea nada y no intercepta toques. */
export function ContadorEsperaMolinos({ pastilla }: ContadorEsperaMolinosProps) {
  if (pastilla === null) return null;
  const { texto, listo } = pastilla;
  return (
    <View pointerEvents="none" style={styles.contador}>
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
  aviso: { width: '100%', alignItems: 'center' },
  icono: {
    width: quivoBubble.touch,
    height: quivoBubble.touch,
    borderRadius: quivoBubble.innerRadius,
    backgroundColor: dsColors.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textoAviso: { flex: 1, gap: dsSpace.xs },
  destacado: { color: dsColors.primary },
  accion: { minHeight: quivoBubble.touch, borderRadius: quivoBubble.innerRadius },
  contador: {
    alignItems: 'flex-start',
  },
});
