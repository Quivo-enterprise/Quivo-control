import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BlurView } from 'expo-blur';
import type { ContextoOperativoMovil } from '@quivo/shared';
import { Button } from '../../shared/components/Button';
import { QuivoIcon, type QuivoIconName } from '../../shared/components/quivo-icon';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../../shared/theme/quivo-theme';

interface TripControlSheetProps {
  contexto: ContextoOperativoMovil;
  tracking: boolean;
  gpsPoints: number;
  completedPoints: number;
  totalPoints: number;
  nextPointOrder: number | null;
  pendingEvents: number;
  canStart: boolean;
  gpsError: string | null;
  syncError: string | null;
  loading: boolean;
  observation: string;
  sendingObservation: boolean;
  observationSent: boolean;
  onObservationChange: (value: string) => void;
  onSendObservation: () => void;
  onStart: () => void;
  onFinish: () => void;
  onLogout: () => void;
}

export function TripControlSheet(props: TripControlSheetProps) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'route' | 'report' | 'profile'>('route');
  const syncLabel =
    props.pendingEvents === 0 ? 'Sin pendientes' : `${props.pendingEvents} pendiente(s)`;

  return (
    <BlurView
      intensity={expanded ? 0 : 68}
      tint="light"
      style={[styles.sheet, expanded ? styles.sheetExpanded : null]}
    >
      {expanded ? (
        <>
          <View style={styles.expandedHeader}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Volver al mapa"
              onPress={() => setExpanded(false)}
              style={styles.backButton}
            >
              <QuivoIcon name="chevron-left" size={26} strokeWidth={2.5} />
            </Pressable>
            <View style={styles.expandedHeading}>
              <Text style={styles.kicker}>RECORRIDO</Text>
              <Text accessibilityRole="header" style={styles.expandedTitle}>
                Opciones de jornada
              </Text>
            </View>
          </View>

          <ScrollView
            style={styles.tabScroll}
            contentContainerStyle={styles.tabContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {activeTab === 'route' ? (
              <>
                <View style={styles.tabLead}>
                  <Text style={styles.sectionTitle}>Estado de la ruta</Text>
                  <View
                    style={[
                      styles.syncPill,
                      props.pendingEvents > 0 ? styles.syncPillPending : null,
                    ]}
                  >
                    <Text style={styles.syncPillText}>{syncLabel}</Text>
                  </View>
                </View>
                <Text style={styles.routeStateTitle}>
                  {props.nextPointOrder === null
                    ? props.tracking
                      ? 'Ruta completada'
                      : `${props.contexto.linea.codigo} · ${turnLabel(props.contexto.asignacion.horario)}`
                    : `Próximo control · #${props.nextPointOrder + 1}`}
                </Text>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressValue,
                      { width: `${progressPercent(props.completedPoints, props.totalPoints)}%` },
                    ]}
                  />
                </View>
                <Text style={styles.progressLabel}>
                  {props.completedPoints} de {props.totalPoints} controles · {props.gpsPoints}{' '}
                  puntos GPS
                </Text>
                <InfoRow
                  label="Ruta"
                  value={`${props.contexto.linea.codigo} · ${props.contexto.linea.nombre}`}
                />
                <InfoRow
                  label="Sentido"
                  value={capitalize(props.contexto.ruta.sentido)}
                />
                <InfoRow
                  label="Turno"
                  value={turnLabel(props.contexto.asignacion.horario)}
                />
                <Button
                  variant={props.tracking ? 'danger' : 'primary'}
                  disabled={!props.tracking && !props.canStart}
                  onPress={props.tracking ? props.onFinish : props.onStart}
                >
                  {props.tracking ? 'Finalizar recorrido' : 'Iniciar recorrido'}
                </Button>
                {props.gpsError ? <Text style={styles.error}>{props.gpsError}</Text> : null}
                {props.syncError ? <Text style={styles.error}>{props.syncError}</Text> : null}
              </>
            ) : null}

            {activeTab === 'report' ? (
              <>
                <Text style={styles.sectionTitle}>Reportar una novedad</Text>
                <Text style={styles.sectionDescription}>
                  Registra desvíos, bloqueos o incidentes sin salir del recorrido.
                </Text>
                <TextInput
                  accessibilityLabel="Observación del recorrido"
                  style={styles.observationInput}
                  placeholder="Ej: desvío por corte de calle"
                  placeholderTextColor={quivoColors.textMuted}
                  value={props.observation}
                  onChangeText={props.onObservationChange}
                  multiline
                />
                <Button
                  variant="primary"
                  loading={props.sendingObservation}
                  disabled={!props.observation.trim()}
                  onPress={props.onSendObservation}
                >
                  Guardar novedad
                </Button>
                {props.observationSent ? (
                  <Text style={styles.success}>Novedad guardada en el dispositivo</Text>
                ) : null}
              </>
            ) : null}

            {activeTab === 'profile' ? (
              <>
                <Text style={styles.sectionTitle}>Conductor y vehículo</Text>
                <InfoRow label="Conductor" value={props.contexto.conductor.nombre} />
                <InfoRow
                  label="Documento"
                  value={props.contexto.conductor.documentoIdentidad}
                />
                <InfoRow
                  label="Vehículo"
                  value={`${props.contexto.vehiculo.placa} · ${props.contexto.vehiculo.marca} ${props.contexto.vehiculo.modelo}`}
                />
                <InfoRow label="Sindicato" value={props.contexto.sindicato.nombre} />
                <Button
                  variant="secondary"
                  loading={props.loading}
                  disabled={props.tracking}
                  accessibilityHint={
                    props.tracking ? 'Finaliza el recorrido antes de cerrar sesión' : undefined
                  }
                  onPress={props.onLogout}
                >
                  Cerrar sesión
                </Button>
              </>
            ) : null}
          </ScrollView>

          <View accessibilityRole="toolbar" style={styles.bottomNavigation}>
            <NavigationTab
              icon="route"
              label="Ruta"
              active={activeTab === 'route'}
              onPress={() => setActiveTab('route')}
            />
            <NavigationTab
              icon="alert-triangle"
              label="Novedad"
              active={activeTab === 'report'}
              onPress={() => setActiveTab('report')}
            />
            <NavigationTab
              icon="user"
              label="Perfil"
              active={activeTab === 'profile'}
              onPress={() => setActiveTab('profile')}
            />
          </View>
        </>
      ) : (
        <>
          <View style={styles.compactNavigation}>
            <QuickAction
              icon="route"
              label="Ruta"
              onPress={() => {
                setActiveTab('route');
                setExpanded(true);
              }}
            />
            <QuickAction
              icon="alert-triangle"
              label="Novedad"
              danger
              onPress={() => {
                setActiveTab('report');
                setExpanded(true);
              }}
            />
            <QuickAction
              icon="user"
              label="Perfil"
              onPress={() => {
                setActiveTab('profile');
                setExpanded(true);
              }}
            />
          </View>

          <View style={styles.summaryRow}>
            <View style={styles.summaryText}>
              <Text style={styles.kicker}>
                {props.tracking ? 'RECORRIDO EN CURSO' : 'LISTO PARA SALIR'}
              </Text>
              <Text accessibilityRole="header" style={styles.title}>
                {props.nextPointOrder === null
                  ? props.tracking
                    ? 'Ruta completada'
                    : `${props.contexto.linea.codigo} · ${turnLabel(props.contexto.asignacion.horario)}`
                  : `Próximo control · #${props.nextPointOrder + 1}`}
              </Text>
            </View>
            <View
              style={[
                styles.syncPill,
                props.pendingEvents > 0 ? styles.syncPillPending : null,
              ]}
            >
              <Text style={styles.syncPillText}>{syncLabel}</Text>
            </View>
          </View>

          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressValue,
                { width: `${progressPercent(props.completedPoints, props.totalPoints)}%` },
              ]}
            />
          </View>
          <Button
            variant={props.tracking ? 'danger' : 'primary'}
            disabled={!props.tracking && !props.canStart}
            accessibilityHint={
              props.tracking
                ? 'Solicita confirmación antes de finalizar el seguimiento GPS'
                : 'Activa el seguimiento GPS y el modo navegación'
            }
            onPress={props.tracking ? props.onFinish : props.onStart}
          >
            {props.tracking ? 'Finalizar recorrido' : 'Iniciar recorrido'}
          </Button>
          {props.gpsError ? <Text style={styles.error}>{props.gpsError}</Text> : null}
        </>
      )}
    </BlurView>
  );
}

