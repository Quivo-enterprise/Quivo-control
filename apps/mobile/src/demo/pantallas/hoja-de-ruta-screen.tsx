import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { resolverMarcaLinea, type ContextoOperativoMovil, type LineaBrand } from '@quivo/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { OperationStackParamList } from '../../app/operation-navigator';
import { quivoColors, quivoFonts, quivoRadius } from '../../shared/theme/quivo-theme';
import { FOTOS_TRUFI, LIMITES_TURNO_DEMO, LINEAS_MOCK, TRUFIS_MOCK, proximaSalidaDe, useDemo } from '..';
import type { ParadaMock, UnidadDemo } from '..';

/**
 * Pantalla "Hoja de ruta" (`docs/plan-apk-demo-conductor.md`, guion E06 02:45: "revisar su hoja
 * de ruta digital, consultar su recorrido, ver el orden de salida de los vehículos") —
 * 100% demo, solo alcanzable con `MODO_DEMO` (ver el gate en `operation-navigator.tsx`). Lee
 * TODO del motor vía `useDemo()`, así que se actualiza sola con cada tick (1 s) sin ningún
 * estado propio: el turno, la cola y el recorrido se recalculan en cada render.
 *
 * Tres secciones, pensadas para grabar un dato por plano (tipografía grande, poco texto por
 * pantalla): (a) Turno de hoy, (b) Orden de salida, (c) Recorrido.
 */

export interface HojaDeRutaScreenProps extends NativeStackScreenProps<OperationStackParamList, 'HojaDeRuta'> {
  contexto: ContextoOperativoMovil;
}

/** El contrato (`ContextoOperativoMovil`) no trae horario de inicio/fin de turno — solo
 * `asignacion.horario` (`manana|tarde|noche`). El rótulo `inicio – fin` es COSMÉTICO, mock, solo
 * para que la tarjeta "Turno de hoy" tenga un dato de horario que mostrar en la toma, pero los
 * NÚMEROS salen de `LIMITES_TURNO_DEMO` (`../cuentas.ts`) — la misma tabla que usa
 * `turnoDesdeHoraLocal` para decidir `asignacion.horario` al loguear.
 *
 * FIX POST-REVISIÓN (hallazgo de revisión — 2 fuentes de verdad divergentes): la primera versión
 * de este fix hardcodeaba estos rangos ACÁ por separado ("tarde 14:00-20:00 / noche 20:00-00:00")
 * mientras `turnoDesdeHoraLocal` usaba otros ("tarde" hasta las 22:00) — a las 21:00 el turno
 * elegido era `'tarde'` pero la tarjeta mostraba "14:00 – 20:00", ya vencido a esa hora. Derivar
 * el rótulo de `LIMITES_TURNO_DEMO` en vez de repetir los números hace que sea IMPOSIBLE que
 * vuelvan a desalinearse — cualquier cambio de horario se hace en un solo lugar. */
function horaHHMM(hora: number): string {
  return `${String(hora).padStart(2, '0')}:00`;
}

const HORARIO_TURNO_DEMO: Record<ContextoOperativoMovil['asignacion']['horario'], { inicio: string; fin: string }> = {
  manana: { inicio: horaHHMM(LIMITES_TURNO_DEMO.manana.inicioHora), fin: horaHHMM(LIMITES_TURNO_DEMO.manana.finHora) },
  tarde: { inicio: horaHHMM(LIMITES_TURNO_DEMO.tarde.inicioHora), fin: horaHHMM(LIMITES_TURNO_DEMO.tarde.finHora) },
  noche: { inicio: horaHHMM(LIMITES_TURNO_DEMO.noche.inicioHora), fin: horaHHMM(LIMITES_TURNO_DEMO.noche.finHora) },
};

const LABEL_TURNO: Record<ContextoOperativoMovil['asignacion']['horario'], string> = {
  manana: 'Turno mañana',
  tarde: 'Turno tarde',
  noche: 'Turno noche',
};

