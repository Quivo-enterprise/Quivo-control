import type { ReactNode } from 'react';
import { useState } from 'react';
import { Image, Linking, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Loader, Text } from '@quivo/design-system-native';
import { Button } from '../../shared/components/Button';
import { BotonBurbuja, HojaBurbuja } from '../../shared/components/burbuja';
import { PlacaChapa } from '../../shared/components/placa-chapa';
import { dsColors, dsRadius, dsSpace } from '../../shared/theme/design-system';
import { quivoBubble } from '../../shared/theme/quivo-theme';
import { useOperacionSettings, useTextScale } from '../perfil/use-operacion-settings';
import { SiluetaVehiculo } from '../vecinos-ruta/silueta-vehiculo';
import { useVehiculoFoto } from './use-vehiculo-foto';

interface Props {
  placa: string;
  sesionId: string;
  obtenerAccessToken: () => Promise<string | null>;
  modeloVehiculo?: string;
  tipoVehiculo?: string;
  /** Dentro de una tarjeta mayor, evita una segunda superficie y sombra. */
  embedded?: boolean;
  /** Variante para la burbuja de vehículo en la pareja de columnas del Perfil. */
  compact?: boolean;
  /** Contenido superpuesto arriba a la izquierda de la foto principal. */
  fotoOverlay?: ReactNode;
}

