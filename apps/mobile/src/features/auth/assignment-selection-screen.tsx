import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { resolverMarcaLinea, type ResumenAsignacionMovil } from '@quivo/shared';
import { Badge, Heading, Text, colors, radius, space, fontSize } from '@quivo/design-system-native';
import { Button } from '../../shared/components/Button';
import { formatHoraBolivia } from '../../shared/format-hora';
import { QuivoHeader } from '../../shared/components/quivo-header';
import { quivoBubble } from '../../shared/theme/quivo-theme';

interface AssignmentSelectionScreenProps {
  asignaciones: ResumenAsignacionMovil[];
  loading: boolean;
  error: string | null;
  onSelect: (id: string) => Promise<void>;
  onBack: () => void;
}
const c = colors.light;
export function AssignmentSelectionScreen({
  asignaciones,
  loading,
  error,
  onSelect,
  onBack,
}: AssignmentSelectionScreenProps) {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.headerWrapper}>
        <QuivoHeader
          title="Elige tu turno"
          subtitle="Encontramos más de una asignación vigente. Confirma cuál iniciarás ahora."
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver a comenzar"
          accessibilityState={{ disabled: loading }}
          disabled={loading}
          onPress={onBack}
          style={({ pressed }) => [styles.backAction, pressed && styles.backActionPressed]}
        />
      </View>
      <View accessibilityRole="list" style={styles.list}>
        {asignaciones.map((asignacion) => {
          const marca = resolverMarcaLinea(asignacion.linea);
          const hora = formatHoraBolivia(asignacion.horaSalida);
          return (
            <Pressable
              key={asignacion.id}
              accessibilityRole="button"
              accessibilityLabel={`${asignacion.horario}, ${asignacion.linea.nombre}`}
              disabled={loading}
              onPress={() => void onSelect(asignacion.id)}
              style={({ pressed }) => [styles.assignmentCard, pressed && styles.pressed]}
            >
              <View style={styles.topRow}>
                <View style={[styles.lineBrand, { backgroundColor: marca.primary }]}>
                  {marca.logoUrl ? (
                    <Image source={{ uri: marca.logoUrl }} style={styles.lineLogo} />
                  ) : null}
                  <Text weight="bold" style={{ color: marca.text, fontSize: fontSize.lg }}>
                    {marca.shortName}
                  </Text>
                </View>
                <View style={styles.turnCopy}>
                  <Heading size="md" numberOfLines={1}>
                    {asignacion.linea.nombre}
                  </Heading>
                  <Text size="sm" variant="secondary">
                    {labelTurno(asignacion.horario)}
                  </Text>
                </View>
              </View>
              <View style={styles.details}>
                {hora ? <Badge variant="accent">{`Salida ${hora}`}</Badge> : null}
                <Text size="sm" variant="secondary">
                  Ruta {asignacion.ruta.sentido}
                </Text>
              </View>
              <Button
                variant="outline"
                disabled={loading}
                onPress={() => void onSelect(asignacion.id)}
                fullWidth
              >
                Seleccionar turno
              </Button>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <Text size="sm" variant="error">
          {error}
        </Text>
      ) : null}
      <Button variant="secondary" disabled={loading} onPress={onBack}>
        Volver a comenzar
      </Button>
    </ScrollView>
  );
}
function labelTurno(turno: ResumenAsignacionMovil['horario']): string {
  return { manana: 'Turno mañana', tarde: 'Turno tarde', noche: 'Turno noche' }[turno];
}
const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.lg, paddingBottom: space['2xl'] },
  headerWrapper: { position: 'relative' },
  backAction: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: quivoBubble.touch,
    height: quivoBubble.touch,
    borderRadius: radius.full,
  },
  backActionPressed: { backgroundColor: c.primarySoft, opacity: 0.4 },
  list: { gap: space.md },
  assignmentCard: {
    backgroundColor: c.surfaceCard,
    borderColor: c.borderSubtle,
    borderWidth: 1,
    borderRadius: quivoBubble.radius,
    padding: space.md,
    gap: space.md,
    minHeight: quivoBubble.touch,
  },
  pressed: { backgroundColor: c.accentSoft, borderColor: c.accent },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.ms },
  lineBrand: {
    minWidth: 64,
    minHeight: 52,
    paddingHorizontal: space.sm,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space.xs,
  },
  lineLogo: { width: 28, height: 28, borderRadius: radius.full },
  turnCopy: { flex: 1, minWidth: 0, gap: space.xs },
  details: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space.sm,
  },
});
