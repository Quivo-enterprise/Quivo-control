import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Text } from '@quivo/design-system-native';
import { Burbuja } from '../../shared/components/burbuja';
import { dsColors } from '../../shared/theme/design-system';
import { quivoBubble } from '../../shared/theme/quivo-theme';

export interface AvisoDelSlot {
  id: string;
  prioridad: number;
  visible: boolean;
  contenido: ReactNode;
}

/** Un solo aviso ocupa la franja bajo la cabecera; los demás esperan su turno. */
export function SlotAvisos({ avisos }: { avisos: readonly AvisoDelSlot[] }) {
  const primero = avisos
    .filter((aviso) => aviso.visible)
    .reduce<AvisoDelSlot | null>(
      (actual, aviso) => (!actual || aviso.prioridad < actual.prioridad ? aviso : actual),
      null,
    );
  if (!primero) return null;
  return (
    <>
      {avisos.map((aviso) => (
        <View key={aviso.id} style={aviso.id === primero.id ? undefined : styles.oculto}>
          {aviso.contenido}
        </View>
      ))}
    </>
  );
}

/** Fila breve para avisos operativos; no permite cerrar uno que antes era bloqueante. */
export function AvisoEnSlot({
  icono,
  mensaje,
  accion,
  onAccion,
  onCerrar,
}: {
  icono: React.ComponentProps<typeof Ionicons>['name'];
  mensaje: string;
  accion?: string;
  onAccion?: () => void;
  onCerrar?: () => void;
}) {
  return (
    <Burbuja style={styles.fila}>
      <View style={styles.icono}>
        <Ionicons name={icono} size={20} color={dsColors.primaryText} />
      </View>
      <Text size="sm" accessibilityRole="alert" numberOfLines={1} style={styles.mensaje}>
        {mensaje}
      </Text>
      {accion && onAccion ? (
        <Button variant="ghost" size="md" onPress={onAccion} style={styles.accion}>
          {accion}
        </Button>
      ) : null}
      {onCerrar ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cerrar aviso"
          onPress={onCerrar}
          style={styles.cerrar}
        >
          <Ionicons name="close" size={20} color={dsColors.primaryText} />
        </Pressable>
      ) : null}
    </Burbuja>
  );
}

const styles = StyleSheet.create({
  oculto: { display: 'none' },
  fila: { width: '100%', alignItems: 'center' },
  icono: {
    width: quivoBubble.touch,
    height: quivoBubble.touch,
    borderRadius: quivoBubble.innerRadius,
    backgroundColor: dsColors.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mensaje: { flex: 1, color: dsColors.textPrimary },
  accion: { minHeight: quivoBubble.touch, borderRadius: quivoBubble.innerRadius },
  cerrar: {
    width: quivoBubble.touch,
    height: quivoBubble.touch,
    borderRadius: quivoBubble.innerRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
