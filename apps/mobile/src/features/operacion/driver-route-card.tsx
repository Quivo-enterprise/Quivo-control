import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Badge, Heading, Text, fontStyle } from '@quivo/design-system-native';
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
  vecinos?: ReactNode;
}

export function DriverRouteCard({
  contexto,
  tracking,
  pausadoDesde,
  brand,
  onAbrirPerfil,
  fotoVehiculo,
  vecinos,
}: DriverRouteCardProps) {
  const estado = !tracking ? 'EN ESPERA' : pausadoDesde ? 'EN PAUSA' : 'EN RUTA';
  const salida = !tracking ? formatHoraBolivia(contexto.asignacion.horaSalida) : null;
  const enPausa = tracking && Boolean(pausadoDesde);
  const colorLinea = enPausa ? dsColors.warning : contexto.linea.color || brand.primary;

  if (tracking && vecinos !== undefined && vecinos !== null) {
    return (
      <View style={styles.tarjetaContenedor}>
        <Burbuja style={styles.tarjetaEnRuta}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Abrir perfil"
            onPress={onAbrirPerfil}
            style={[styles.columnaLinea, { backgroundColor: colorLinea }]}
          >
            <Heading
              size="2xl"
              style={[
                styles.codigoEnRuta,
                enPausa && styles.codigoEnPausa,
                fontStyle('display', '700'),
              ]}
            >
              {contexto.linea.codigo}
            </Heading>
            <Text
              size="xs"
              weight="semibold"
              numberOfLines={2}
              style={[styles.estadoEnRuta, enPausa && styles.estadoEnPausa]}
            >
              {estado}
            </Text>
          </Pressable>
          <View style={styles.vecinos}>{vecinos}</View>
        </Burbuja>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Abrir perfil"
      onPress={onAbrirPerfil}
      style={styles.tarjetaContenedor}
    >
      <Burbuja style={styles.tarjetaReposo}>
        <View style={[styles.insignia, { backgroundColor: colorLinea }]}>
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
        {!tracking ? fotoVehiculo : null}
      </Burbuja>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tarjetaContenedor: { width: '100%' },
  tarjetaEnRuta: { width: '100%', alignItems: 'stretch' },
  columnaLinea: {
    width: dsSpace['3xl'],
    height: 2 * (quivoBubble.touch + quivoBubble.padding) + quivoBubble.gap,
    borderRadius: quivoBubble.innerRadius,
    alignItems: 'center',
    justifyContent: 'center',
    gap: quivoBubble.gap,
    paddingHorizontal: quivoBubble.padding,
  },
  codigoEnRuta: {
    color: dsColors.textInverse,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  codigoEnPausa: { color: dsColors.warningText },
  estadoEnRuta: { width: '100%', color: dsColors.textInverse, textAlign: 'center' },
  estadoEnPausa: { color: dsColors.warningText },
  vecinos: { flex: 1, minWidth: 0, gap: quivoBubble.gap },
  tarjetaReposo: {
    width: '100%',
    height: quivoBubble.touch + 2 * dsSpace.md,
    flexDirection: 'row',
  },
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
