import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, Switch, Pressable, Platform, ToastAndroid, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ContextoOperativoMovil } from '@quivo/shared';
import type { OperationStackParamList } from '../../app/operation-navigator';
import { useOperacionSettings, useTextScale, type OperacionSettings } from './use-operacion-settings';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../../shared/theme/quivo-theme';
import { useGpsContext } from '../operacion/gps-provider';
import { Button } from '../../shared/components/Button';
import { QuivoConfirmDialog } from '../../shared/components/quivo-confirm-dialog';
import {
  contarPuntosRescatablesDia1,
  guardarResultadoRescate,
  obtenerResultadoRescateGuardado,
  rescatarPuntosDia1,
  type ProgresoRescateDia1,
  type ResultadoRescateGuardado,
} from './rescate-dia1';
import logo from '../../../assets/images/logo.png';

type AjustesScreenProps = NativeStackScreenProps<OperationStackParamList, 'Ajustes'> & {
  /** H5 (hallazgo de revisión, rescate del día 1): la misma sesión que `OperationNavigator` ya
   * le pasa a `OperationScreen`/`PerfilScreen` — la usamos para mostrar EXPLÍCITAMENTE, en el
   * diálogo de confirmación de abajo, a qué sesión se van a atribuir los puntos rescatados. */
  contexto: ContextoOperativoMovil;
};

