import { StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import type { ContextoOperativoMovil, LineaBrand } from '@quivo/shared';
import { quivoColors, quivoFonts, quivoRadius } from '../../shared/theme/quivo-theme';
import { formatHoraBolivia } from '../../shared/format-hora';

export interface DriverRouteCardProps {
  contexto: ContextoOperativoMovil;
  brand: LineaBrand;
  tracking: boolean;
  /** Día declarado (EMPEZAR DÍA): muestra la píldora "Día iniciado HH:MM" fuera de recorrido. */
  jornadaIniciada?: boolean;
  /** Instante ISO de la declaración de jornada. */
  inicioTs?: string | null;
  /** Variante compacta (modo navegación): menos padding y sin líneas secundarias, para que el
   * mapa ocupe la pantalla. */
  compacta?: boolean;
  /** Hay designación a Molinos vigente: muestra el recorrido "Honduras → Molinos → Salomón Romero". */
  viaMolinos?: boolean;
}

export function DriverRouteCard({
  contexto,
  tracking,
  brand,
  jornadaIniciada = false,
  inicioTs = null,
  compacta = false,
  viaMolinos = false,
}: DriverRouteCardProps) {
  // Entrega 4 (`docs/estados-red-vs-captura.md`): el status pill de abajo se guía solo por
  // `tracking` — mismo criterio que el fix equivalente en `perfil-screen.tsx` — nunca por
  // `isOffline`, que ya no es una prop de este componente.
  const modeloVehiculo = `${contexto.vehiculo.placa} ${contexto.vehiculo.modelo || 'Toyota Hiace'}`.trim();
  const statusLabel = tracking ? 'EN LINEA' : 'EN ESPERA';
  const hora = inicioTs ? formatHoraBolivia(inicioTs) : null;
  const mostrarJornada = jornadaIniciada && !tracking && hora !== null;

  return (
    // Más blur (pedido explícito) — 80 -> 100, el máximo que acepta expo-blur.
    <BlurView intensity={100} tint="light" style={[styles.identityCard, compacta && styles.identityCardCompacta]}>
      {compacta ? null : <View style={styles.avatar} />}
      <View style={styles.identityText}>
        {compacta ? (
          <Text numberOfLines={1} style={styles.driverName}>
            {modeloVehiculo}
          </Text>
        ) : (
          <>
            <Text numberOfLines={1} style={styles.driverName}>
              {contexto.conductor.nombre}
            </Text>
            <Text numberOfLines={1} style={styles.sindicatoText}>
              {contexto.sindicato.nombre}
            </Text>
            <Text numberOfLines={1} style={styles.vehicleText}>
              {modeloVehiculo}
            </Text>
          </>
        )}
        {viaMolinos ? (
          <View
            style={styles.viaMolinosPill}
            accessible
            accessibilityLabel="Recorrido: Honduras, Molinos, Salomón Romero"
          >
            <Ionicons name="trail-sign" size={13} color={quivoColors.primary} />
            <Text numberOfLines={1} style={styles.viaMolinosPillText}>
              Honduras → Molinos → Salomón Romero
            </Text>
          </View>
        ) : null}
        {mostrarJornada ? (
          <View
            style={styles.jornadaPill}
            accessible
            accessibilityLabel={`Día iniciado a las ${hora}`}
          >
            <Ionicons name="checkmark-circle" size={13} color={quivoColors.success} />
            <Text style={styles.jornadaPillText}>Día iniciado {hora}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.routeSummary}>
        {/* Antes el "120" solo tomaba un color naranja/morado según tracking, sin relación con
            la línea real — `resolverMarcaLinea` (@quivo/shared) ya trae hasta 3 colores de
            marca por línea (primary/secondary/tertiary), la misma fuente que usa
            `assignment-selection-screen.tsx`. Acá: fondo = primary, borde = tertiary, y una
            franja inferior = secondary — así el badge sí identifica la línea, no el estado. */}
        <View style={[styles.lineBadge, { backgroundColor: brand.primary, borderColor: brand.tertiary }]}>
          <Text style={[styles.lineBadgeText, { color: brand.text }]}>{contexto.linea.codigo}</Text>
          <View style={[styles.lineBadgeAccent, { backgroundColor: brand.secondary }]} />
        </View>
        {/* "EN LÍNEA"/"EN ESPERA" como badge con punto de estado (mismo lenguaje visual que los
            badges de `perfil-screen.tsx`), en vez de solo texto de color — se distingue del
            badge de línea de arriba, que ahora es sobre la marca, no sobre el estado. */}
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
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#3127B1',
  },
  identityText: { flex: 1, minWidth: 0, justifyContent: 'center' },
  driverName: {
    color: '#3127B1',
    fontFamily: quivoFonts.displayBold,
    fontSize: 15.5,
  },
  sindicatoText: {
    color: '#334155',
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 10.5,
    marginTop: 1,
  },
  vehicleText: {
    color: '#475569',
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 9.5,
    marginTop: 1,
  },
  jornadaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: quivoRadius.pill,
    backgroundColor: quivoColors.successSoft,
  },
  jornadaPillText: {
    color: '#0F5C42',
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 10.5,
  },
  viaMolinosPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: quivoRadius.pill,
    backgroundColor: quivoColors.primarySubtle,
  },
  viaMolinosPillText: {
    flexShrink: 1,
    color: quivoColors.primary,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 10.5,
  },
  routeSummary: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    minWidth: 54,
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
    marginTop: 5,
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
