import { StyleSheet, View } from 'react-native';
import { Badge, Text } from '@quivo/design-system-native';
import type { ContextoOperativoMovil, LineaBrand } from '@quivo/shared';
import { Burbuja } from '../../shared/components/burbuja';
import { formatHoraBolivia } from '../../shared/format-hora';
import { dsColors, dsFontSize, dsSpace } from '../../shared/theme/design-system';
import { quivoBubble } from '../../shared/theme/quivo-theme';

export interface DriverRouteCardProps {
  contexto: ContextoOperativoMovil;
  brand: LineaBrand;
  tracking: boolean;
  pausadoDesde?: string | null;
  compacta?: boolean;
}

export function DriverRouteCard({ contexto, tracking, pausadoDesde, brand }: DriverRouteCardProps) {
  const estado = !tracking ? 'EN ESPERA' : pausadoDesde ? 'EN PAUSA' : 'EN RUTA';
  const salida = !tracking ? formatHoraBolivia(contexto.asignacion.horaSalida) : null;
  return (
    <Burbuja style={styles.tarjeta}>
      <View style={[styles.insignia, { backgroundColor: contexto.linea.color || brand.primary }]}>
        <Text weight="bold" style={[styles.codigo, { color: brand.text }]}>
          {contexto.linea.codigo}
        </Text>
      </View>
      <View style={styles.detalles}>
        <View style={styles.estadoFila}>
          <Badge variant={!tracking ? 'primary' : pausadoDesde ? 'warning' : 'success'} size="sm">
            {estado}
          </Badge>
        </View>
        {salida ? (
          <Text size="sm" style={styles.salida}>
            Salida {salida}
          </Text>
        ) : null}
      </View>
    </Burbuja>
  );
}

const styles = StyleSheet.create({
  tarjeta: { maxWidth: '100%' },
  insignia: {
    minWidth: quivoBubble.touch,
    minHeight: quivoBubble.touch,
    borderRadius: quivoBubble.innerRadius,
    paddingHorizontal: dsSpace.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codigo: { fontSize: dsFontSize.lg },
  detalles: { gap: dsSpace.xs, flexShrink: 1 },
  estadoFila: { flexDirection: 'row', alignItems: 'center', gap: dsSpace.xs },
  salida: { color: dsColors.textSecondary },
});
