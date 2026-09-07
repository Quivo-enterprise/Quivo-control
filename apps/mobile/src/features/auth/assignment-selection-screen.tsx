import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { resolverMarcaLinea, type ResumenAsignacionMovil } from '@quivo/shared';
import { Button } from '../../shared/components/Button';
import { Card } from '../../shared/components/Card';
import { formatHoraBolivia } from '../../shared/format-hora';
import { QuivoHeader } from '../../shared/components/quivo-header';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../../shared/theme/quivo-theme';

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
            style={[
              styles.assignmentCard,
              { borderTopColor: resolverMarcaLinea(asignacion.linea).secondary },
            ]}
            accessibilityLabel={`${asignacion.horario}, ${asignacion.linea.nombre}`}
          >
            <Text style={styles.turno}>{labelTurno(asignacion.horario)}</Text>
            {formatHoraBolivia(asignacion.horaSalida) ? (
              <Text style={styles.hora}>Salida {formatHoraBolivia(asignacion.horaSalida)}</Text>
            ) : null}
            <View
              style={[
                styles.lineBrand,
                { backgroundColor: resolverMarcaLinea(asignacion.linea).primary },
              ]}
            >
              {resolverMarcaLinea(asignacion.linea).logoUrl ? (
                <Image
                  source={{ uri: resolverMarcaLinea(asignacion.linea).logoUrl }}
                  style={styles.lineLogo}
                />
              ) : null}
              <Text style={[styles.lineCode, { color: resolverMarcaLinea(asignacion.linea).text }]}>
                {resolverMarcaLinea(asignacion.linea).shortName}
              </Text>
              <View style={styles.lineCopy}>
                <Text
                  numberOfLines={1}
                  style={[styles.linea, { color: resolverMarcaLinea(asignacion.linea).text }]}
                >
                  {asignacion.linea.nombre}
                </Text>
                {asignacion.linea.lema ? (
                  <Text
                    numberOfLines={1}
                    style={[styles.lineLema, { color: resolverMarcaLinea(asignacion.linea).text }]}
                  >
                    {asignacion.linea.lema}
                  </Text>
                ) : null}
              </View>
            </View>
            <View style={styles.lineMarkerRow}>
              <Text
                style={[
                  styles.lineMarker,
                  {
                    backgroundColor: resolverMarcaLinea(asignacion.linea).secondary,
                    color: resolverMarcaLinea(asignacion.linea).text,
                  },
                ]}
              >
                {resolverMarcaLinea(asignacion.linea).markerValue}
              </Text>
              {resolverMarcaLinea(asignacion.linea).roofSign ? (
                <Text numberOfLines={1} style={styles.lineRoofSign}>
                  {resolverMarcaLinea(asignacion.linea).roofSign}
                </Text>
              ) : null}
            </View>
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
  content: { padding: quivoSpacing.xl, gap: quivoSpacing.xl, paddingBottom: quivoSpacing.xxxl },
  list: { gap: quivoSpacing.lg },
  assignmentCard: { borderTopWidth: 4 },
  turno: {
    color: quivoColors.primary,
    fontFamily: quivoFonts.displayBold,
    fontSize: 13,
    textTransform: 'uppercase',
  },
  linea: {
    fontFamily: quivoFonts.displaySemiBold,
    fontSize: 19,
  },
  lineBrand: {
    borderRadius: quivoRadius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: quivoSpacing.md,
    marginTop: quivoSpacing.sm,
    padding: quivoSpacing.md,
  },
  lineCode: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 26,
  },
  lineLogo: { height: 34, width: 34, borderRadius: quivoRadius.sm },
  lineCopy: { flex: 1, minWidth: 0 },
  lineLema: {
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 11,
    marginTop: quivoSpacing.xs,
    opacity: 0.88,
  },
  lineMarkerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: quivoSpacing.sm,
    marginTop: quivoSpacing.sm,
  },
  lineMarker: {
    borderRadius: quivoRadius.pill,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 11,
    overflow: 'hidden',
    paddingHorizontal: quivoSpacing.sm,
    paddingVertical: quivoSpacing.xs,
  },
  lineRoofSign: {
    color: quivoColors.textSecondary,
    flex: 1,
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 11,
  },
  hora: {
    color: quivoColors.success,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 13,
    marginTop: quivoSpacing.xs,
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
