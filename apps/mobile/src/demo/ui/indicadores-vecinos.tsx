import { StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { quivoColors, quivoFonts, quivoSpacing } from '../../shared/theme/quivo-theme';
import type { VecinoDemo } from '../motor';
import { FOTOS_TRUFI } from '../datos/fotos.generated';
import { DemoAvatarRedondo } from './demo-avatar';
import { formatearDistanciaVecinoDemo, formatearHoraDemo } from './formato-demo';

export interface IndicadoresVecinosDemoProps {
  adelante?: VecinoDemo;
  atras?: VecinoDemo;
  /** `LINEAS_MOCK[lineaPropiaId].color` — ambos vecinos son siempre de la línea propia. */
  colorLinea: string;
}

/**
 * "Puede consultar en el mapa qué vehículos van delante y detrás de él" (guion E06 03:16) — la
 * pieza clave del pedido del CTO. Dos tarjetas glass lado a lado (nunca apiladas a todo el ancho:
 * a 360-412dp de ancho de teléfono siguen entrando cómodas una junto a la otra), bajo la tarjeta
 * de identidad del top overlay (`operation-screen.tsx`, ver `docs/plan-apk-demo-conductor.md`,
 * paso B).
 *
 * FIX POST-REVISIÓN (hallazgo en teléfono real, 1080×2400 / ~392dp de ancho): la versión anterior
 * metía "a {distancia} · ~{min} min" (o "En cola · sale {hora}") en UNA sola fila horizontal —
 * a 392dp de ancho de tarjeta (~176dp cada una en la fila de 2) ese texto no entraba entero y
 * `numberOfLines={1}` lo truncaba a la mitad de una palabra ("~11 min" quedaba en "~11 m", que se
 * lee como METROS en vez de minutos; "En cola · sale 22:53" quedaba en "En cola · sale 22…").
 * Ahora cada dato vive en su PROPIA línea (etiqueta / placa / dato principal / dato secundario) —
 * ninguna línea individual se acerca al ancho de la tarjeta a 360-412dp. `numberOfLines={1}` se
 * MANTIENE en cada `Text` como red de seguridad barata (no debería disparar nunca a este ancho,
 * pero si algún día lo hace, corta la línea en vez de empujar el layout de la tarjeta);
 * `adjustsFontSizeToFit` sí queda sin usarse — se dejaría para un ancho todavía más angosto que
 * no es el objetivo acá.
 * `fontVariant: tabular-nums` en los dígitos evita que el ANCHO del propio dígito salte entre
 * ticks (dígitos proporcionales vs. tabulares), aunque al estar cada dato en su línea ya no hay
 * ningún hermano al que correr.
 */
export function IndicadoresVecinosDemo({ adelante, atras, colorLinea }: IndicadoresVecinosDemoProps) {
  return (
    <View style={styles.fila}>
      <TarjetaVecino direccion="adelante" vecino={adelante} colorLinea={colorLinea} />
      <TarjetaVecino direccion="atras" vecino={atras} colorLinea={colorLinea} />
    </View>
  );
}

function TarjetaVecino({
  direccion,
  vecino,
  colorLinea,
}: {
  direccion: 'adelante' | 'atras';
  vecino?: VecinoDemo;
  colorLinea: string;
}) {
  const etiqueta = direccion === 'adelante' ? 'Adelante' : 'Atrás';
  const icono = direccion === 'adelante' ? 'arrow-up' : 'arrow-down';

  if (!vecino) {
    return (
      <BlurView intensity={80} tint="light" style={[styles.tarjeta, styles.tarjetaVacia]}>
        <View style={styles.encabezado}>
          <Ionicons name={icono} size={12} color={quivoColors.textSecondary} />
          <Text style={styles.etiqueta}>{etiqueta}</Text>
        </View>
        <Text style={styles.vacioTexto}>
          {direccion === 'adelante' ? 'Sin unidad adelante' : 'Sin unidad atrás'}
        </Text>
      </BlurView>
    );
  }

  return (
    <BlurView intensity={80} tint="light" style={styles.tarjeta}>
      <DemoAvatarRedondo fotoUri={FOTOS_TRUFI[vecino.trufiId]} colorAnillo={colorLinea} tamano={34} />
      <View style={styles.textos}>
        <View style={styles.encabezado}>
          <Ionicons name={icono} size={12} color={quivoColors.textSecondary} />
          <Text style={styles.etiqueta}>{etiqueta}</Text>
        </View>
        <Text numberOfLines={1} style={styles.placa}>
          {vecino.placa}
        </Text>
        {vecino.enCola ? (
          <>
            <Text numberOfLines={1} style={styles.distancia}>
              En cola
            </Text>
            {vecino.saleA ? (
              <Text numberOfLines={1} style={styles.eta}>
                sale {formatearHoraDemo(vecino.saleA)}
              </Text>
            ) : null}
          </>
        ) : (
          <>
            <Text numberOfLines={1} style={styles.distancia}>
              {formatearDistanciaVecinoDemo(vecino.distanciaM)}
            </Text>
            <Text numberOfLines={1} style={styles.eta}>
              ~{Math.max(1, Math.round(vecino.minutos))} min
            </Text>
          </>
        )}
      </View>
    </BlurView>
  );
}

const styles = StyleSheet.create({
  fila: {
    flexDirection: 'row',
    gap: quivoSpacing.sm,
  },
  tarjeta: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.86)',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.8)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    // 4 líneas apiladas ahora (etiqueta/placa/dato principal/dato secundario, ver el docblock de
    // arriba) en vez de las 3 de antes — minHeight subido de 58 a 76 para que entren sin recortar
    // y para que la tarjeta vacía (sin vecino, 2 líneas) siga midiendo lo mismo que su par.
    minHeight: 76,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  tarjetaVacia: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 3,
  },
  textos: { flex: 1, minWidth: 0 },
  encabezado: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  etiqueta: {
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 9,
    letterSpacing: 0.5,
    color: quivoColors.textSecondary,
    textTransform: 'uppercase',
  },
  placa: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 16,
    lineHeight: 19,
    color: '#3127B1',
    fontVariant: ['tabular-nums'],
    marginTop: 1,
  },
  distancia: {
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 16,
    lineHeight: 19,
    color: '#334155',
    fontVariant: ['tabular-nums'],
    marginTop: 1,
  },
  eta: {
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 10.5,
    lineHeight: 13,
    color: quivoColors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  vacioTexto: {
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 11,
    color: quivoColors.textMuted,
  },
});
