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
        <View key={aviso.id} style={aviso.id === primero.id ? styles.visible : styles.oculto}>
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
  tono = 'neutral',
}: {
  icono: React.ComponentProps<typeof Ionicons>['name'];
  mensaje: string;
  accion?: string;
  onAccion?: () => void;
  onCerrar?: () => void;
  tono?: 'neutral' | 'warning';
}) {
  // Una acción larga ("Finalizar recorrido") le robaba ancho al texto y cortaba justo la
  // instrucción: con acción larga, el texto va entero arriba y la acción en su propia fila.
  const apilado = !!accion && !!onAccion && accion.length > 12;
  const botonAccion =
    accion && onAccion ? (
      <Button variant="ghost" size="md" onPress={onAccion} style={styles.accion}>
        {accion}
      </Button>
    ) : null;
  const botonCerrar = onCerrar ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Cerrar aviso"
      onPress={onCerrar}
      style={styles.cerrar}
    >
      <Ionicons name="close" size={20} color={dsColors.primaryText} />
    </Pressable>
  ) : null;
  return (
    <Burbuja
      direction={apilado ? 'column' : 'row'}
      style={[styles.fila, apilado && styles.apilado]}
    >
      <View style={styles.cuerpo}>
        <View style={[styles.icono, tono === 'warning' && styles.iconoWarning]}>
          <Ionicons
            name={icono}
            size={20}
            color={tono === 'warning' ? dsColors.warningText : dsColors.primaryText}
          />
        </View>
        <Text
          size="sm"
          accessibilityRole="alert"
          numberOfLines={apilado ? 4 : 2}
          style={styles.mensaje}
        >
          {mensaje}
        </Text>
        {apilado ? botonCerrar : null}
      </View>
      {apilado ? (
        <View style={styles.acciones}>{botonAccion}</View>
      ) : (
        <>
          {botonAccion}
          {botonCerrar}
        </>
      )}
    </Burbuja>
  );
}

const styles = StyleSheet.create({
  visible: { width: '100%' },
  oculto: { display: 'none' },
  fila: { width: '100%', alignItems: 'center' },
  apilado: { alignItems: 'stretch' },
  cuerpo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: quivoBubble.gap },
  acciones: { flexDirection: 'row', justifyContent: 'flex-end' },
  icono: {
    width: quivoBubble.touch,
    height: quivoBubble.touch,
    borderRadius: quivoBubble.innerRadius,
    backgroundColor: dsColors.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconoWarning: { backgroundColor: dsColors.warningSoft },
  mensaje: { flex: 1, minWidth: 0, color: dsColors.textPrimary },
  accion: { minHeight: quivoBubble.touch, borderRadius: quivoBubble.innerRadius },
  cerrar: {
    width: quivoBubble.touch,
    height: quivoBubble.touch,
    borderRadius: quivoBubble.innerRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
