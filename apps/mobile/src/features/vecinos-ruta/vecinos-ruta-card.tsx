import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { quivoColors, quivoFonts, quivoRadius } from '../../shared/theme/quivo-theme';
import { SiluetaVehiculo } from './silueta-vehiculo';
import {
  TEXTO_SIN_DATO,
  etiquetaAccesibleFila,
  etiquetaLado,
  textoDistancia,
  textoEdad,
  textoVacio,
  type EstadoFila,
  type Lado,
} from './estado-vecinos';

interface Props {
  delante: EstadoFila;
  detras: EstadoFila;
  /** ms desde que se recibió el dato (para envejecer lo mostrado si hay pausa/offline). */
  transcurridoMs: number;
  /** Fallos de red seguidos: lo mostrado puede ser viejo, se avisa en un pie discreto. */
  sinActualizar: boolean;
}

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
  return (
    <View
      style={styles.fila}
      accessible
      accessibilityLabel={etiquetaAccesibleFila(lado, estado, transcurridoMs)}
    >
      <View style={[styles.chevron, !vecino && styles.chevronVacio]}>
        <Ionicons
          name={lado === 'delante' ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={vecino ? quivoColors.primary : quivoColors.textMuted}
        />
      </View>
      <SiluetaVehiculo
        tipo={vecino?.tipo ?? ''}
        color={vecino?.color ?? ''}
        colorSecundario={vecino?.colorSecundario ?? null}
        fantasma={!vecino}
      />
      {vecino ? (
        <>
          <View style={styles.texto}>
            <Text style={styles.placa} numberOfLines={1}>
              {vecino.placa}
              {vecino.numeroInterno ? (
                <Text style={styles.interno}>{`  #${vecino.numeroInterno}`}</Text>
              ) : null}
            </Text>
            <Text style={styles.edad} numberOfLines={1}>
              {etiquetaLado(lado)} · {textoEdad(vecino.edadFixS, transcurridoMs)}
            </Text>
          </View>
          <Text style={styles.distancia}>{textoDistancia(vecino.distanciaM)}</Text>
        </>
      ) : estado.tipo === 'nadie' ? (
        <Text style={styles.vacio}>{textoVacio(lado)}</Text>
      ) : (
        <Text style={styles.sinDato}>{TEXTO_SIN_DATO}</Text>
      )}
    </View>
  );
}

/** Panel compacto "Delante / Detrás" de la pantalla de operación. */
export const VecinosRutaCard = memo(function VecinosRutaCard({
  delante,
  detras,
  transcurridoMs,
  sinActualizar,
}: Props) {
  return (
    <BlurView intensity={100} tint="light" style={styles.card}>
      <Fila lado="delante" estado={delante} transcurridoMs={transcurridoMs} />
      <View style={styles.separador} />
      <Fila lado="detras" estado={detras} transcurridoMs={transcurridoMs} />
      {sinActualizar ? (
        <>
          <View style={styles.separador} />
          <Text style={styles.pie} accessibilityLiveRegion="polite">
            {`Sin actualizar · último dato ${textoEdad(0, transcurridoMs)}`}
          </Text>
        </>
      ) : null}
    </BlurView>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: quivoRadius.lg,
    overflow: 'hidden',
    paddingHorizontal: 12,
    backgroundColor: quivoColors.glassSurfaceStrong,
    borderWidth: 1,
    borderColor: quivoColors.glassBorder,
  },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
  },
  separador: { height: 1, backgroundColor: quivoColors.glassDivider },
  chevron: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: quivoColors.primarySubtle,
  },
  chevronVacio: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: quivoColors.textMuted,
  },
  texto: { flex: 1, minWidth: 0, gap: 1 },
  placa: {
    color: quivoColors.text,
    fontFamily: quivoFonts.mono,
    fontSize: 14,
    fontWeight: '700',
  },
  interno: {
    color: quivoColors.textSecondary,
    fontFamily: quivoFonts.mono,
    fontSize: 12,
  },
  edad: {
    color: quivoColors.textSecondary,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 12,
  },
  distancia: {
    color: quivoColors.text,
    fontFamily: quivoFonts.displayBold,
    fontSize: 22,
    textAlign: 'right',
  },
  vacio: {
    flex: 1,
    color: quivoColors.textSecondary,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 14,
  },
  sinDato: {
    flex: 1,
    color: quivoColors.textMuted,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 14,
  },
  pie: {
    color: quivoColors.textMuted,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 11,
    paddingVertical: 6,
  },
});
