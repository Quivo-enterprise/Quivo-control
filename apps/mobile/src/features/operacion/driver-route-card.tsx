import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
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
  onAbrirPerfil?: () => void;
  fotoVehiculo?: ReactNode;
}

export function DriverRouteCard({
  contexto,
  tracking,
  pausadoDesde,
  brand,
  onAbrirPerfil,
  fotoVehiculo,
}: DriverRouteCardProps) {
  const estado = !tracking ? 'EN ESPERA' : pausadoDesde ? 'EN PAUSA' : 'EN RUTA';
  const salida = !tracking ? formatHoraBolivia(contexto.asignacion.horaSalida) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Abrir perfil"
      onPress={onAbrirPerfil}
      style={styles.tarjetaContenedor}
    >
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
            <Text size="sm" variant="secondary" style={styles.salida}>
              Salida {salida}
            </Text>
          ) : null}
        </View>
        {fotoVehiculo}
      </Burbuja>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tarjetaContenedor: { width: '100%' },
  tarjeta: { width: '100%', height: quivoBubble.touch + 2 * dsSpace.md },
  insignia: {
    width: quivoBubble.touch + 2 * quivoBubble.padding,
    alignSelf: 'stretch',
    borderRadius: quivoBubble.innerRadius,
    paddingHorizontal: dsSpace.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codigo: { fontSize: dsFontSize.lg },
  detalles: { gap: dsSpace.xs, flex: 1, minWidth: 0 },
  estadoFila: { flexDirection: 'row', alignItems: 'center', gap: dsSpace.xs },
  salida: { color: dsColors.textSecondary },
});