export function HojaDeRutaScreen({ navigation, contexto }: HojaDeRutaScreenProps) {
  // Esta pantalla solo se registra (`operation-navigator.tsx`) y solo se puede alcanzar (ítem
  // de navegación en `perfil-screen.tsx`) con `MODO_DEMO` — `useDemo()` siempre encuentra un
  // `<DemoProvider>` montado arriba (`App.tsx`) cuando esto llega a renderizar.
  const { estado, colaPropia, proximaSalidaPropia } = useDemo();

  const lineaId = estado.lineaPropiaId;
  const linea = LINEAS_MOCK[lineaId];
  const lineaBrand = resolverMarcaLinea(contexto.linea);
  const propia = estado.unidades[estado.trufiPropioId];
  const ownFase = propia?.fase ?? 'en_cola';

  const enRuta = Object.values(estado.unidades)
    .filter((u) => u.lineaId === lineaId && u.fase === 'en_ruta')
    .sort((a, b) => b.avance - a.avance); // la más avanzada primero

  const posicionPropiaEnCola = colaPropia.indexOf(estado.trufiPropioId);

  const fecha = formatearFechaLarga(contexto.asignacion.fecha);
  const horario = HORARIO_TURNO_DEMO[contexto.asignacion.horario];
  const salidaProgramadaTexto =
    ownFase === 'en_cola' && proximaSalidaPropia !== null
      ? formatearHora(proximaSalidaPropia)
      : ownFase === 'en_ruta'
        ? 'En ruta'
        : 'Recorrido finalizado';

  return (
    <View style={styles.container}>
      <View style={styles.headerBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver al perfil"
          onPress={() => navigation.goBack()}
          style={styles.headerBackPressable}
          hitSlop={12}
        >
          <Ionicons name="arrow-back" size={22} color={quivoColors.white} />
          <Text style={styles.headerTitle}>Hoja de ruta</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* (a) Turno de hoy */}
        <Text style={styles.sectionTitle}>Turno de hoy</Text>
        <View style={styles.card}>
          <View style={styles.turnoTop}>
            <LineaBadge linea={lineaBrand} />
            <View style={styles.turnoTopTexto}>
              <Text style={styles.placaGrande}>{contexto.vehiculo.placa}</Text>
              <Text style={styles.conductorTexto}>{contexto.conductor.nombre}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.turnoGrid}>
            <DatoTurno label="Horario" valor={`${horario.inicio} – ${horario.fin}`} />
            <DatoTurno label={LABEL_TURNO[contexto.asignacion.horario]} valor={fecha} />
          </View>

          <View style={styles.salidaProgramadaBox}>
            <Ionicons name="time-outline" size={18} color={quivoColors.primaryStrong} />
            <View style={{ flex: 1 }}>
              <Text style={styles.salidaProgramadaLabel}>Salida programada</Text>
              <Text style={styles.salidaProgramadaValor}>{salidaProgramadaTexto}</Text>
            </View>
          </View>
        </View>

        {/* (b) Orden de salida */}
        <Text style={styles.sectionTitle}>Orden de salida</Text>
        <View style={styles.card}>
          {enRuta.length > 0 && (
            <>
              <Text style={styles.subGrupoLabel}>En ruta</Text>
              {enRuta.map((u) => (
                <UnidadRow
                  key={u.trufiId}
                  unidad={u}
                  lineaBrand={lineaBrand}
                  esPropia={u.trufiId === estado.trufiPropioId}
                  muted
                />
              ))}
              <View style={styles.divider} />
            </>
          )}

          <Text style={styles.subGrupoLabel}>En cola</Text>
          {colaPropia.length === 0 ? (
            <Text style={styles.sinDatos}>No hay unidades en cola.</Text>
          ) : (
            colaPropia.map((trufiId, indice) => (
              <UnidadRow
                key={trufiId}
                trufiId={trufiId}
                lineaBrand={lineaBrand}
                esPropia={trufiId === estado.trufiPropioId}
                posicion={indice + 1}
                horaProgramada={proximaSalidaDe(estado, trufiId)}
              />
            ))
          )}

          {ownFase === 'en_cola' && posicionPropiaEnCola !== -1 && (
            <View style={styles.resumenPropioBox}>
              <Text style={styles.resumenPropioTexto}>
                Sos el {posicionPropiaEnCola + 1}º · salís a las {salidaProgramadaTexto}
              </Text>
            </View>
          )}
        </View>

        {/* (c) Recorrido */}
        <Text style={styles.sectionTitle}>Recorrido</Text>
        <View style={styles.card}>
          {[...linea.paradas]
            .sort((a, b) => a.orden - b.orden)
            .map((parada, indice, arreglo) => (
              <ParadaRow
                key={parada.id}
                parada={parada}
                esTerminal={indice === 0 || indice === arreglo.length - 1}
                esUltima={indice === arreglo.length - 1}
              />
            ))}
        </View>
      </ScrollView>
    </View>
  );
}

