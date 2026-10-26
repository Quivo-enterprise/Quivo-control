import { StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import type { ContextoOperativoMovil, LineaBrand } from '@quivo/shared';
import { quivoFonts, quivoRadius } from '../../shared/theme/quivo-theme';

export interface DriverRouteCardProps {
  contexto: ContextoOperativoMovil;
  brand: LineaBrand;
  tracking: boolean;
  /** Variante compacta (modo navegación): menos padding, para que el mapa ocupe la pantalla. */
  compacta?: boolean;
}

export function DriverRouteCard({ contexto, tracking, brand, compacta = false }: DriverRouteCardProps) {
  const statusLabel = tracking ? 'EN VIVO' : 'EN ESPERA';

  return (
    <BlurView intensity={100} tint="light" style={[styles.identityCard, compacta && styles.identityCardCompacta]}>
      <View style={styles.routeSummary}>
        {/* Colores de marca de la línea (`resolverMarcaLinea`): fondo = primary, borde = tertiary,
            franja inferior = secondary. Identifica la línea, no el estado. */}
        <View style={[styles.lineBadge, { backgroundColor: brand.primary, borderColor: brand.tertiary }]}>
          <Text style={[styles.lineBadgeText, { color: brand.text }]}>{contexto.linea.codigo}</Text>
          <View style={[styles.lineBadgeAccent, { backgroundColor: brand.secondary }]} />
        </View>
        {/* Estado del rastreo: "EN VIVO"/"EN ESPERA" con punto de color. */}
        <View style={[styles.statusPill, tracking ? styles.statusPillActive : styles.statusPillIdle]}>
          <View style={[styles.statusDot, { backgroundColor: tracking ? '#22C55E' : '#94A3B8' }]} />
          <Text style={[styles.statusPillText, tracking ? styles.statusPillTextActive : styles.statusPillTextIdle]}>
            {statusLabel}
          </Text>
        </View>
      </View>
    </BlurView>
  );
}

const styles = StyleSheet.create({
  identityCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.8)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 6,
  },
  identityCardCompacta: {
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
  },
  routeSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  lineBadge: {
    borderRadius: 10,
    borderWidth: 1.5,
    paddingHorizontal: 10,
    paddingTop: 3,
    paddingBottom: 5,
    overflow: 'hidden',
  },
  lineBadgeText: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 20,
    lineHeight: 22,
    textAlign: 'center',
  },
  lineBadgeAccent: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: quivoRadius.pill,
  },
  statusPillActive: { backgroundColor: 'rgba(34, 197, 94, 0.14)' },
  statusPillIdle: { backgroundColor: 'rgba(49, 39, 177, 0.10)' },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusPillText: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 8.5,
    letterSpacing: 0.5,
  },
  statusPillTextActive: { color: '#15803D' },
  statusPillTextIdle: { color: '#3127B1' },
});
