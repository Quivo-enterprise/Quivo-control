import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ResumenAsignacionMovil } from '@quivo/shared';
import { Button } from '../../shared/components/Button';
import { Card } from '../../shared/components/Card';
import { QuivoHeader } from '../../shared/components/quivo-header';
import { quivoColors, quivoFonts, quivoSpacing } from '../../shared/theme/quivo-theme';

interface AssignmentSelectionScreenProps {
  asignaciones: ResumenAsignacionMovil[];
  loading: boolean;
  error: string | null;
  onSelect: (id: string) => Promise<void>;
  onBack: () => void;
}

export function AssignmentSelectionScreen({
  asignaciones,
  loading,
  error,
  onSelect,
  onBack,
}: AssignmentSelectionScreenProps) {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <QuivoHeader
        title="Elige tu turno"
        subtitle="Encontramos más de una asignación vigente. Confirma cuál iniciarás ahora."
      />
      <View accessibilityRole="list" style={styles.list}>
        {asignaciones.map((asignacion) => (
          <Card
            key={asignacion.id}
            accessibilityLabel={`${asignacion.horario}, ${asignacion.linea.nombre}`}
          >
            <Text style={styles.turno}>{labelTurno(asignacion.horario)}</Text>
            <Text style={styles.linea}>
              {asignacion.linea.codigo} · {asignacion.linea.nombre}
            </Text>
            <Text style={styles.ruta}>Ruta {asignacion.ruta.sentido}</Text>
            <Button
              loading={loading}
              onPress={() => void onSelect(asignacion.id)}
              style={styles.button}
            >
              Seleccionar turno
            </Button>
          </Card>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button
        variant="secondary"
        disabled={loading}
        onPress={onBack}
      >
        Volver a comenzar
      </Button>
    </ScrollView>
  );
}

function labelTurno(turno: ResumenAsignacionMovil['horario']): string {
  return { manana: 'Turno mañana', tarde: 'Turno tarde', noche: 'Turno noche' }[turno];
}

const styles = StyleSheet.create({
  content: { padding: quivoSpacing.xl, gap: quivoSpacing.xl, paddingBottom: quivoSpacing.xxxl },
  list: { gap: quivoSpacing.lg },
  turno: {
    color: quivoColors.primary,
    fontFamily: quivoFonts.displayBold,
    fontSize: 13,
    textTransform: 'uppercase',
  },
  linea: {
    color: quivoColors.text,
    fontFamily: quivoFonts.displaySemiBold,
    fontSize: 19,
    marginTop: quivoSpacing.sm,
  },
  ruta: {
    color: quivoColors.textSecondary,
    fontFamily: quivoFonts.bodyRegular,
    fontSize: 13,
    marginTop: quivoSpacing.xs,
  },
  button: { marginTop: quivoSpacing.lg },
  error: { color: quivoColors.danger, fontFamily: quivoFonts.bodyMedium, fontSize: 13 },
});