// ================================================================================================
// Subcomponentes.
// ================================================================================================

function LineaBadge({ linea }: { linea: LineaBrand }) {
  const esFondoClaro = esColorMuyClaro(linea.primary);
  return (
    <View
      style={[
        styles.lineaBadge,
        { backgroundColor: linea.primary },
        esFondoClaro && styles.lineaBadgeHairline,
      ]}
    >
      <Text style={[styles.lineaBadgeText, { color: linea.text }]} numberOfLines={1}>
        {linea.shortName}
      </Text>
    </View>
  );
}

function DatoTurno({ label, valor }: { label: string; valor: string }) {
  return (
    <View style={styles.datoTurno}>
      <Text style={styles.datoTurnoLabel}>{label}</Text>
      <Text style={styles.datoTurnoValor}>{valor}</Text>
    </View>
  );
}

interface UnidadRowProps {
  lineaBrand: LineaBrand;
  esPropia: boolean;
  muted?: boolean;
  posicion?: number;
  horaProgramada?: number | null;
  /** La fila puede recibir la `UnidadDemo` completa (unidades en ruta, ya resuelta) o solo el
   * `trufiId` (unidades en cola, sin más estado que su posición). */
  unidad?: UnidadDemo;
  trufiId?: string;
}

function UnidadRow({ lineaBrand, esPropia, muted, posicion, horaProgramada, unidad, trufiId: trufiIdProp }: UnidadRowProps) {
  const trufiId = unidad?.trufiId ?? trufiIdProp;
  if (!trufiId) return null;
  const trufi = TRUFIS_MOCK.find((t) => t.id === trufiId);
  const foto = FOTOS_TRUFI[trufiId];
  const aroColor = esColorMuyClaro(lineaBrand.primary) ? quivoColors.border : lineaBrand.primary;

  return (
    <View style={[styles.unidadRow, esPropia && styles.unidadRowPropia]}>
      {posicion !== undefined ? (
        <View style={styles.posicionCirculo}>
          <Text style={styles.posicionTexto}>{posicion}º</Text>
        </View>
      ) : (
        <View style={[styles.posicionCirculo, styles.posicionCirculoMuted]}>
          <Ionicons name="navigate" size={14} color={quivoColors.textMuted} />
        </View>
      )}

      {foto ? (
        <Image source={{ uri: foto }} style={[styles.fotoRedonda, { borderColor: aroColor }, muted && styles.fotoMuted]} />
      ) : (
        <View style={[styles.fotoRedonda, styles.fotoPlaceholder, { borderColor: aroColor }]}>
          <Ionicons name="car-outline" size={18} color={quivoColors.textMuted} />
        </View>
      )}

      <View style={styles.unidadInfo}>
        <View style={styles.unidadPlacaRow}>
          <Text style={[styles.unidadPlaca, muted && styles.textoMuted]}>{trufi?.placa ?? trufiId}</Text>
          {esPropia && (
            <View style={styles.vosTag}>
              <Text style={styles.vosTagTexto}>VOS</Text>
            </View>
          )}
        </View>
        {muted ? (
          <Text style={styles.unidadSubtexto}>En ruta</Text>
        ) : horaProgramada !== undefined ? (
          <Text style={styles.unidadSubtexto}>
            {horaProgramada !== null ? `Sale a las ${formatearHora(horaProgramada)}` : 'Horario por confirmar'}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function ParadaRow({ parada, esTerminal, esUltima }: { parada: ParadaMock; esTerminal: boolean; esUltima: boolean }) {
  return (
    <View style={styles.paradaRow}>
      <View style={styles.paradaTrack}>
        <View style={[styles.paradaDot, esTerminal && styles.paradaDotTerminal]} />
        {!esUltima && <View style={styles.paradaLinea} />}
      </View>
      <View style={styles.paradaContenido}>
        <Text style={styles.paradaNombre}>
          {parada.nombre}
          {esTerminal && <Text style={styles.paradaTerminalTag}>  ·  Terminal</Text>}
        </Text>
        {parada.esPuntoControl && (
          <View style={styles.chipsRow}>
            <View style={styles.chipControl}>
              <Ionicons name="shield-checkmark-outline" size={12} color={quivoColors.primaryStrong} />
              <Text style={styles.chipControlTexto}>Punto de control</Text>
            </View>
            <View style={styles.chipTolerancia}>
              <Text style={styles.chipToleranciaTexto}>± {parada.radioToleranciaM} m</Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

// ================================================================================================
// Helpers de formato.
// ================================================================================================

function formatearHora(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** "YYYY-MM-DD" -> "DD/MM/YYYY", mismo patrón que `ajustes-screen.tsx` (`formatearFechaAsignacion`),
 * duplicado a propósito (sin un módulo común entre `perfil`/`demo` para esto). */
function formatearFechaLarga(fechaIso: string): string {
  const [anio, mes, dia] = fechaIso.split('-');
  return `${dia}/${mes}/${anio}`;
}

/** Blanco/casi blanco -> hace falta un borde/aro oscuro para que se distinga del fondo claro de
 * las tarjetas (caso real: `LINEAS_MOCK.l120.color === '#ffffff'`). */
function esColorMuyClaro(color: string): boolean {
  return color.toLowerCase() === '#ffffff' || color.toLowerCase() === '#fff';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F6F8' },
  headerBar: {
    backgroundColor: '#3127B1',
    paddingTop: Platform.OS === 'ios' ? 12 : 16,
    paddingBottom: 16,
    paddingHorizontal: 20,
  },
  headerBackPressable: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: {
    color: quivoColors.white,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 18,
    letterSpacing: 0.2,
  },
  scrollContent: { paddingHorizontal: 22, paddingTop: 24, paddingBottom: 48 },
  sectionTitle: {
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 14,
    color: '#334155',
    marginTop: 22,
    marginBottom: 8,
    paddingLeft: 4,
  },
  card: {
    backgroundColor: quivoColors.white,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  divider: { height: 1, backgroundColor: '#E8ECF2', marginVertical: 12 },

  // Turno de hoy
  turnoTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  turnoTopTexto: { flex: 1 },
  placaGrande: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 26,
    color: quivoColors.primaryStrong,
    letterSpacing: 0.5,
  },
  conductorTexto: {
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 15,
    color: '#334155',
    marginTop: 2,
  },
  lineaBadge: {
    minWidth: 64,
    height: 44,
    borderRadius: quivoRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  lineaBadgeHairline: { borderWidth: 1.5, borderColor: '#D9D9E8' },
  lineaBadgeText: { fontFamily: quivoFonts.displayBold, fontSize: 15, letterSpacing: 0.3 },
  turnoGrid: { flexDirection: 'row', gap: 20 },
  datoTurno: { flex: 1 },
  datoTurnoLabel: {
    fontFamily: quivoFonts.bodyRegular,
    fontSize: 11.5,
    color: '#8A94A6',
  },
  datoTurnoValor: {
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 16,
    color: quivoColors.primaryStrong,
    marginTop: 2,
  },
  salidaProgramadaBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    backgroundColor: quivoColors.primarySubtle,
    borderRadius: quivoRadius.md,
    padding: 12,
  },
  salidaProgramadaLabel: { fontFamily: quivoFonts.bodyRegular, fontSize: 11.5, color: '#5B5B8A' },
  salidaProgramadaValor: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 20,
    color: quivoColors.primaryStrong,
    marginTop: 1,
  },

  // Orden de salida
  subGrupoLabel: {
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 11.5,
    color: '#8A94A6',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  sinDatos: { fontFamily: quivoFonts.bodyRegular, fontSize: 13, color: quivoColors.textMuted },
  unidadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  unidadRowPropia: {
    backgroundColor: quivoColors.primarySubtle,
    borderRadius: quivoRadius.md,
    paddingHorizontal: 8,
    marginHorizontal: -8,
  },
  posicionCirculo: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: quivoColors.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  posicionCirculoMuted: { backgroundColor: '#EEF1F5' },
  posicionTexto: { fontFamily: quivoFonts.displayBold, fontSize: 13, color: quivoColors.primaryStrong },
  fotoRedonda: { width: 42, height: 42, borderRadius: 21, borderWidth: 2 },
  fotoMuted: { opacity: 0.55 },
  fotoPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF1F5' },
  unidadInfo: { flex: 1 },
  unidadPlacaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  unidadPlaca: { fontFamily: quivoFonts.bodySemiBold, fontSize: 15, color: '#1A1A2E' },
  textoMuted: { color: quivoColors.textMuted },
  unidadSubtexto: { fontFamily: quivoFonts.bodyRegular, fontSize: 12, color: quivoColors.textMuted, marginTop: 1 },
  vosTag: {
    backgroundColor: quivoColors.accent,
    borderRadius: quivoRadius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  vosTagTexto: { fontFamily: quivoFonts.displayBold, fontSize: 10, color: quivoColors.white, letterSpacing: 0.5 },
  resumenPropioBox: {
    marginTop: 12,
    backgroundColor: quivoColors.primaryStrong,
    borderRadius: quivoRadius.md,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  resumenPropioTexto: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 15,
    color: quivoColors.white,
    textAlign: 'center',
  },

  // Recorrido
  paradaRow: { flexDirection: 'row', gap: 12 },
  paradaTrack: { width: 20, alignItems: 'center' },
  paradaDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: quivoColors.primary,
    marginTop: 4,
  },
  paradaDotTerminal: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: quivoColors.accent,
    marginTop: 2,
  },
  paradaLinea: { flex: 1, width: 2, backgroundColor: '#D9D9E8', marginVertical: 2, minHeight: 22 },
  paradaContenido: { flex: 1, paddingBottom: 18 },
  paradaNombre: { fontFamily: quivoFonts.bodySemiBold, fontSize: 14.5, color: '#1A1A2E' },
  paradaTerminalTag: { fontFamily: quivoFonts.bodyRegular, fontSize: 12, color: quivoColors.accentStrong },
  chipsRow: { flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  chipControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: quivoColors.primarySubtle,
    borderRadius: quivoRadius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipControlTexto: { fontFamily: quivoFonts.bodySemiBold, fontSize: 10.5, color: quivoColors.primaryStrong },
  chipTolerancia: {
    backgroundColor: '#EEF1F5',
    borderRadius: quivoRadius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipToleranciaTexto: { fontFamily: quivoFonts.bodyRegular, fontSize: 10.5, color: quivoColors.textMuted },
});
