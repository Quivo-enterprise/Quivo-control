import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../shared/components/Button';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../../shared/theme/quivo-theme';
import {
  CUERPO_AVISO_CANCELADA,
  TEXTO_AVISO_CANCELADA,
  partesAvisoDesignada,
  textoAvisoDesignada,
  textoContadorEspera,
} from './vuelta-actual-core';

interface AvisoDesignacionProps {
  /** `null` = no hay designación por confirmar. */
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
 * que el chofer toca "Entendido". A diferencia de `VueltaCompletadaBanner` (pasivo, se apaga
 * solo) este SÍ intercepta toques — exige una acción. Misma familia visual: tarjeta `card`,
 * sombra y tipografía Oxanium del tema Quivo.
 */
export function AvisoDesignacion({
  esperaMin,
  cancelada,
  sinActualizar = false,
  top,
  onEntenderDesignacion,
  onEntenderCancelacion,
}: AvisoDesignacionProps) {
  if (esperaMin === null && !cancelada) return null;
  // La cancelación manda: si coexisten, lo último que pasó es que se canceló.
  const esCancelacion = cancelada;
  const partes = esperaMin === null ? null : partesAvisoDesignada(esperaMin, 'min');

  return (
    <View pointerEvents="box-none" style={[styles.contenedor, { top }]}>
      <View
        style={[styles.tarjeta, esCancelacion ? styles.tarjetaCancelada : styles.tarjetaDesignada]}
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
        accessibilityLabel={
          esCancelacion
            ? TEXTO_AVISO_CANCELADA
            : textoAvisoDesignada(esperaMin ?? 0)
        }
      >
        <View style={styles.encabezado}>
          <Ionicons
            name={esCancelacion ? 'close-circle' : 'trail-sign'}
            size={26}
            color={esCancelacion ? quivoColors.danger : quivoColors.primary}
          />
          <Text style={[styles.titulo, esCancelacion && styles.tituloCancelada]}>
            {esCancelacion ? 'Designación cancelada' : 'Designación'}
          </Text>
        </View>
        {esCancelacion ? (
          <Text style={styles.cuerpo}>{CUERPO_AVISO_CANCELADA}</Text>
        ) : (
          partes && (
            <Text style={styles.cuerpo}>
              {partes.antes}
              <Text style={styles.cuerpoNegrita}>{partes.destacado}</Text>
              {partes.despues}
            </Text>
          )
        )}
        {!esCancelacion && sinActualizar ? (
          <Text style={styles.sinActualizar}>sin actualizar</Text>
        ) : null}
        <Button
          variant={esCancelacion ? 'danger' : 'primary'}
          size="lg"
          fullWidth
          onPress={esCancelacion ? onEntenderCancelacion : onEntenderDesignacion}
          accessibilityHint={
            esCancelacion ? 'Cierra el aviso de cancelación' : 'Confirma que leíste la designación'
          }
        >
          Entendido
        </Button>
      </View>
    </View>
  );
}

interface ContadorEsperaMolinosProps {
  /** `null` = no está en Molinos: no se dibuja. */
  restanteMin: number | null;
  /** Posición (dp) desde el borde inferior, justo sobre el sheet de próximo control. */
  bottom: number;
}

/** "Podés salir en N min" / "Ya podés salir" mientras el vehículo está en el PC de espera.
 * Informativo: no bloquea nada y no intercepta toques. */
export function ContadorEsperaMolinos({ restanteMin, bottom }: ContadorEsperaMolinosProps) {
  if (restanteMin === null) return null;
  const listo = restanteMin <= 0;
  const texto = textoContadorEspera(restanteMin);
  return (
    <View pointerEvents="none" style={[styles.contenedor, { bottom }]}>
      <View
        style={styles.pill}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        accessibilityLabel={`Molinos: ${texto}`}
      >
        <Ionicons
          name={listo ? 'checkmark-circle' : 'time-outline'}
          size={18}
          color={listo ? quivoColors.success : quivoColors.accentStrong}
        />
        <Text style={styles.pillTexto}>{texto}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: {
    position: 'absolute',
    left: quivoSpacing.lg,
    right: quivoSpacing.lg,
    zIndex: 1600,
  },
  tarjeta: {
    backgroundColor: quivoColors.card,
    borderRadius: quivoRadius.lg,
    borderLeftWidth: 6,
    padding: quivoSpacing.lg,
    gap: quivoSpacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 8,
  },
  tarjetaDesignada: { borderLeftColor: quivoColors.accent },
  tarjetaCancelada: { borderLeftColor: quivoColors.danger },
  encabezado: { flexDirection: 'row', alignItems: 'center', gap: quivoSpacing.sm },
  titulo: {
    color: quivoColors.primary,
    fontFamily: quivoFonts.displayBold,
    fontSize: 18,
  },
  tituloCancelada: { color: quivoColors.danger },
  cuerpo: {
    color: quivoColors.text,
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 17,
    lineHeight: 24,
  },
  sinActualizar: {
    color: quivoColors.textMuted,
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 12,
  },
  cuerpoNegrita: { fontFamily: quivoFonts.displayBold, color: quivoColors.primary },
  pill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: quivoSpacing.sm,
    backgroundColor: quivoColors.card,
    borderRadius: quivoRadius.pill,
    paddingHorizontal: quivoSpacing.lg,
    paddingVertical: quivoSpacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 6,
  },
  pillTexto: {
    color: quivoColors.text,
    fontFamily: quivoFonts.displayBold,
    fontSize: 14,
  },
});
