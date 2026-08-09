import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ContextoOperativoMovil } from '@quivo/shared';
import { Button } from '../../shared/components/Button';
import { QuivoConfirmDialog } from '../../shared/components/quivo-confirm-dialog';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../../shared/theme/quivo-theme';

export interface PerfilScreenProps {
  contexto: ContextoOperativoMovil;
  tracking: boolean;
  pendingEvents: number;
  onBack: () => void;
  onLogout: () => void;
}

export function PerfilScreen(props: PerfilScreenProps) {
  const { contexto } = props;
  const [avisoProximamente, setAvisoProximamente] = useState<'ajustes' | 'sync' | null>(null);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver a la ruta"
          onPress={props.onBack}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color={quivoColors.white} />
        </Pressable>
        <Text style={styles.headerTitle}>Perfil</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.identityBlock}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(contexto.conductor.nombre)}</Text>
          </View>
          <Text style={styles.driverName}>{contexto.conductor.nombre}</Text>
          <Text style={styles.sindicatoText}>{contexto.sindicato.nombre}</Text>
          <View style={[styles.badge, props.tracking ? styles.badgeActive : styles.badgeIdle]}>
            <Ionicons
              name={props.tracking ? 'radio-button-on' : 'time-outline'}
              size={12}
              color={props.tracking ? quivoColors.success : quivoColors.textMuted}
            />
            <Text style={[styles.badgeText, props.tracking ? styles.badgeTextActive : null]}>
              {props.tracking ? `Recorrido en curso · ${contexto.linea.codigo}` : 'EN ESPERA'}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Navegación de perfil</Text>
        <View style={styles.menuList}>
          <MenuRow
            icon="settings-outline"
            title="Ajustes de operación"
            description="Configura cómo opera la app"
            onPress={() => setAvisoProximamente('ajustes')}
          />
          <MenuRow
            icon="sync-outline"
            title="Sincronización y soporte"
            description={
              props.pendingEvents > 0
                ? `${props.pendingEvents} eventos pendientes de sincronizar`
                : 'Revisa servicios y ayuda'
            }
            onPress={() => setAvisoProximamente('sync')}
          />
          <MenuRow
            icon="shield-checkmark-outline"
            title="Seguridad y salida"
            description="Protege tu cuenta"
            onPress={props.onLogout}
          />
        </View>

        <Text style={styles.sectionTitle}>Información operativa</Text>
        <View style={styles.infoList}>
          <InfoRow label="Cédula de identidad" value={contexto.conductor.documentoIdentidad} />
          <InfoRow
            label="Vehículo"
            value={`${contexto.vehiculo.placa} · ${contexto.vehiculo.marca} ${contexto.vehiculo.modelo}`}
          />
          <InfoRow label="Sindicato" value={contexto.sindicato.nombre} />
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Desde la ruta, abre Perfil para configurar lo que necesitas.</Text>
          <Button variant="secondary" onPress={props.onBack} style={{ marginTop: quivoSpacing.md }}>
            Volver a ruta
          </Button>
        </View>
      </ScrollView>

      <QuivoConfirmDialog
        visible={avisoProximamente === 'ajustes'}
        title="Ajustes de operación"
        message="Esta sección estará disponible próximamente (QUI-263)."
        confirmLabel="Entendido"
        onConfirm={() => setAvisoProximamente(null)}
      />
      <QuivoConfirmDialog
        visible={avisoProximamente === 'sync'}
        title="Sincronización y soporte"
        message="Esta sección estará disponible próximamente."
        confirmLabel="Entendido"
        onConfirm={() => setAvisoProximamente(null)}
      />
    </View>
  );
}

function MenuRow({
  icon,
  title,
  description,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      style={styles.menuRow}
      onPress={onPress}
    >
      <View style={styles.menuIcon}>
        <Ionicons name={icon} size={20} color={quivoColors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.menuTitle}>{title}</Text>
        <Text style={styles.menuDescription}>{description}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={quivoColors.textMuted} />
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

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: quivoColors.page },
  header: {
    backgroundColor: quivoColors.primaryStrong,
    flexDirection: 'row',
    alignItems: 'center',
    gap: quivoSpacing.md,
    paddingHorizontal: quivoSpacing.lg,
    paddingVertical: quivoSpacing.lg,
  },
  backButton: { padding: quivoSpacing.xs },
  headerTitle: {
    color: quivoColors.white,
    fontFamily: quivoFonts.displayBold,
    fontSize: 20,
  },
  scrollContent: { padding: quivoSpacing.lg, paddingBottom: quivoSpacing.xxl },
  identityBlock: { alignItems: 'center', paddingVertical: quivoSpacing.lg, gap: 4 },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: quivoRadius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: quivoColors.primary,
    marginBottom: quivoSpacing.sm,
  },
  avatarText: { color: quivoColors.white, fontFamily: quivoFonts.displayBold, fontSize: 22 },
  driverName: { color: quivoColors.text, fontFamily: quivoFonts.displayBold, fontSize: 18 },
  sindicatoText: { color: quivoColors.textSecondary, fontFamily: quivoFonts.bodyMedium, fontSize: 13 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: quivoRadius.pill,
    paddingHorizontal: quivoSpacing.md,
    paddingVertical: 6,
    marginTop: quivoSpacing.sm,
  },
  badgeActive: { backgroundColor: quivoColors.successSoft },
  badgeIdle: { backgroundColor: quivoColors.primarySubtle },
  badgeText: { fontFamily: quivoFonts.bodySemiBold, fontSize: 12, color: quivoColors.textMuted },
  badgeTextActive: { color: quivoColors.success },
  sectionTitle: {
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 12,
    color: quivoColors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: quivoSpacing.lg,
    marginBottom: quivoSpacing.sm,
  },
  menuList: {
    backgroundColor: quivoColors.card,
    borderRadius: quivoRadius.lg,
    borderWidth: 1,
    borderColor: quivoColors.border,
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: quivoSpacing.md,
    padding: quivoSpacing.md,
    borderBottomWidth: 1,
    borderBottomColor: quivoColors.border,
  },
  menuIcon: {
    width: 36,
    height: 36,
    borderRadius: quivoRadius.md,
    backgroundColor: quivoColors.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuTitle: { fontFamily: quivoFonts.bodySemiBold, fontSize: 14, color: quivoColors.text },
  menuDescription: { fontFamily: quivoFonts.bodyRegular, fontSize: 12, color: quivoColors.textMuted, marginTop: 2 },
  infoList: {
    backgroundColor: quivoColors.card,
    borderRadius: quivoRadius.lg,
    borderWidth: 1,
    borderColor: quivoColors.border,
    padding: quivoSpacing.md,
    gap: quivoSpacing.md,
  },
  infoRow: {},
  infoLabel: {
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 11,
    color: quivoColors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoValue: {
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 14,
    color: quivoColors.text,
    marginTop: 2,
  },
  footer: { marginTop: quivoSpacing.xl, alignItems: 'center' },
  footerText: {
    fontFamily: quivoFonts.bodyRegular,
    fontSize: 12,
    color: quivoColors.textMuted,
    textAlign: 'center',
  },
});