export function AjustesScreen({ navigation, contexto }: AjustesScreenProps) {
  const { settings, isLoaded, updateSetting } = useOperacionSettings();
  const { gps } = useGpsContext();
  const scale = useTextScale();

  // Rescate del día 1 (build de rescate): estado local de la sección de abajo. Vive acá y no
  // en un hook aparte porque es una acción de una sola vez, sin necesidad de compartirse con
  // el resto de la pantalla.
  const [conteoRescatable, setConteoRescatable] = useState<number | null>(null);
  const [cargandoConteo, setCargandoConteo] = useState(true);
  const [rescatando, setRescatando] = useState(false);
  const [progresoRescate, setProgresoRescate] = useState<ProgresoRescateDia1 | null>(null);
  const [errorRescate, setErrorRescate] = useState<string | null>(null);
  // H2 (hallazgo de revisión, alto): marca persistida de "ya se ejecutó" — sin esto, nada
  // impedía una segunda corrida (el botón vuelve a `disabled: false` en cuanto termina la
  // primera, con el mismo `conteoRescatable` viejo en pantalla).
  const [resultadoGuardado, setResultadoGuardado] = useState<ResultadoRescateGuardado | null>(null);
  const [cargandoResultadoGuardado, setCargandoResultadoGuardado] = useState(true);
  const [confirmVisible, setConfirmVisible] = useState(false);
  // A2 (hallazgo de revisión, alto): guard reentrante SÍNCRONO. `rescatando` (state) es
  // asíncrono — un doble tap en el mismo tick lee el mismo valor viejo dos veces antes de que
  // el primer `setRescatando(true)` se refleje, así que por sí solo NO alcanza para bloquear
  // la segunda invocación. El `Modal` de `QuivoConfirmDialog` usa `animationType="fade"` y
  // sigue montado y táctil durante el fade-out, lo que hace el doble tap más fácil de
  // gatillar de lo habitual (el botón de confirmar sigue "vivo" un instante extra).
  const rescatandoRef = useRef(false);

  useEffect(() => {
    let activo = true;
    setCargandoConteo(true);
    contarPuntosRescatablesDia1()
      .then((total) => {
        if (activo) setConteoRescatable(total);
      })
      .catch(() => {
        // Solo lectura, best-effort: si falla, el botón de abajo queda deshabilitado (no hay
        // conteo confirmado) pero el resto de Ajustes sigue funcionando con normalidad.
        if (activo) setConteoRescatable(null);
      })
      .finally(() => {
        if (activo) setCargandoConteo(false);
      });
    return () => {
      activo = false;
    };
  }, []);

  useEffect(() => {
    let activo = true;
    setCargandoResultadoGuardado(true);
    obtenerResultadoRescateGuardado()
      .then((resultado) => {
        if (activo) setResultadoGuardado(resultado);
      })
      .catch(() => {
        if (activo) setResultadoGuardado(null);
      })
      .finally(() => {
        if (activo) setCargandoResultadoGuardado(false);
      });
    return () => {
      activo = false;
    };
  }, []);

  const ejecutarRescate = () => {
    // A2: guard reentrante síncrono — ver el comentario de `rescatandoRef` arriba.
    if (rescatandoRef.current) return;
    rescatandoRef.current = true;
    setRescatando(true);
    setErrorRescate(null);
    setProgresoRescate(null);
    rescatarPuntosDia1((progreso) => setProgresoRescate(progreso))
      .then(async (resultado) => {
        setProgresoRescate(resultado);
        try {
          setResultadoGuardado(await guardarResultadoRescate(resultado));
        } catch (error) {
          // Best-effort (H2): si no se pudo persistir la marca, el botón principal queda
          // habilitado de nuevo (mismo comportamiento que antes de este fix) — no bloqueamos
          // el aviso de éxito por esto, el rescate en sí ya terminó bien.
          console.error('[QUIVO][ajustes] No se pudo guardar el resultado del rescate', error);
        }
        showToast(`Rescate completo: ${resultado.encolados} encolados${resumenExtra(resultado)}.`);
        // H2: re-consultar el conteo para no dejar en pantalla un número que ya no refleja lo
        // que queda en la SQLite nativa del SDK.
        try {
          setConteoRescatable(await contarPuntosRescatablesDia1());
        } catch {
          setConteoRescatable(null);
        }
      })
      .catch((error) => {
        setErrorRescate(
          error instanceof Error ? error.message : 'No se pudo completar el rescate.',
        );
      })
      .finally(() => {
        rescatandoRef.current = false;
        setRescatando(false);
      });
  };

  const abrirConfirmacion = () => setConfirmVisible(true);
  const cancelarConfirmacion = () => setConfirmVisible(false);
  const confirmarRescate = () => {
    setConfirmVisible(false);
    ejecutarRescate();
  };

  // H5: atribución EXPLÍCITA y verificable antes de apretar — solo los campos que
  // `ContextoOperativoMovil` realmente trae (`sesionId`, `asignacion.fecha`,
  // `asignacion.horario`), sin inventar un campo de "hora de inicio" que el contexto no tiene.
  const sesionCorta = contexto.sesionId.slice(0, 8);
  const fechaAsignacion = formatearFechaAsignacion(contexto.asignacion.fecha);
  const turnoAsignacion = labelTurno(contexto.asignacion.horario);
  const atribucionMensaje = `Los puntos se van a atribuir a la sesión ${sesionCorta}… (asignación del ${fechaAsignacion}, ${turnoAsignacion}).`;
  const mensajeConfirmacion = resultadoGuardado
    ? `Ya se ejecutó este rescate el ${formatearFechaHora(resultadoGuardado.fechaIso)} · ${resultadoGuardado.encolados} puntos encolados${resumenExtra(resultadoGuardado)}. Volver a ejecutarlo es seguro: los puntos que ya se sincronizaron NO se duplican (el sistema los reconoce y descarta solo). ${atribucionMensaje}`
    : `Se van a copiar al outbox ${conteoRescatable ?? 0} puntos GPS que el dispositivo grabó pero todavía no se sincronizaron. No se borra nada del teléfono. ${atribucionMensaje}`;

  const handleToggle = (key: keyof OperacionSettings, value: boolean) => {
    // Regla especial: trabajarOffline requiere GPS activo (aunque en MVP asumiremos que está)
    if (key === 'trabajarOffline' && value === true && !gps.tracking) {
      showToast('Requiere GPS activo para funcionar offline completamente.');
    }
    updateSetting(key, value);
    showToast(`Preferencia actualizada.`);
  };

  const showToast = (message: string) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
    }
    // En iOS se podría implementar una barra Toast global, omitido por MVP.
  };

  if (!isLoaded) return null; // Un esqueleto rápido o nulo es aceptable mientras AsyncStorage lee (suele tardar 5ms)

  return (
    <View style={styles.container}>
      <View style={styles.headerTop}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={20} color={quivoColors.primaryStrong} />
          <Text style={styles.backText}>Perfil</Text>
        </Pressable>
        <Image
          source={logo}
          style={styles.logo}
          resizeMode="contain"
        />
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.screenTitle, { fontSize: 20 * scale }]} allowFontScaling={!settings.textoGrande}>Ajustes de operación</Text>

        <View style={styles.cardBlock}>
          <SettingToggleRow
            icon="volume-high-outline"
            title="Navegación por voz"
            description="Indicaciones habladas durante el recorrido."
            helper="Requiere permisos de audio."
            value={settings.navegacionVoz}
            onToggle={(v) => handleToggle('navegacionVoz', v)}
          />
          <SettingToggleRow
            icon="notifications-outline"
            title="Sonido de confirmación"
            description="Una campanita al registrar un punto de control, para saber que quedó registrado sin mirar la pantalla."
            helper="Suena aunque el teléfono esté en silencio."
            value={settings.sonidoConfirmacion}
            onToggle={(v) => handleToggle('sonidoConfirmacion', v)}
          />
          <SettingToggleRow
            icon="shield-checkmark-outline"
            title="Registro automático de controles"
            description="El registro se realiza de forma automática y segura."
            helper="Próximamente: Validación manual."
            badge="AUTOMÁTICO"
            value={settings.registroAutomatico}
            onToggle={(v) => handleToggle('registroAutomatico', v)}
            disabled={true}
          />
          <SettingToggleRow
            icon="cellular-outline"
            title="Modo ahorro de datos"
            description="Reduce el consumo de datos móviles en segundo plano."
            helper="Útil con planes limitados."
            value={settings.ahorroDatos}
            onToggle={(v) => handleToggle('ahorroDatos', v)}
          />
          <SettingToggleRow
            icon="cloud-offline-outline"
            title="Trabajar offline"
            description="Permite operar sin conexión. Los datos se guardan para sincronizar después."
            helper="Requiere GPS activo."
            badge="ACTIVO"
            badgeColor={quivoColors.success}
            value={settings.trabajarOffline}
            onToggle={(v) => handleToggle('trabajarOffline', v)}
          />
          <SettingToggleRow
            icon="text-outline"
            title="Texto grande"
            description="Aumenta el tamaño del texto para mejor legibilidad."
            helper="Útil en condiciones de luz solar."
            value={settings.textoGrande}
            onToggle={(v) => handleToggle('textoGrande', v)}
            noBorder
          />
        </View>

        <Text style={[styles.screenTitle, { fontSize: 16 * scale, marginTop: quivoSpacing.lg }]} allowFontScaling={!settings.textoGrande}>
          Rescate de datos — día 1
        </Text>
        <View style={styles.cardBlock}>
          <View style={styles.rescateRow}>
            <Ionicons name="medkit-outline" size={24} color={quivoColors.primaryStrong} style={styles.rowIcon} />
            <View style={styles.rowTextContent}>
              <Text style={[styles.title, { fontSize: 15 * scale }]} allowFontScaling={!settings.textoGrande}>
                Recuperar recorrido no sincronizado
              </Text>
              <Text style={[styles.description, { fontSize: 14 * scale }]} allowFontScaling={!settings.textoGrande}>
                Copia al outbox los puntos GPS que el dispositivo grabó pero todavía no se
                sincronizaron. No borra nada del teléfono.
              </Text>
            </View>
          </View>

          {cargandoConteo || cargandoResultadoGuardado ? (
            <View style={styles.rescateConteoRow}>
              <Text style={[styles.helper, { fontSize: 13 * scale }]} allowFontScaling={!settings.textoGrande}>
                Consultando estado del rescate…
              </Text>
            </View>
          ) : resultadoGuardado ? (
            // H2 (hallazgo de revisión, alto): con una marca ya guardada, el botón principal
            // queda deshabilitado — la única forma de volver a correrlo es este enlace
            // secundario, que pasa por la MISMA confirmación explícita de abajo (H5).
            <View style={styles.rescateConteoRow}>
              <Text style={[styles.helper, { fontSize: 13 * scale }]} allowFontScaling={!settings.textoGrande}>
                Ya se ejecutó el {formatearFechaHora(resultadoGuardado.fechaIso)} ·{' '}
                {resultadoGuardado.encolados} puntos encolados
                {resumenExtra(resultadoGuardado)}
              </Text>
              <Button
                variant="link"
                size="sm"
                onPress={abrirConfirmacion}
                disabled={rescatando}
                style={styles.rescateEjecutarDeNuevo}
              >
                Ejecutar de nuevo
              </Button>
            </View>
          ) : (
            <>
              <View style={styles.rescateConteoRow}>
                <Text style={[styles.helper, { fontSize: 13 * scale }]} allowFontScaling={!settings.textoGrande}>
                  {conteoRescatable === null
                    ? 'No se pudo consultar el almacenamiento del GPS.'
                    : `${conteoRescatable} puntos disponibles para rescatar.`}
                </Text>
              </View>
              <Button
                variant="primary"
                onPress={abrirConfirmacion}
                loading={rescatando}
                disabled={rescatando || !conteoRescatable}
                fullWidth
                style={styles.rescateBoton}
              >
                {rescatando ? 'Rescatando…' : 'Rescatar puntos ahora'}
              </Button>
            </>
          )}

          {progresoRescate && (
            <Text style={[styles.helper, { fontSize: 13 * scale }]} allowFontScaling={!settings.textoGrande}>
              Encolados {progresoRescate.encolados} de {progresoRescate.total}
              {resumenExtra(progresoRescate)}
            </Text>
          )}

          {errorRescate && (
            <Text style={[styles.rescateError, { fontSize: 13 * scale }]} allowFontScaling={!settings.textoGrande}>
              {errorRescate}
            </Text>
          )}
        </View>
      </ScrollView>

      <QuivoConfirmDialog
        visible={confirmVisible}
        title={resultadoGuardado ? 'Ejecutar el rescate de nuevo' : 'Confirmar rescate de puntos'}
        message={mensajeConfirmacion}
        confirmLabel="Rescatar"
        cancelLabel="Cancelar"
        variant={resultadoGuardado ? 'danger' : 'default'}
        icon="medkit-outline"
        onConfirm={confirmarRescate}
        onCancel={cancelarConfirmacion}
        confirmDisabled={rescatando}
      />
    </View>
  );
}

