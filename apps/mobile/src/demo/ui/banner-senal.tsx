import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../../shared/theme/quivo-theme';
import type { EstadoSenalDemo } from '../motor';

export interface BannerSenalDemoProps {
  senal: EstadoSenalDemo;
  puntosPendientes: number;
  ultimaSincronizacion: number | null;
}

const MS_MOSTRAR_SINCRONIZADO = 3000;

/**
 * Banner de señal (guion E06 03:25, E08 05:42-06:01) — SOLO demo, montado desde
 * `operation-screen.tsx` con `MODO_DEMO && demo && <BannerSenalDemo .../>`. El producto real saca
 * a propósito los badges de estado de red de esta pantalla (`docs/estados-red-vs-captura.md`) —
 * este banner no es un regreso de esa decisión, es una pieza de grabación aparte.
 *
 * `sincronizando` no tiene una duración fija visible desde afuera (el motor la escala por
 * `velocidadDemo`, ver `MS_SINCRONIZANDO_BASE` en `../motor.ts`) — este componente solo reacciona
 * a los 3 estados de `EstadoSenalDemo` más una transición local: cuando `ultimaSincronizacion`
 * cambia (el motor terminó de "sincronizar"), muestra "Recorrido sincronizado" ~3s reales y
 * después vuelve a no mostrar nada, sin que el motor tenga que modelar ese estado transitorio.
 */
export function BannerSenalDemo({ senal, puntosPendientes, ultimaSincronizacion }: BannerSenalDemoProps) {
  const [mostrarSincronizado, setMostrarSincronizado] = useState(false);
  const primerRenderRef = useRef(true);

  useEffect(() => {
    if (primerRenderRef.current) {
      // No dispara al montar, aunque el motor ya traiga una `ultimaSincronizacion` de una sesión
      // anterior (no debería pasar hoy — el motor arranca en `senal: 'ok'` con
      // `ultimaSincronizacion: null` — pero esto lo hace robusto igual si eso cambia).
      primerRenderRef.current = false;
      return;
    }
    if (ultimaSincronizacion === null) return;
    setMostrarSincronizado(true);
    const id = setTimeout(() => setMostrarSincronizado(false), MS_MOSTRAR_SINCRONIZADO);
    return () => clearTimeout(id);
  }, [ultimaSincronizacion]);

  if (senal === 'sin_senal') {
    return (
      <View style={[styles.banner, styles.bannerWarning]}>
        <Ionicons name="cloud-offline-outline" size={16} color={quivoColors.warningText} />
        <View style={styles.textos}>
          <Text style={[styles.textoPrincipal, { color: quivoColors.warningText }]}>
            Sin conexión · guardando recorrido
          </Text>
          <Text style={[styles.textoSecundario, { color: quivoColors.warningText }]}>
            {puntosPendientes} puntos guardados
          </Text>
        </View>
      </View>
    );
  }

  if (senal === 'sincronizando') {
    return (
      <View style={[styles.banner, styles.bannerInfo]}>
        <ActivityIndicator size="small" color={quivoColors.primary} />
        <Text style={[styles.textoPrincipal, { color: quivoColors.navy }]}>
          Sincronizando {puntosPendientes} puntos…
        </Text>
      </View>
    );
  }

  if (mostrarSincronizado) {
    return (
      <View style={[styles.banner, styles.bannerSuccess]}>
        <Ionicons name="checkmark-circle-outline" size={16} color={quivoColors.success} />
        <Text style={[styles.textoPrincipal, { color: quivoColors.success }]}>Recorrido sincronizado</Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: quivoRadius.md,
    paddingVertical: 8,
    paddingHorizontal: quivoSpacing.md,
  },
  bannerWarning: {
    backgroundColor: quivoColors.warningSoft,
    borderWidth: 1,
    borderColor: quivoColors.warningBorder,
  },
  bannerInfo: {
    backgroundColor: quivoColors.syncingSoft,
    borderWidth: 1,
    borderColor: quivoColors.syncingBorder,
  },
  bannerSuccess: {
    backgroundColor: quivoColors.successSoft,
  },
  textos: { flex: 1 },
  textoPrincipal: {
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 11.5,
  },
  textoSecundario: {
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 10.5,
    fontVariant: ['tabular-nums'],
    marginTop: 1,
  },
});
