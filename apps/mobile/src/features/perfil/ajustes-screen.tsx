import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, Pressable, Platform, ToastAndroid } from 'react-native';
import { Divider, Heading, Switch, Text } from '@quivo/design-system-native';
import { dsColors, dsElevation, dsRadius, dsSpace } from '../../shared/theme/design-system';
import { quivoBubble } from '../../shared/theme/quivo-theme';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ContextoOperativoMovil } from '@quivo/shared';
import type { OperationStackParamList } from '../../app/operation-navigator';
import {
  useOperacionSettings,
  useTextScale,
  type OperacionSettings,
} from './use-operacion-settings';

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
        showToast(
          `Recorrido preparado: ${resultado.encolados} puntos listos para enviar${resumenExtra(resultado)}.`,
        );
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
    ? `Este recorrido se preparó el ${formatearFechaHora(resultadoGuardado.fechaIso)} · ${resultadoGuardado.encolados} puntos listos para enviar${resumenExtra(resultadoGuardado)}. Volver a prepararlo es seguro: los puntos que ya llegaron al servidor no se duplican. ${atribucionMensaje}`
    : `Se prepararán ${conteoRescatable ?? 0} puntos guardados en este teléfono para enviarlos cuando vuelva la conexión. No se borra nada del teléfono. ${atribucionMensaje}`;

  const handleToggle = (key: keyof OperacionSettings, value: boolean) => {
    // Regla especial: trabajarOffline requiere GPS activo (aunque en MVP asumiremos que está)
    if (key === 'trabajarOffline' && value === true && !gps.tracking) {
      showToast('Trabajar sin conexión necesita el GPS activo.');
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
        <AjustesHeader
          onBack={() => navigation.goBack()}
          scale={scale}
          textoGrande={settings.textoGrande}
        />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <SettingsGroup
          title="Durante el recorrido"
          scale={scale}
          textoGrande={settings.textoGrande}
        >
          <View style={styles.cardBlock}>
            <SettingToggleRow
              icon="volume-high-outline"
              title="Navegación por voz"
              description="Te dice las paradas y los avisos."
              value={settings.navegacionVoz}
              onToggle={(v) => handleToggle('navegacionVoz', v)}
            />
            <SettingToggleRow
              icon="notifications-outline"
              title="Sonido de confirmación"
              description="Una campanita al registrar cada punto."
              value={settings.sonidoConfirmacion}
              onToggle={(v) => handleToggle('sonidoConfirmacion', v)}
              noBorder
            />
          </View>
        </SettingsGroup>

        <SettingsGroup title="Pantalla" scale={scale} textoGrande={settings.textoGrande}>
          <View style={styles.cardBlock}>
            <SettingToggleRow
              icon="text-outline"
              title="Texto grande"
              description="Letras más grandes para leer al sol."
              value={settings.textoGrande}
              onToggle={(v) => handleToggle('textoGrande', v)}
              noBorder
            />
          </View>
        </SettingsGroup>

        <SettingsGroup title="Conexión" scale={scale} textoGrande={settings.textoGrande}>
          <View style={styles.cardBlock}>
            <SettingToggleRow
              icon="cloud-offline-outline"
              title="Trabajar sin conexión"
              description="Guarda todo y lo envía cuando vuelva la señal."
              value={settings.trabajarOffline}
              onToggle={(v) => handleToggle('trabajarOffline', v)}
            />
            <SettingToggleRow
              icon="cellular-outline"
              title="Ahorro de datos"
              description="Usa menos datos móviles en segundo plano."
              value={settings.ahorroDatos}
              onToggle={(v) => handleToggle('ahorroDatos', v)}
              noBorder
            />
          </View>
        </SettingsGroup>

        <SettingsGroup title="Registro de puntos" scale={scale} textoGrande={settings.textoGrande}>
          <View style={styles.cardBlock}>
            <InformativeRow
              icon="shield-checkmark"
              title="Automático"
              description="Cada punto se registra solo al pasar por él."
              scale={scale}
              textoGrande={settings.textoGrande}
            />
          </View>
        </SettingsGroup>

        {!cargandoConteo &&
        (conteoRescatable === null ||
          (conteoRescatable ?? 0) > 0 ||
          Boolean(resultadoGuardado) ||
          rescatando ||
          Boolean(progresoRescate) ||
          Boolean(errorRescate)) ? (
          <SettingsGroup title="Ayuda" scale={scale} textoGrande={settings.textoGrande}>
            <View style={styles.helpBubble}>
              <View style={styles.helpHeader}>
                <View style={styles.iconCircle}>
                  <Ionicons name="cloud-upload-outline" size={20} color={dsColors.primaryText} />
                </View>
                <View style={styles.rowTextContent}>
                  <Text
                    size="md"
                    weight="semibold"
                    style={[styles.title, scaled(16, scale)]}
                    allowFontScaling={!settings.textoGrande}
                  >
                    Enviar recorrido guardado
                  </Text>
                  <Text
                    size="sm"
                    variant="secondary"
                    numberOfLines={2}
                    style={scaled(14, scale)}
                    allowFontScaling={!settings.textoGrande}
                  >
                    {conteoRescatable === null
                      ? 'No se pudo consultar el recorrido guardado.'
                      : `Hay ${conteoRescatable} puntos de tu recorrido en el teléfono que todavía no se enviaron.`}
                  </Text>
                </View>
              </View>

              <Button
                variant="primary"
                onPress={abrirConfirmacion}
                loading={rescatando}
                disabled={rescatando || !conteoRescatable}
                fullWidth
                style={styles.rescateBoton}
              >
                <Text
                  weight="bold"
                  style={[{ color: dsColors.textInverse }, scaled(16, scale)]}
                  allowFontScaling={!settings.textoGrande}
                >
                  {rescatando ? 'Preparando…' : 'Enviar ahora'}
                </Text>
              </Button>

              {conteoRescatable === null ? (
                <RescueStatus warning scale={scale} textoGrande={settings.textoGrande}>
                  No se pudo consultar el recorrido guardado.
                </RescueStatus>
              ) : null}

              {cargandoResultadoGuardado ? (
                <RescueStatus scale={scale} textoGrande={settings.textoGrande}>
                  Consultando el recorrido guardado…
                </RescueStatus>
              ) : resultadoGuardado ? (
                // H2: se conserva la confirmación adicional antes de repetir el rescate ya registrado.
                <RescueStatus scale={scale} textoGrande={settings.textoGrande}>
                  Ya se preparó el {formatearFechaHora(resultadoGuardado.fechaIso)} ·{' '}
                  {resultadoGuardado.encolados} puntos listos para enviar
                  {resumenExtra(resultadoGuardado)}
                </RescueStatus>
              ) : null}

              {progresoRescate ? (
                <RescueStatus scale={scale} textoGrande={settings.textoGrande}>
                  Preparados para enviar {progresoRescate.encolados} de {progresoRescate.total}
                  {resumenExtra(progresoRescate)}
                </RescueStatus>
              ) : null}
              {errorRescate ? (
                <RescueStatus warning scale={scale} textoGrande={settings.textoGrande}>
                  {errorRescate.toLocaleLowerCase('es-BO').includes('sesión activa')
                    ? 'Vuelve a iniciar sesión para preparar los puntos guardados.'
                    : 'No se pudo preparar el recorrido. Inténtalo de nuevo.'}
                </RescueStatus>
              ) : null}
            </View>
          </SettingsGroup>
        ) : null}
      </ScrollView>

      <QuivoConfirmDialog
        visible={confirmVisible}
        title={resultadoGuardado ? 'Preparar el recorrido de nuevo' : 'Enviar recorrido guardado'}
        message={mensajeConfirmacion}
        confirmLabel="Enviar ahora"
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

function AjustesHeader({
  onBack,
  scale,
  textoGrande,
}: {
  onBack: () => void;
  scale: number;
  textoGrande: boolean;
}) {
  return (
    <View style={styles.headerRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Volver a Perfil"
        onPress={onBack}
        style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
      >
        <Ionicons name="arrow-back" size={20} color={dsColors.primaryText} />
      </Pressable>
      <Heading
        size="xl"
        numberOfLines={1}
        style={[styles.headerTitle, { fontSize: 22 * scale }]}
        allowFontScaling={!textoGrande}
      >
        Ajustes
      </Heading>
      <View style={styles.headerSpacer} />
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
  const hora = fecha.toLocaleTimeString('es-BO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
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
  if (resultado.yaExistente > 0) partes.push(`${resultado.yaExistente} ya estaban preparados`);
  if (resultado.fallidos > 0) partes.push(`${resultado.fallidos} no se pudieron preparar`);
  if (resultado.omitidosPorAntiguedad > 0) {
    partes.push(`${resultado.omitidosPorAntiguedad} puntos antiguos no se guardaron`);
  }
  return partes.length > 0 ? ` · ${partes.join(' · ')}` : '';
}

function SettingToggleRow({
  icon,
  title,
  description,
  value,
  onToggle,
  noBorder,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  value: boolean;
  onToggle: (v: boolean) => void;
  noBorder?: boolean;
}) {
  const { settings } = useOperacionSettings();
  const scale = useTextScale();
  return (
    <View>
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel={`${title}. ${description}`}
        accessibilityState={{ checked: value }}
        onPress={() => onToggle(!value)}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <View style={styles.iconCircle}>
          <Ionicons name={icon} size={20} color={dsColors.primaryText} />
        </View>
        <View style={styles.rowTextContent}>
          <Text
            size="md"
            weight="semibold"
            numberOfLines={1}
            style={[styles.title, scaled(16, scale)]}
            allowFontScaling={!settings.textoGrande}
          >
            {title}
          </Text>
          <Text
            size="sm"
            variant="secondary"
            numberOfLines={2}
            style={scaled(14, scale)}
            allowFontScaling={!settings.textoGrande}
          >
            {description}
          </Text>
        </View>
        <View pointerEvents="none" style={styles.switchSlot}>
          <Switch
            value={value}
            accessibilityLabel={title}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        </View>
      </Pressable>
      {!noBorder ? (
        <View style={styles.rowSeparator}>
          <Divider />
        </View>
      ) : null}
    </View>
  );
}

function SettingsGroup({
  title,
  scale,
  textoGrande,
  children,
}: {
  title: string;
  scale: number;
  textoGrande: boolean;
  children: ReactNode;
}) {
  return (
    <View style={styles.group}>
      <Text size="sm" variant="secondary" style={scaled(14, scale)} allowFontScaling={!textoGrande}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function InformativeRow({
  icon,
  title,
  description,
  scale,
  textoGrande,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  scale: number;
  textoGrande: boolean;
}) {
  return (
    <View style={styles.row}>
      <View style={[styles.iconCircle, styles.successIconCircle]}>
        <Ionicons name={icon} size={20} color={dsColors.success} />
      </View>
      <View style={styles.rowTextContent}>
        <Text
          size="md"
          weight="semibold"
          style={[styles.successTitle, scaled(16, scale)]}
          allowFontScaling={!textoGrande}
        >
          {title}
        </Text>
        <Text
          size="sm"
          variant="secondary"
          numberOfLines={2}
          style={scaled(14, scale)}
          allowFontScaling={!textoGrande}
        >
          {description}
        </Text>
      </View>
    </View>
  );
}

function RescueStatus({
  children,
  scale,
  textoGrande,
  warning = false,
}: {
  children: ReactNode;
  scale: number;
  textoGrande: boolean;
  warning?: boolean;
}) {
  return (
    <Text
      size="sm"
      variant={warning ? 'warning' : 'secondary'}
      style={[styles.rescueStatus, scaled(14, scale)]}
      allowFontScaling={!textoGrande}
    >
      {children}
    </Text>
  );
}

function scaled(fontSize: number, scale: number) {
  return { fontSize: fontSize * scale };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: dsColors.surfaceSoft },
  // App.tsx ya aplica SafeAreaView; el encabezado usa el mismo edge que Perfil.
  headerTop: {
    paddingTop: quivoBubble.edge,
    paddingHorizontal: quivoBubble.edge,
    paddingBottom: dsSpace.xs,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  backButton: {
    width: quivoBubble.touch,
    height: quivoBubble.touch,
    borderRadius: dsRadius.full,
    borderWidth: 1,
    borderColor: dsColors.primarySoft,
    backgroundColor: dsColors.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { flex: 1, textAlign: 'center' },
  headerSpacer: { width: quivoBubble.touch },
  pressed: { opacity: 0.7 },
  scrollContent: {
    paddingHorizontal: quivoBubble.edge,
    paddingTop: quivoBubble.edge,
    paddingBottom: quivoBubble.edge,
    gap: quivoBubble.gap,
  },
  group: { gap: dsSpace.xs },
  cardBlock: {
    backgroundColor: quivoBubble.surface,
    borderRadius: quivoBubble.radius,
    borderWidth: 1,
    borderColor: quivoBubble.border,
    padding: quivoBubble.padding,
    ...dsElevation(3),
  },
  helpBubble: {
    gap: quivoBubble.gap,
    backgroundColor: quivoBubble.surface,
    borderRadius: quivoBubble.radius,
    borderWidth: 1,
    borderColor: quivoBubble.border,
    padding: quivoBubble.padding,
    ...dsElevation(3),
  },
  helpHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: quivoBubble.gap,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: dsSpace['3xl'],
    gap: quivoBubble.gap,
    paddingVertical: dsSpace.xs,
  },
  rowPressed: { opacity: 0.78 },
  rowSeparator: {
    height: quivoBubble.gap,
    justifyContent: 'center',
    paddingLeft: quivoBubble.touch + quivoBubble.gap,
  },
  iconCircle: {
    width: quivoBubble.touch,
    height: quivoBubble.touch,
    borderRadius: quivoBubble.innerRadius,
    backgroundColor: dsColors.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successIconCircle: { backgroundColor: dsColors.successSoft },
  switchSlot: {
    width: dsSpace['3xl'] + quivoBubble.gap,
    minHeight: quivoBubble.touch,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTextContent: { flex: 1, minWidth: 0, gap: dsSpace.xs },
  title: { color: dsColors.textPrimary },
  successTitle: { color: dsColors.success },
  rescueStatus: { paddingHorizontal: dsSpace.xs },
  rescateBoton: { minHeight: 52, borderRadius: dsRadius.full },
});