function QuickAction({
  icon,
  label,
  danger = false,
  onPress,
}: {
  icon: QuivoIconName;
  label: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Abrir ${label}`}
      onPress={onPress}
      style={styles.quickAction}
    >
      <QuivoIcon
        name={icon}
        size={22}
        color={danger ? quivoColors.danger : quivoColors.primary}
        strokeWidth={2.2}
      />
      <Text style={[styles.quickActionLabel, danger ? styles.quickActionDanger : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

function NavigationTab({
  icon,
  label,
  active,
  onPress,
}: {
  icon: QuivoIconName;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.navigationTab, active ? styles.navigationTabActive : null]}
    >
      <QuivoIcon
        name={icon}
        size={22}
        color={active ? quivoColors.primary : quivoColors.textMuted}
        strokeWidth={active ? 2.5 : 2}
      />
      <Text style={[styles.navigationLabel, active ? styles.navigationLabelActive : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function turnLabel(turn: ContextoOperativoMovil['asignacion']['horario']): string {
  return { manana: 'Mañana', tarde: 'Tarde', noche: 'Noche' }[turn];
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function progressPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((completed / total) * 100));
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: quivoSpacing.sm,
    right: quivoSpacing.sm,
    bottom: quivoSpacing.sm,
    backgroundColor: quivoColors.glassSurfaceStrong,
    borderRadius: quivoRadius.xl,
    borderWidth: 1,
    borderColor: quivoColors.glassBorder,
    overflow: 'hidden',
    paddingHorizontal: quivoSpacing.lg,
    paddingBottom: quivoSpacing.lg,
    shadowColor: quivoColors.text,
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 14,
    gap: quivoSpacing.sm,
  },
  sheetExpanded: {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: undefined,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    paddingTop: 0,
    paddingHorizontal: 0,
    paddingBottom: 0,
    gap: 0,
    borderWidth: 0,
    backgroundColor: quivoColors.card,
  },
  expandedHeader: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: quivoSpacing.md,
    borderBottomWidth: 1,
    borderBottomColor: quivoColors.primarySubtle,
  },
  backButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: quivoRadius.pill,
    backgroundColor: quivoColors.primarySubtle,
  },
  expandedHeading: { flex: 1, marginLeft: quivoSpacing.md },
  expandedTitle: {
    color: quivoColors.text,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 18,
    marginTop: quivoSpacing.xs,
  },
  tabScroll: { flex: 1 },
  tabContent: {
    gap: quivoSpacing.lg,
    padding: quivoSpacing.lg,
    paddingBottom: quivoSpacing.xl,
  },
  tabLead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: quivoSpacing.md,
  },
  routeStateTitle: {
    color: quivoColors.text,
    fontFamily: quivoFonts.displayBold,
    fontSize: 22,
  },
  sectionDescription: {
    color: quivoColors.textSecondary,
    fontFamily: quivoFonts.bodyRegular,
    fontSize: 12,
    lineHeight: 18,
  },
  bottomNavigation: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: 1,
    borderTopColor: quivoColors.primarySubtle,
    backgroundColor: quivoColors.card,
    paddingHorizontal: quivoSpacing.sm,
  },
  navigationTab: {
    flex: 1,
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: quivoSpacing.xs,
    borderRadius: quivoRadius.md,
  },
  navigationTabActive: { backgroundColor: quivoColors.primarySubtle },
  navigationLabel: {
    color: quivoColors.textMuted,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 11,
  },
  navigationLabelActive: { color: quivoColors.primary },
  compactNavigation: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: quivoSpacing.xs,
    padding: quivoSpacing.xs,
    borderRadius: quivoRadius.lg,
    backgroundColor: quivoColors.primarySubtle,
  },
  quickAction: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: quivoRadius.md,
    backgroundColor: quivoColors.card,
  },
  quickActionLabel: {
    color: quivoColors.primary,
    fontFamily: quivoFonts.displayBold,
    fontSize: 8,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  quickActionDanger: { color: quivoColors.danger },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: quivoSpacing.md },
  summaryText: { flex: 1 },
  kicker: {
    color: quivoColors.primary,
    fontFamily: quivoFonts.displayBold,
    fontSize: 9,
    letterSpacing: 0.8,
  },
  title: {
    color: quivoColors.text,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 18,
    marginTop: quivoSpacing.xs,
  },
  syncPill: {
    backgroundColor: quivoColors.successSoft,
    borderRadius: quivoRadius.pill,
    paddingHorizontal: quivoSpacing.md,
    paddingVertical: quivoSpacing.sm,
  },
  syncPillPending: { backgroundColor: quivoColors.accentSoft },
  syncPillText: { color: quivoColors.text, fontFamily: quivoFonts.bodySemiBold, fontSize: 10 },
  progressTrack: {
    height: 5,
    backgroundColor: quivoColors.primarySubtle,
    borderRadius: quivoRadius.pill,
    overflow: 'hidden',
  },
  progressValue: { height: 5, backgroundColor: quivoColors.accent },
  progressLabel: {
    color: quivoColors.textSecondary,
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 10,
    marginBottom: quivoSpacing.xs,
  },
  sectionTitle: {
    color: quivoColors.text,
    fontFamily: quivoFonts.displayBold,
    fontSize: 12,
    letterSpacing: 0.3,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: quivoSpacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: quivoColors.primarySubtle,
    paddingBottom: quivoSpacing.sm,
  },
  infoLabel: { color: quivoColors.textMuted, fontFamily: quivoFonts.bodyMedium, fontSize: 11 },
  infoValue: {
    flex: 1,
    color: quivoColors.text,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 12,
    textAlign: 'right',
  },
  observationInput: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: quivoColors.border,
    borderRadius: quivoRadius.md,
    padding: quivoSpacing.md,
    color: quivoColors.text,
    fontFamily: quivoFonts.bodyRegular,
    fontSize: 13,
    textAlignVertical: 'top',
  },
  error: { color: quivoColors.danger, fontFamily: quivoFonts.bodyMedium, fontSize: 11 },
  success: { color: quivoColors.success, fontFamily: quivoFonts.bodySemiBold, fontSize: 11 },
});
