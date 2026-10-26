import { memo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Heading, Text, fontStyle } from '@quivo/design-system-native';
import type { VecinoRuta } from '@quivo/shared';
import { Burbuja } from '../../shared/components/burbuja';
import { dsColors, dsFontSize, dsSpace } from '../../shared/theme/design-system';
import { quivoBubble } from '../../shared/theme/quivo-theme';
import { SiluetaVehiculo } from './silueta-vehiculo';
import {
  TEXTO_SIN_DATO,
  etiquetaAccesibleFila,
  estadoDistanciaVecino,
  etiquetaLado,
  distanciaHablada,
  textoDistancia,
  textoEdad,
  textoVacio,
  type EstadoDistanciaVecino,
  type EstadoFila,
  type Lado,
} from './estado-vecinos';
import { VecinoPerfilModal } from './vecino-perfil-modal';

interface Props {
  delante: EstadoFila;
  detras: EstadoFila;
  /** ms desde que se recibió el dato (para envejecer lo mostrado si hay pausa/offline). */
  transcurridoMs: number;
  /** Fallos de red seguidos: lo mostrado puede ser viejo, se avisa en un pie discreto. */
  sinActualizar: boolean;
}

// Semáforo de "Delante" (umbrales en `estado-vecinos.ts`); "Detrás" queda neutro.
const COLOR_SEMAFORO: Record<EstadoDistanciaVecino, { borde: string; texto: string }> = {
  normal: { borde: dsColors.success, texto: dsColors.textPrimary },
  atencion: { borde: dsColors.warning, texto: dsColors.warningText },
  alerta: { borde: dsColors.danger, texto: dsColors.danger },
};

function Fila({
  lado,
  estado,
  transcurridoMs,
}: {
  lado: Lado;
  estado: EstadoFila;
  transcurridoMs: number;
}) {
  const vecino = estado.tipo === 'vecino' ? estado.vecino : null;
  const nivel = lado === 'delante' && vecino ? estadoDistanciaVecino(vecino.distanciaM) : null;
  const semaforo = nivel ? COLOR_SEMAFORO[nivel] : null;
  const cerca = nivel === 'alerta';
  const atencion = nivel === 'atencion';
  return (
    <View
      style={[styles.fila, { borderColor: semaforo?.borde ?? dsColors.borderSubtle }]}
      accessible
      accessibilityLabel={etiquetaAccesibleFila(lado, estado, transcurridoMs)}
    >
      <Ionicons
        name={
          cerca
            ? 'alert-circle'
            : atencion
              ? 'warning'
              : lado === 'delante'
                ? 'arrow-up'
                : 'arrow-down'
        }
        size={20}
        color={cerca ? dsColors.danger : atencion ? dsColors.warningText : dsColors.primary}
      />
      {vecino ? (
        <View style={styles.datos}>
          <View style={styles.linea}>
            <View style={styles.placaBloque}>
              <Text size="sm" weight="semibold" variant="secondary">
                {etiquetaLado(lado).toUpperCase()}
              </Text>
              <Heading size="lg" numberOfLines={1}>
                {vecino.placa}
              </Heading>
            </View>
            <Text
              size="lg"
              weight="bold"
              style={[styles.distancia, semaforo && { color: semaforo.texto }]}
            >
              {textoDistancia(vecino.distanciaM)}
            </Text>
          </View>
          {cerca ? (
            <Text size="sm" weight="semibold" style={styles.alerta}>
              Vehículo de adelante demasiado cerca
            </Text>
          ) : (
            <Text size="sm" variant="secondary">
              {textoEdad(vecino.edadFixS, transcurridoMs)}
            </Text>
          )}
        </View>
      ) : (
        <Text size="sm" variant="secondary">
          {estado.tipo === 'nadie' ? textoVacio(lado) : TEXTO_SIN_DATO}
        </Text>
      )}
    </View>
  );
}

