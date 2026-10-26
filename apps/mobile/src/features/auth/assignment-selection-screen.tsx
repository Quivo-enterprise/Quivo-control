import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { resolverMarcaLinea, type ResumenAsignacionMovil } from '@quivo/shared';
import { Heading, Loader, Text, fontStyle } from '@quivo/design-system-native';
import { Button } from '../../shared/components/Button';
import { Burbuja } from '../../shared/components/burbuja';
import { formatHoraBolivia } from '../../shared/format-hora';
import { dsColors, dsElevation, dsSpace } from '../../shared/theme/design-system';
import { quivoBubble } from '../../shared/theme/quivo-theme';
import {
  buscarProximaAsignacion,
  formatearTiempoRelativo,
  formatearTiempoRelativoAccesible,
  ordenarAsignaciones,
  resolverIconoTurno,
} from './turnos-core';
import { FondoLogin } from './components/fondo-login';
import { MENSAJE_SELECCION_VENCIDA } from './use-auth-movil';

interface AssignmentSelectionScreenProps {
  asignaciones: ResumenAsignacionMovil[];
  loading: boolean;
  error: string | null;
  onSelect: (id: string) => Promise<void>;
  onBack: () => void;
}

/**
 * Elegir turno (pantalla 4, "próximo destacado"): el caso normal es iniciar el próximo turno, así
 * que ese ocupa la pantalla con un único botón; los demás del día quedan abajo como filas.
 */