/** H5: mapeo de `Turno` (`@quivo/shared`) al mismo texto que ya usa
 * `assignment-selection-screen.tsx` — duplicado a propósito (3 entradas, ningún lugar común
 * entre auth y ajustes para compartirlo sin acoplar dos features que hoy no se conocen). */
function labelTurno(turno: ContextoOperativoMovil['asignacion']['horario']): string {
  return { manana: 'turno mañana', tarde: 'turno tarde', noche: 'turno noche' }[turno];
}

/** "YYYY-MM-DD" (`asignacion.fecha`, ver `ContextoOperativoMovilSchema`) -> "DD/MM/YYYY". */
function formatearFechaAsignacion(fechaIso: string): string {
  const [anio, mes, dia] = fechaIso.split('-');
  return `${dia}/${mes}/${anio}`;
}

/** ISO completo -> "DD/MM a las HH:MM", mismo locale (`es-BO`) que el resto de la app usa para
 * fechas/horas legibles (ver `control-feedback-toast.tsx`). */
function formatearFechaHora(fechaIso: string): string {
  const fecha = new Date(fechaIso);
  if (Number.isNaN(fecha.getTime())) return fechaIso;
  const dia = fecha.toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit' });
  const hora = fecha.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${dia} a las ${hora}`;
}

/**
 * A3/B1 (hallazgo de revisión): sufijo compartido con el desglose completo de un resultado de
 * rescate — `yaExistente` (B1, filas que `INSERT OR IGNORE` descartó por ser un re-run) y
 * `omitidosPorAntiguedad` (A3/C1/M4, puntos fuera de la tolerancia del servidor) se muestran
 * en la UI igual que `fallidos`, nunca se pierden en silencio. Un solo lugar para las tres
 * pantallas que muestran un resultado (`progresoRescate` en vivo, `resultadoGuardado`
 * persistido, y el mensaje de confirmación) — evita que se desincronicen entre sí. */
function resumenExtra(resultado: {
  yaExistente: number;
  fallidos: number;
  omitidosPorAntiguedad: number;
}): string {
  const partes: string[] = [];
  if (resultado.yaExistente > 0) partes.push(`${resultado.yaExistente} ya existentes`);
  if (resultado.fallidos > 0) partes.push(`${resultado.fallidos} fallidos`);
  if (resultado.omitidosPorAntiguedad > 0) {
    partes.push(`${resultado.omitidosPorAntiguedad} omitidos por antigüedad`);
  }
  return partes.length > 0 ? ` · ${partes.join(' · ')}` : '';
}

function SettingToggleRow({
  icon,
  title,
  description,
  helper,
  badge,
  badgeColor,
  value,
  onToggle,
  noBorder,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  helper?: string;
  badge?: string;
  badgeColor?: string;
  value: boolean;
  onToggle: (v: boolean) => void;
  noBorder?: boolean;
  disabled?: boolean;
}) {
  const { settings } = useOperacionSettings();
  const scale = useTextScale();
  return (
    <View style={[styles.row, !noBorder && styles.rowBorder, disabled && { opacity: 0.6 }]}>
      <Ionicons name={icon} size={24} color={quivoColors.primaryStrong} style={styles.rowIcon} />
      <View style={styles.rowTextContent}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { fontSize: 15 * scale }]} allowFontScaling={!settings.textoGrande}>{title}</Text>
          {badge && (
            <View style={[styles.badge, badgeColor ? { backgroundColor: badgeColor + '20' } : null]}>
              <Text style={[styles.badgeText, badgeColor ? { color: badgeColor } : null]}>{badge}</Text>
            </View>
          )}
        </View>
        <Text style={[styles.description, { fontSize: 14 * scale }]} allowFontScaling={!settings.textoGrande}>{description}</Text>
        {helper && <Text style={[styles.helper, { fontSize: 12 * scale }]} allowFontScaling={!settings.textoGrande}>{helper}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: quivoColors.border, true: quivoColors.primaryStrong }}
        thumbColor={Platform.OS === 'android' ? quivoColors.white : undefined}
        disabled={disabled}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FE' },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: quivoSpacing.xl + quivoSpacing.lg,
    paddingHorizontal: quivoSpacing.md,
    paddingBottom: quivoSpacing.sm,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: quivoSpacing.xs,
    width: 80,
  },
  backText: {
    color: quivoColors.primaryStrong,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 15,
    marginLeft: 4,
  },
  logo: {
    height: 20,
    width: 80,
  },
  scrollContent: { padding: quivoSpacing.lg, paddingBottom: 60 },
  screenTitle: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 20,
    color: quivoColors.primaryStrong,
    marginBottom: quivoSpacing.lg,
  },
  cardBlock: {
    backgroundColor: quivoColors.white,
    borderRadius: quivoRadius.lg,
    padding: quivoSpacing.sm,
    shadowColor: quivoColors.text,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: quivoSpacing.md,
    paddingHorizontal: quivoSpacing.xs,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: quivoColors.border,
  },
  rowIcon: {
    marginRight: quivoSpacing.sm,
  },
  rowTextContent: {
    flex: 1,
    paddingRight: quivoSpacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: quivoSpacing.sm,
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  title: {
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 15,
    color: quivoColors.primaryStrong,
  },
  badge: {
    backgroundColor: quivoColors.primarySubtle,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 10,
    color: quivoColors.primary,
  },
  description: {
    fontFamily: quivoFonts.bodyRegular,
    fontSize: 14,
    color: quivoColors.textSecondary,
    lineHeight: 18,
  },
  helper: {
    fontFamily: quivoFonts.bodyRegular,
    fontSize: 12,
    color: quivoColors.textMuted,
    marginTop: 2,
  },
  rescateRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: quivoSpacing.md,
    paddingHorizontal: quivoSpacing.xs,
  },
  rescateConteoRow: {
    paddingHorizontal: quivoSpacing.xs,
    paddingBottom: quivoSpacing.sm,
  },
  rescateError: {
    fontFamily: quivoFonts.bodyRegular,
    color: quivoColors.danger,
    paddingHorizontal: quivoSpacing.xs,
    paddingBottom: quivoSpacing.sm,
  },
  rescateBoton: {
    marginHorizontal: quivoSpacing.xs,
    marginBottom: quivoSpacing.xs,
  },
  rescateEjecutarDeNuevo: {
    alignSelf: 'flex-start',
    marginTop: quivoSpacing.xs,
  },
});