/** Foto protagonista; las acciones conservan el mismo hook y los mismos destinos. */
export function FotoVehiculoSection({
  placa,
  sesionId,
  obtenerAccessToken,
  modeloVehiculo,
  tipoVehiculo,
  embedded = false,
  compact = false,
  fotoOverlay,
}: Props) {
  const {
    foto,
    cargando,
    estadoFoto,
    estado,
    mensaje,
    permisoDenegado,
    requiereAjustes,
    tomarFoto,
  } = useVehiculoFoto({ obtenerAccessToken, sesionId });
  const [fotoAmpliada, setFotoAmpliada] = useState(false);
  const insets = useSafeAreaInsets();
  const scale = useTextScale();
  const { settings } = useOperacionSettings();
  const ocupado = estado === 'procesando' || estado === 'enviando';
  const fecha = foto
    ? new Intl.DateTimeFormat('es-BO', {
        timeZone: 'America/La_Paz',
        day: '2-digit',
        month: '2-digit',
      }).format(new Date(foto.fotoActualizadaEn))
    : null;
  const textoEstado =
    estado === 'procesando' ? 'Preparando la foto…' : estado === 'enviando' ? 'Enviando…' : mensaje;
  const abrirCamara = () => void tomarFoto();
  const Contenedor = embedded ? View : HojaBurbuja;

  if (compact) {
    return (
      <View style={styles.compactRoot}>
        <View style={styles.compactImage}>
          {foto ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Ver foto del vehículo ${placa} en grande`}
              onPress={() => setFotoAmpliada(true)}
              style={styles.fotoTocable}
            >
              <Image
                key={foto.fotoActualizadaEn}
                source={{ uri: foto.fotoUrl }}
                style={styles.foto}
                accessibilityRole="image"
                accessibilityLabel={`Foto del vehículo ${placa}`}
              />
            </Pressable>
          ) : cargando ? (
            <Loader />
          ) : estadoFoto === 'desconocido' ? (
            <View
              style={styles.compactEmpty}
              accessible
              accessibilityLabel="No se pudo cargar la foto"
            >
              <Ionicons name="cloud-offline-outline" size={24} color={dsColors.textTertiary} />
              <Text
                size="sm"
                variant="secondary"
                numberOfLines={2}
                style={[styles.compactEmptyText, { fontSize: 14 * scale }]}
                allowFontScaling={!settings.textoGrande}
              >
                No se pudo cargar la foto
              </Text>
            </View>
          ) : (
            <View
              style={styles.compactEmpty}
              accessible
              accessibilityLabel="El vehículo no tiene foto"
            >
              <SiluetaVehiculo
                tipo={tipoVehiculo ?? 'micro'}
                color=""
                colorSecundario={null}
                fantasma
              />
              <Text
                size="sm"
                variant="secondary"
                numberOfLines={2}
                style={[styles.compactEmptyText, { fontSize: 14 * scale }]}
                allowFontScaling={!settings.textoGrande}
              >
                Agrega una foto
              </Text>
            </View>
          )}
          <View style={[styles.modeloCard, styles.modeloCardCompact]}>
            <View style={styles.modeloCardFondo} />
            <Text
              size="sm"
              weight="semibold"
              numberOfLines={2}
              style={[
                styles.modeloCardTexto,
                styles.modeloCardTextoCompact,
                { fontSize: 14 * scale },
              ]}
              allowFontScaling={!settings.textoGrande}
            >
              {modeloVehiculo ?? placa}
            </Text>
            {fecha ? (
              <Text
                size="sm"
                variant="secondary"
                numberOfLines={1}
                style={{ fontSize: 14 * scale }}
                allowFontScaling={!settings.textoGrande}
              >
                {fecha}
              </Text>
            ) : null}
          </View>
          {ocupado ? (
            <View style={styles.velo} accessibilityLiveRegion="polite">
              <View style={styles.veloFondo} />
              <Loader />
              <Text
                size="sm"
                weight="semibold"
                style={{ fontSize: 14 * scale }}
                allowFontScaling={!settings.textoGrande}
              >
                Subiendo…
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.compactFooter}>
          <Text
            size="sm"
            weight="semibold"
            numberOfLines={1}
            style={[styles.compactPlaca, { fontSize: 14 * scale }]}
            allowFontScaling={!settings.textoGrande}
          >
            {placa}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={foto ? 'Cambiar foto' : 'Tomar foto'}
            accessibilityState={{ disabled: ocupado }}
            disabled={ocupado}
            onPress={abrirCamara}
            style={({ pressed }) => [styles.compactAdd, pressed && styles.compactAddPressed]}
          >
            <Ionicons name="add" size={24} color={dsColors.primaryText} />
          </Pressable>
        </View>
        {estado === 'error' ? (
          <Text
            size="sm"
            variant="error"
            accessibilityRole="alert"
            numberOfLines={2}
            style={{ fontSize: 14 * scale }}
            allowFontScaling={!settings.textoGrande}
          >
            {textoEstado}
          </Text>
        ) : null}
        {permisoDenegado && requiereAjustes ? (
          <Button variant="ghost" onPress={() => void Linking.openSettings()}>
            <Text
              size="sm"
              weight="semibold"
              style={{ fontSize: 14 * scale }}
              allowFontScaling={!settings.textoGrande}
            >
              Abrir ajustes
            </Text>
          </Button>
        ) : null}
        <Modal
          visible={fotoAmpliada}
          transparent
          animationType="fade"
          onRequestClose={() => setFotoAmpliada(false)}
        >
          <View style={styles.modal}>
            {foto ? (
              <Image
                source={{ uri: foto.fotoUrl }}
                style={styles.fotoGrande}
                resizeMode="contain"
              />
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cerrar foto"
              onPress={() => setFotoAmpliada(false)}
              style={[styles.cerrar, { top: insets.top + quivoBubble.edge }]}
            >
              <Ionicons name="close" size={28} color={dsColors.textInverse} />
            </Pressable>
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <Contenedor style={embedded ? styles.embedded : styles.card}>
      <View style={styles.fotoBox}>
        {fotoOverlay ? <View style={styles.fotoOverlay}>{fotoOverlay}</View> : null}
        {foto ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Ver foto del vehículo ${placa} en grande`}
              onPress={() => setFotoAmpliada(true)}
              style={styles.fotoTocable}
            >
              <Image
                key={foto.fotoActualizadaEn}
                source={{ uri: foto.fotoUrl }}
                style={styles.foto}
                accessibilityRole="image"
                accessibilityLabel={`Foto del vehículo ${placa}`}
              />
            </Pressable>
            <View style={styles.camara}>
              <BotonBurbuja
                icono="camera-outline"
                accessibilityLabel="Cambiar foto"
                onPress={abrirCamara}
              />
            </View>
          </>
        ) : cargando ? (
          <Loader />
        ) : estadoFoto === 'desconocido' ? (
          <View style={styles.vacia} accessible accessibilityLabel="No se pudo cargar la foto">
            <Ionicons name="cloud-offline-outline" size={32} color={dsColors.textTertiary} />
            <Text
              size="sm"
              variant="secondary"
              style={{ fontSize: 14 * scale }}
              allowFontScaling={!settings.textoGrande}
            >
              No se pudo cargar la foto
            </Text>
          </View>
        ) : (
          <View style={styles.vacia} accessible accessibilityLabel="El vehículo no tiene foto">
            <SiluetaVehiculo
              tipo={tipoVehiculo ?? 'micro'}
              color=""
              colorSecundario={null}
              fantasma
              escala={3}
            />
            <Button variant="primary" onPress={abrirCamara} style={styles.botonFoto}>
              <Text
                weight="bold"
                style={{ fontSize: 16 * scale, color: dsColors.textInverse }}
                allowFontScaling={!settings.textoGrande}
              >
                Tomar foto
              </Text>
            </Button>
          </View>
        )}
        {ocupado ? (
          <View style={styles.velo} accessibilityLiveRegion="polite">
            <View style={styles.veloFondo} />
            <Loader />
            <Text
              size="sm"
              weight="semibold"
              style={{ fontSize: 14 * scale }}
              allowFontScaling={!settings.textoGrande}
            >
              Subiendo…
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.metadataRow}>
        <View style={styles.metadataModelo}>
          <Text
            size="md"
            numberOfLines={1}
            style={{ fontSize: 16 * scale }}
            allowFontScaling={!settings.textoGrande}
          >
            {modeloVehiculo ?? placa}
          </Text>
          {fecha ? (
            <Text
              size="sm"
              variant="secondary"
              numberOfLines={1}
              style={{ fontSize: 14 * scale }}
              allowFontScaling={!settings.textoGrande}
            >
              Actualizada {fecha}
            </Text>
          ) : null}
        </View>
        <PlacaChapa placa={placa} scale={scale} textoGrande={settings.textoGrande} />
      </View>

      {estado === 'error' ? (
        <View style={styles.errorRow}>
          <Text
            size="sm"
            variant="error"
            accessibilityRole="alert"
            style={[styles.errorTexto, { fontSize: 14 * scale }]}
            allowFontScaling={!settings.textoGrande}
          >
            {textoEstado}
          </Text>
          <Button
            variant="ghost"
            onPress={requiereAjustes ? () => void Linking.openSettings() : abrirCamara}
            style={styles.reintentar}
          >
            <Text
              weight="bold"
              style={{ fontSize: 14 * scale, color: dsColors.primaryText }}
              allowFontScaling={!settings.textoGrande}
            >
              {requiereAjustes ? 'Abrir ajustes' : 'Reintentar'}
            </Text>
          </Button>
        </View>
      ) : textoEstado && !ocupado ? (
        <Text
          size="sm"
          variant="secondary"
          accessibilityLiveRegion="polite"
          style={{ fontSize: 14 * scale }}
          allowFontScaling={!settings.textoGrande}
        >
          {textoEstado}
        </Text>
      ) : null}

      {permisoDenegado && requiereAjustes && estado !== 'error' ? (
        <Button variant="outline" onPress={() => void Linking.openSettings()}>
          <Text
            weight="bold"
            style={{ fontSize: 14 * scale, color: dsColors.primaryText }}
            allowFontScaling={!settings.textoGrande}
          >
            Abrir ajustes
          </Text>
        </Button>
      ) : null}

      <Modal
        visible={fotoAmpliada}
        transparent
        animationType="fade"
        onRequestClose={() => setFotoAmpliada(false)}
      >
        <View style={styles.modal}>
          {foto ? (
            <Image source={{ uri: foto.fotoUrl }} style={styles.fotoGrande} resizeMode="contain" />
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cerrar foto"
            onPress={() => setFotoAmpliada(false)}
            style={[styles.cerrar, { top: insets.top + quivoBubble.edge }]}
          >
            <Ionicons name="close" size={28} color={dsColors.textInverse} />
          </Pressable>
        </View>
      </Modal>
    </Contenedor>
  );
}

const styles = StyleSheet.create({
  card: { gap: quivoBubble.gap },
  embedded: { gap: quivoBubble.gap },
  compactRoot: { flex: 1, minWidth: 0, gap: quivoBubble.gap },
  compactImage: {
    flex: 1,
    minHeight: quivoBubble.touch * 3,
    borderRadius: quivoBubble.innerRadius,
    backgroundColor: dsColors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // El modelo ocupa la esquina superior; el estado vacío se apoya debajo sin cruzarse.
  compactEmpty: {
    position: 'absolute',
    left: dsSpace.xs,
    right: dsSpace.xs,
    bottom: dsSpace.xs,
    alignItems: 'center',
    gap: dsSpace.xs,
    padding: dsSpace.xs,
  },
  compactEmptyText: { textAlign: 'center' },
  compactFooter: { flexDirection: 'row', alignItems: 'center', gap: quivoBubble.gap },
  compactPlaca: { flex: 1, minWidth: 0 },
  compactAdd: {
    width: quivoBubble.touch,
    height: quivoBubble.touch,
    borderRadius: quivoBubble.innerRadius,
    backgroundColor: dsColors.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactAddPressed: { opacity: 0.7 },
  fotoBox: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: quivoBubble.innerRadius,
    backgroundColor: dsColors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fotoTocable: { width: '100%', height: '100%' },
  foto: { width: '100%', height: '100%', resizeMode: 'cover' },
  fotoOverlay: { position: 'absolute', zIndex: 1, left: dsSpace.sm, top: dsSpace.sm },
  camara: { position: 'absolute', right: dsSpace.sm, bottom: dsSpace.sm },
  metadataRow: { flexDirection: 'row', alignItems: 'center', gap: quivoBubble.gap },
  metadataModelo: { flex: 1, minWidth: 0, gap: dsSpace.xs },
  modeloCard: {
    position: 'absolute',
    top: dsSpace.xs,
    left: dsSpace.xs,
    maxWidth: '90%',
    minHeight: quivoBubble.touch,
    paddingHorizontal: dsSpace.sm,
    paddingVertical: dsSpace.xs,
    borderRadius: quivoBubble.innerRadius,
    borderWidth: 1,
    borderColor: dsColors.borderStrong,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  modeloCardCompact: { left: undefined, right: dsSpace.xs, top: dsSpace.xs, maxWidth: '90%' },
  modeloCardTextoCompact: { textAlign: 'right' },
  modeloCardFondo: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: dsColors.surfaceRaised,
    opacity: 0.82,
  },
  modeloCardTexto: { color: dsColors.textPrimary },
  vacia: { alignItems: 'center', justifyContent: 'center', gap: dsSpace.sm, padding: dsSpace.sm },
  botonFoto: { minHeight: 52, borderRadius: dsRadius.full },
  velo: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: dsSpace.sm,
  },
  veloFondo: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: dsColors.surfaceRaised,
    opacity: 0.7,
  },
  errorRow: { gap: dsSpace.xs },
  errorTexto: { flexShrink: 1 },
  reintentar: { alignSelf: 'flex-start' },
  modal: { flex: 1, backgroundColor: dsColors.black, justifyContent: 'center' },
  fotoGrande: { width: '100%', height: '100%' },
  cerrar: {
    position: 'absolute',
    top: dsSpace['3xl'],
    right: dsSpace.md,
    width: quivoBubble.touch,
    height: quivoBubble.touch,
    borderRadius: quivoBubble.innerRadius,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: dsColors.dark,
  },
});