export function AssignmentSelectionScreen({
  asignaciones,
  loading,
  error,
  onSelect,
  onBack,
}: AssignmentSelectionScreenProps) {
  const [ahora, setAhora] = useState(() => Date.now());
  const [elegida, setElegida] = useState<string | null>(null);

  // El "en 6 h 9 min" avanza por minuto; no hace falta más resolución.
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!loading) setElegida(null);
  }, [loading]);

  const ordenadas = ordenarAsignaciones(asignaciones);
  const proximaId = buscarProximaAsignacion(ordenadas, ahora);
  // Sin turnos por venir, se destaca el último del día (el más reciente).
  const destacada =
    ordenadas.find((a) => a.id === proximaId) ?? ordenadas[ordenadas.length - 1] ?? null;
  const otras = ordenadas.filter((a) => a.id !== destacada?.id);

  const elegir = (id: string) => {
    if (loading) return;
    setElegida(id);
    void onSelect(id);
  };

  return (
    <View style={styles.screen}>
      <FondoLogin variante="c" />
      <ScrollView
        contentContainerStyle={[
          styles.contenido,
          {
            // Mismo margen en los cuatro lados (reglas-burbujas §2): la ventana ya empieza bajo la barra
            // de estado y termina sobre la de gestos, así que no se suman las zonas seguras.
            paddingTop: quivoBubble.edge,
            paddingBottom: quivoBubble.edge,
          },
        ]}
      >
        {/* Fila de cabecera como en Perfil: ‹ a la izquierda, título centrado y un hueco simétrico. */}
        <View style={styles.cabeceraFila}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Volver"
            onPress={onBack}
            disabled={loading}
            hitSlop={8}
            style={({ pressed }) => [styles.volver, pressed && styles.presionado]}
          >
            <Ionicons name="chevron-back" size={24} color={dsColors.textInverse} />
          </Pressable>
          <Heading size="lg" numberOfLines={1} style={styles.titulo}>
            Elige tu turno
          </Heading>
          <View style={styles.huecoSimetrico} />
        </View>
        <Text size="md" style={styles.subtitulo}>
          {resumenDelDia(asignaciones.length, ahora)}
        </Text>

        {error ? (
          <View accessibilityRole="alert">
            <Burbuja direction="column" style={styles.aviso}>
              <View style={styles.avisoFila}>
                <Ionicons name="alert-circle" size={20} color={dsColors.danger} />
                <Text size="sm" style={styles.avisoTexto}>
                  {error}
                </Text>
              </View>
              {error === MENSAJE_SELECCION_VENCIDA ? (
                <Button variant="ghost" size="sm" onPress={onBack} style={styles.ingresarPin}>
                  Ingresar PIN
                </Button>
              ) : null}
            </Burbuja>
          </View>
        ) : null}

        {destacada ? (
          <TurnoDestacado
            asignacion={destacada}
            esProximo={destacada.id === proximaId}
            ahora={ahora}
            cargando={loading && elegida === destacada.id}
            deshabilitado={loading}
            onElegir={() => elegir(destacada.id)}
          />
        ) : null}

        {otras.length > 0 ? (
          <View style={styles.otras}>
            <Text size="sm" weight="semibold" style={styles.otrasTitulo}>
              {otras.length === 1 ? 'Otro turno hoy' : 'Otros turnos hoy'}
            </Text>
            {otras.map((asignacion) => (
              <TurnoFila
                key={asignacion.id}
                asignacion={asignacion}
                ahora={ahora}
                cargando={loading && elegida === asignacion.id}
                deshabilitado={loading}
                onElegir={() => elegir(asignacion.id)}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function PastillaLinea({
  linea,
  grande = false,
}: {
  linea: ResumenAsignacionMovil['linea'];
  grande?: boolean;
}) {
  const marca = resolverMarcaLinea(linea);
  // Un logo que no carga (URL caída o inalcanzable) no debe dejar su hueco al lado del código.
  const [logoFallo, setLogoFallo] = useState(false);
  return (
    <View
      style={[
        styles.pastillaLinea,
        grande && styles.pastillaLineaGrande,
        { backgroundColor: marca.primary },
      ]}
    >
      {marca.logoUrl && !logoFallo ? (
        <Image
          source={{ uri: marca.logoUrl }}
          style={styles.logoLinea}
          onError={() => setLogoFallo(true)}
        />
      ) : null}
      <Text
        numberOfLines={1}
        style={[styles.codigoLinea, grande && styles.codigoLineaGrande, { color: marca.text }]}
      >
        {linea.codigo}
      </Text>
    </View>
  );
}

function TurnoDestacado({
  asignacion,
  esProximo,
  ahora,
  cargando,
  deshabilitado,
  onElegir,
}: {
  asignacion: ResumenAsignacionMovil;
  esProximo: boolean;
  ahora: number;
  cargando: boolean;
  deshabilitado: boolean;
  onElegir: () => void;
}) {
  const hora = formatHoraBolivia(asignacion.horaSalida);
  const presentacion = formatHoraBolivia(asignacion.horaPresentacion);
  const relativo = formatearTiempoRelativo(asignacion.horaSalida, ahora);
  const paso = relativo?.startsWith('hace') ?? false;
  return (
    <View
      style={styles.destacada}
      accessible={false}
      accessibilityLabel={etiquetaAccesible(asignacion, ahora, esProximo)}
    >
      <View style={styles.destacadaArriba}>
        <Text size="xs" weight="bold" style={styles.etiqueta}>
          {esProximo ? 'PRÓXIMO TURNO' : 'ÚLTIMO TURNO DEL DÍA'}
        </Text>
        <PastillaLinea linea={asignacion.linea} grande />
      </View>

      <View style={styles.destacadaCentro}>
        <Text style={[styles.horaGrande, paso && styles.horaPasada]}>{hora ?? '--:--'}</Text>
        <Text size="md" style={paso ? styles.relativoPasado : styles.relativo}>
          {relativo ?? 'Sin hora de salida'}
        </Text>
        <View style={styles.detalle}>
          <Ionicons
            name={resolverIconoTurno(asignacion.horario)}
            size={18}
            color={dsColors.primaryText}
          />
          <Text size="md" style={styles.detalleTexto}>
            {labelTurno(asignacion.horario)} · Ruta {asignacion.ruta.sentido}
          </Text>
        </View>
        {presentacion ? (
          <Text size="sm" variant="secondary">
            Presentarse a las {presentacion}
          </Text>
        ) : null}
      </View>

      <Button
        variant="primary"
        size="lg"
        fullWidth
        loading={cargando}
        disabled={deshabilitado}
        onPress={onElegir}
        accessibilityHint="Inicia la jornada con este turno"
        style={styles.botonIniciar}
      >
        Iniciar este turno
      </Button>
    </View>
  );
}

function TurnoFila({
  asignacion,
  ahora,
  cargando,
  deshabilitado,
  onElegir,
}: {
  asignacion: ResumenAsignacionMovil;
  ahora: number;
  cargando: boolean;
  deshabilitado: boolean;
  onElegir: () => void;
}) {
  const hora = formatHoraBolivia(asignacion.horaSalida);
  const relativo = formatearTiempoRelativo(asignacion.horaSalida, ahora);
  const paso = relativo?.startsWith('hace') ?? false;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={etiquetaAccesible(asignacion, ahora, false)}
      accessibilityState={{ disabled: deshabilitado, busy: cargando }}
      disabled={deshabilitado}
      onPress={onElegir}
      style={({ pressed }) => [
        styles.fila,
        deshabilitado && !cargando && styles.filaApagada,
        pressed && styles.presionado,
      ]}
    >
      <PastillaLinea linea={asignacion.linea} />
      <Text style={[styles.horaFila, paso && styles.horaPasada]}>{hora ?? '--:--'}</Text>
      <View style={styles.filaTextos}>
        <View style={styles.detalle}>
          <Ionicons
            name={resolverIconoTurno(asignacion.horario)}
            size={16}
            color={dsColors.textSecondary}
          />
          <Text size="sm" variant="secondary" numberOfLines={1}>
            {labelTurno(asignacion.horario).replace('Turno ', '')}
          </Text>
        </View>
        {relativo ? (
          <Text size="sm" style={paso ? styles.relativoPasado : styles.relativo} numberOfLines={1}>
            {relativo}
          </Text>
        ) : null}
      </View>
      {cargando ? (
        <Loader size="sm" />
      ) : (
        <Ionicons name="chevron-forward" size={20} color={dsColors.textSecondary} />
      )}
    </Pressable>
  );
}

function etiquetaAccesible(
  asignacion: ResumenAsignacionMovil,
  ahora: number,
  esProximo: boolean,
): string {
  const hora = formatHoraBolivia(asignacion.horaSalida);
  const relativo = formatearTiempoRelativoAccesible(asignacion.horaSalida, ahora);
  return [
    `Línea ${asignacion.linea.codigo}`,
    labelTurno(asignacion.horario).toLowerCase(),
    hora ? `salida ${hora}` : 'sin hora de salida',
    relativo,
    esProximo ? 'próximo' : null,
  ]
    .filter(Boolean)
    .join(', ');
}

function labelTurno(turno: ResumenAsignacionMovil['horario']): string {
  return { manana: 'Turno mañana', tarde: 'Turno tarde', noche: 'Turno noche' }[turno];
}

function resumenDelDia(cantidad: number, ahora: number): string {
  const fecha = new Intl.DateTimeFormat('es-BO', {
    timeZone: 'America/La_Paz',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).formatToParts(ahora);
  const valor = (tipo: Intl.DateTimeFormatPartTypes) =>
    fecha.find((parte) => parte.type === tipo)?.value ?? '';
  const dia = `${valor('weekday')} ${valor('day')} de ${valor('month')}`;
  return `Hoy tienes ${cantidad} ${cantidad === 1 ? 'turno' : 'turnos'} · ${dia}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  contenido: {
    flexGrow: 1,
    paddingHorizontal: quivoBubble.edge,
    gap: dsSpace.md,
  },
  volver: {
    width: quivoBubble.touch,
    height: quivoBubble.touch,
    borderRadius: quivoBubble.touch / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  presionado: { opacity: 0.8 },
  cabeceraFila: { flexDirection: 'row', alignItems: 'center', gap: dsSpace.sm },
  huecoSimetrico: { width: quivoBubble.touch },
  titulo: { flex: 1, textAlign: 'center', color: dsColors.textInverse },
  subtitulo: { textAlign: 'center', color: 'rgba(255, 255, 255, 0.8)' },
  aviso: {
    width: '100%',
    alignItems: 'stretch',
  },
  avisoFila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: dsSpace.sm,
  },
  avisoTexto: { flex: 1, color: dsColors.danger },
  ingresarPin: { minHeight: quivoBubble.touch, alignSelf: 'flex-end' },
  // La tarjeta del próximo turno crece con el espacio libre: es lo que el chofer viene a tocar.
  destacada: {
    flexGrow: 1,
    minHeight: 360,
    padding: dsSpace.md,
    borderRadius: quivoBubble.radius,
    backgroundColor: quivoBubble.surface,
    borderWidth: 1,
    borderColor: quivoBubble.border,
    justifyContent: 'space-between',
    ...dsElevation(4),
  },
  destacadaArriba: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  etiqueta: { color: dsColors.primaryText, letterSpacing: 1.2 },
  destacadaCentro: { alignItems: 'center', gap: dsSpace.sm, paddingVertical: dsSpace.lg },
  horaGrande: {
    ...fontStyle('display', '700'),
    fontSize: 80,
    lineHeight: 88,
    color: dsColors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  horaPasada: { color: dsColors.textSecondary },
  relativo: { color: dsColors.textSecondary },
  relativoPasado: { color: dsColors.warningText },
  detalle: { flexDirection: 'row', alignItems: 'center', gap: dsSpace.xs },
  detalleTexto: { color: dsColors.textPrimary },
  botonIniciar: { minHeight: 56, borderRadius: quivoBubble.innerRadius },
  pastillaLinea: {
    minWidth: quivoBubble.touch,
    height: 32,
    paddingHorizontal: dsSpace.sm,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: dsSpace.xs,
  },
  pastillaLineaGrande: { height: 40, borderRadius: 20, paddingHorizontal: dsSpace.md },
  logoLinea: { width: 20, height: 20, resizeMode: 'contain' },
  codigoLinea: { ...fontStyle('display', '700'), fontSize: 16 },
  codigoLineaGrande: { fontSize: 22 },
  otras: { gap: dsSpace.sm },
  otrasTitulo: { color: 'rgba(255, 255, 255, 0.8)', paddingHorizontal: dsSpace.xs },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: dsSpace.md,
    minHeight: 64,
    paddingHorizontal: dsSpace.md,
    borderRadius: quivoBubble.radius,
    backgroundColor: quivoBubble.surface,
    borderWidth: 1,
    borderColor: quivoBubble.border,
  },
  filaApagada: { opacity: 0.6 },
  horaFila: {
    ...fontStyle('display', '700'),
    fontSize: 24,
    color: dsColors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  filaTextos: { flex: 1, minWidth: 0, gap: 2 },
});