function FilaEnLinea({
  lado,
  estado,
  transcurridoMs,
  buscando,
  sinActualizar,
  onAbrirPerfil,
}: {
  lado: Lado;
  estado: EstadoFila;
  transcurridoMs: number;
  buscando: boolean;
  sinActualizar: boolean;
  onAbrirPerfil: (vecino: VecinoRuta, lado: Lado) => void;
}) {
  const vecino = estado.tipo === 'vecino' ? estado.vecino : null;
  const nivel = lado === 'delante' && vecino ? estadoDistanciaVecino(vecino.distanciaM) : null;
  const semaforo = nivel ? COLOR_SEMAFORO[nivel] : null;
  const contenido = (
    <>
      <SiluetaVehiculo
        tipo={vecino?.tipo ?? 'micro'}
        color={vecino?.color ?? ''}
        colorSecundario={vecino?.colorSecundario ?? null}
        fantasma={!vecino}
        ancho={56}
        alto={32}
      />
      <Text size="lg" numberOfLines={1} style={[styles.placaEnLinea, fontStyle('display', '700')]}>
        {vecino?.placa ?? '—'}
      </Text>
      {vecino ? (
        <Text
          size="sm"
          numberOfLines={1}
          style={[
            styles.distanciaEnLinea,
            fontStyle('body', '400'),
            { fontVariant: ['tabular-nums'] },
            semaforo && { color: nivel === 'normal' ? dsColors.success : semaforo.texto },
          ]}
        >
          {textoDistancia(vecino.distanciaM)}
        </Text>
      ) : null}
      <View style={styles.indicadorDerecha}>
        <Ionicons
          name={lado === 'delante' ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={dsColors.textSecondary}
        />
      </View>
      {sinActualizar ? <View style={styles.puntoDesactualizado} /> : null}
    </>
  );
  const estiloFila = [
    styles.filaEnLinea,
    { borderColor: semaforo?.borde ?? dsColors.borderSubtle },
    nivel && { borderWidth: 2 },
    nivel === 'alerta' && styles.filaEnAlerta,
  ];

  if (vecino) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Vehículo de ${lado === 'delante' ? 'adelante' : 'atrás'}, placa ${vecino.placa}, a ${distanciaHablada(vecino.distanciaM)}. Ver perfil`}
        onPress={() => onAbrirPerfil(vecino, lado)}
        style={({ pressed }) => [estiloFila, pressed && styles.filaPresionada]}
      >
        {contenido}
      </Pressable>
    );
  }

  return (
    <View
      style={estiloFila}
      accessible
      accessibilityLabel={
        buscando
          ? `${etiquetaLado(lado)}: buscando`
          : etiquetaAccesibleFila(lado, estado, transcurridoMs)
      }
    >
      {contenido}
    </View>
  );
}

/** Las dos filas permanecen visibles para mantener la altura de la barra durante la ruta. */
export const VecinosRutaFilas = memo(function VecinosRutaFilas({
  delante,
  detras,
  transcurridoMs,
  buscando = false,
  sinActualizar = false,
}: {
  delante: EstadoFila;
  detras: EstadoFila;
  transcurridoMs: number;
  buscando?: boolean;
  sinActualizar?: boolean;
}) {
  const [perfilAbierto, setPerfilAbierto] = useState<{ vecino: VecinoRuta; lado: Lado } | null>(
    null,
  );
  const vecinoVisibleAhora = perfilAbierto
    ? perfilAbierto.lado === 'delante'
      ? delante
      : detras
    : null;
  const vecinoPerfil =
    perfilAbierto &&
    vecinoVisibleAhora?.tipo === 'vecino' &&
    vecinoVisibleAhora.vecino.placa === perfilAbierto.vecino.placa
      ? { ...perfilAbierto.vecino, distanciaM: vecinoVisibleAhora.vecino.distanciaM }
      : (perfilAbierto?.vecino ?? null);

  return (
    <>
      <View style={styles.filasEnLinea}>
        <FilaEnLinea
          lado="delante"
          estado={delante}
          transcurridoMs={transcurridoMs}
          buscando={buscando}
          sinActualizar={sinActualizar}
          onAbrirPerfil={(vecino, lado) => setPerfilAbierto({ vecino: { ...vecino }, lado })}
        />
        <FilaEnLinea
          lado="detras"
          estado={detras}
          transcurridoMs={transcurridoMs}
          buscando={buscando}
          sinActualizar={sinActualizar}
          onAbrirPerfil={(vecino, lado) => setPerfilAbierto({ vecino: { ...vecino }, lado })}
        />
      </View>
      <VecinoPerfilModal
        visible={perfilAbierto !== null}
        vecino={vecinoPerfil}
        lado={perfilAbierto?.lado ?? null}
        onClose={() => setPerfilAbierto(null)}
      />
    </>
  );
});

/** Panel compacto "Delante / Detrás" de la pantalla de operación. */
export const VecinosRutaCard = memo(function VecinosRutaCard({
  delante,
  detras,
  transcurridoMs,
  sinActualizar,
}: Props) {
  return (
    <Burbuja direction="column" style={styles.card}>
      <Fila lado="delante" estado={delante} transcurridoMs={transcurridoMs} />
      <Fila lado="detras" estado={detras} transcurridoMs={transcurridoMs} />
      {sinActualizar ? (
        <Text size="sm" variant="secondary" accessibilityLiveRegion="polite">
          {`Sin actualizar · último dato ${textoEdad(0, transcurridoMs)}`}
        </Text>
      ) : null}
    </Burbuja>
  );
});

const styles = StyleSheet.create({
  card: { width: '100%', alignItems: 'stretch' },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: dsSpace.sm,
    minHeight: quivoBubble.touch,
    padding: dsSpace.sm,
    // Borde de 2 siempre presente (neutro en Detrás) para que las dos filas queden alineadas.
    borderWidth: 2,
    borderRadius: quivoBubble.innerRadius,
    backgroundColor: dsColors.surfaceRaised,
  },
  datos: { flex: 1, minWidth: 0, gap: dsSpace.xs },
  linea: { flexDirection: 'row', alignItems: 'center', gap: dsSpace.sm },
  placaBloque: { flex: 1, minWidth: 0 },
  distancia: { color: dsColors.textPrimary, fontVariant: ['tabular-nums'] },
  alerta: { color: dsColors.danger },
  filasEnLinea: { width: '100%', gap: quivoBubble.gap },
  filaEnLinea: {
    width: '100%',
    height: quivoBubble.touch + quivoBubble.padding,
    flexDirection: 'row',
    alignItems: 'center',
    gap: quivoBubble.gap,
    paddingHorizontal: quivoBubble.padding,
    borderWidth: 1,
    borderRadius: quivoBubble.innerRadius,
    backgroundColor: dsColors.surfaceSoft,
  },
  filaPresionada: { backgroundColor: dsColors.primarySubtle },
  placaEnLinea: {
    flex: 1,
    minWidth: 0,
    color: dsColors.textPrimary,
    fontSize: 20,
  },
  distanciaEnLinea: {
    color: dsColors.textPrimary,
    fontSize: dsFontSize.sm,
    fontVariant: ['tabular-nums'],
  },
  indicadorDerecha: {
    width: dsSpace.xl,
    height: dsSpace.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filaEnAlerta: { backgroundColor: dsColors.dangerSoft },
  puntoDesactualizado: {
    position: 'absolute',
    top: quivoBubble.padding,
    right: quivoBubble.padding,
    width: quivoBubble.padding / 2,
    height: quivoBubble.padding / 2,
    borderRadius: quivoBubble.padding / 2,
    backgroundColor: dsColors.warning,
  },
});
