import { useState, type ComponentProps } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_600SemiBold,
  useFonts as useMontserrat,
} from '@expo-google-fonts/montserrat';
import {
  Oxanium_600SemiBold,
  Oxanium_700Bold,
  useFonts as useOxanium,
} from '@expo-google-fonts/oxanium';
import { LinearGradient } from 'expo-linear-gradient';
import * as Speech from 'expo-speech';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

const COLORS = {
  primary: '#3226B4',
  primaryStrong: '#3123C7',
  primarySoft: '#DCD9FB',
  primarySubtle: '#EFEEFC',
  accent: '#FD9E15',
  accentStrong: '#E0880A',
  accentSoft: '#FFEFD9',
  page: '#F1F1F8',
  card: '#FFFFFF',
  text: '#1A1A2E',
  textSecondary: '#4B4B6B',
  textMuted: '#9191B0',
  border: '#D9D9E8',
  success: '#16805D',
  successSoft: '#DDF4EA',
  danger: '#C53B4A',
  white: '#FFFFFF',
  mapBackground: '#E9EDF6',
  mapRoad: '#FFFFFF',
  mapRoadSecondary: '#D6DCEC',
} as const;

const FONTS = {
  body: 'Montserrat_400Regular',
  bodyMedium: 'Montserrat_500Medium',
  bodySemiBold: 'Montserrat_600SemiBold',
  display: 'Oxanium_600SemiBold',
  displayBold: 'Oxanium_700Bold',
} as const;

type MockScreen = 'login' | 'home' | 'route' | 'profile';
type MainScreen = Exclude<MockScreen, 'login'>;
type IconName = ComponentProps<typeof Ionicons>['name'];
type ControlPointId = 'terminal' | 'villa';
type QueuePhase = 'outside' | 'waiting' | 'called' | 'departed';
type AlertKind = 'checkpoint' | 'departure';

type RouteStop = {
  id: string;
  name: string;
  detail: string;
  time: string;
  mapPoint: readonly [number, number];
};

const MOCK_DRIVER = {
  name: 'Carlos Mendoza',
  phone: '700 12345',
  initials: 'CM',
  plate: '1234 ABC',
  vehicle: 'Toyota Coaster',
  unit: 'Unidad 08',
  line: 'Línea 12',
  route: 'Miraflores – Terminal',
} as const;

type QueueVehicle = {
  plate: string;
  driver: string;
  estimatedDeparture: string;
};

const CONTROL_POINT_LABELS: Record<ControlPointId, { title: string; detail: string }> = {
  terminal: { title: 'Terminal Central', detail: 'Lista de salida · inicio' },
  villa: { title: 'Villa Fátima', detail: 'Lista de salida · fin de recorrido' },
};

const QUEUE_BY_CONTROL_POINT: Record<ControlPointId, QueueVehicle[]> = {
  terminal: [
    { plate: '1078 KDR', driver: 'Luis Paredes', estimatedDeparture: '06:36' },
    { plate: MOCK_DRIVER.plate, driver: MOCK_DRIVER.name, estimatedDeparture: '06:42' },
    { plate: '4582 LMT', driver: 'María Quispe', estimatedDeparture: '06:49' },
    { plate: '9016 PVR', driver: 'Óscar Rojas', estimatedDeparture: '06:56' },
  ],
  villa: [
    { plate: '7741 RSC', driver: 'Jorge Flores', estimatedDeparture: '07:48' },
    { plate: '5690 BKV', driver: 'Ana Rojas', estimatedDeparture: '07:55' },
    { plate: MOCK_DRIVER.plate, driver: MOCK_DRIVER.name, estimatedDeparture: '08:02' },
    { plate: '3088 TPO', driver: 'Raúl Condori', estimatedDeparture: '08:09' },
  ],
};

function playAlert(kind: AlertKind) {
  const departure = kind === 'departure';
  Vibration.vibrate(departure ? [0, 130, 80, 230] : [0, 90]);
  void Speech.stop();
  Speech.speak(departure ? 'Es tu turno de salida' : 'Punto de control', {
    language: 'es-BO',
    pitch: departure ? 1.12 : 0.88,
    rate: departure ? 1 : 1.18,
  });
}

const ROUTE_STOPS: RouteStop[] = [
  {
    id: 'terminal',
    name: 'Terminal Central',
    detail: 'Inicio de jornada',
    time: '06:30',
    mapPoint: [44, 178],
  },
  {
    id: 'arce',
    name: 'Av. Arce / 6 de Agosto',
    detail: 'Punto de control 02',
    time: '06:48',
    mapPoint: [112, 140],
  },
  {
    id: 'prado',
    name: 'El Prado',
    detail: 'Punto de control 03',
    time: '07:05',
    mapPoint: [178, 164],
  },
  {
    id: 'miraflores',
    name: 'Plaza Miraflores',
    detail: 'Punto de control 04',
    time: '07:22',
    mapPoint: [246, 100],
  },
  {
    id: 'villa',
    name: 'Villa Fátima',
    detail: 'Fin de recorrido',
    time: '07:45',
    mapPoint: [312, 72],
  },
];

export default function App() {
  const [montserratLoaded, montserratError] = useMontserrat({
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
  });
  const [oxaniumLoaded, oxaniumError] = useOxanium({
    Oxanium_600SemiBold,
    Oxanium_700Bold,
  });

  const fontError = montserratError ?? oxaniumError;

  if (fontError) {
    return <MockupLoading label="No se pudieron cargar las fuentes del mockup." />;
  }

  if (!montserratLoaded || !oxaniumLoaded) {
    return <MockupLoading label="Preparando el mockup de QUIVO…" />;
  }

  return (
    <SafeAreaProvider>
      <MockupShell />
    </SafeAreaProvider>
  );
}

function MockupLoading({ label }: { label: string }) {
  return (
    <View style={styles.loadingScreen}>
      <StatusBar style="light" backgroundColor={COLORS.primaryStrong} />
      <BrandMark light />
      <Text style={styles.loadingLabel}>{label}</Text>
    </View>
  );
}

function MockupShell() {
  const [screen, setScreen] = useState<MockScreen>('login');
  const [tracking, setTracking] = useState(false);
  const [completedStops, setCompletedStops] = useState(0);
  const [queuePoint, setQueuePoint] = useState<ControlPointId>('terminal');
  const [queuePhase, setQueuePhase] = useState<QueuePhase>('outside');
  const [lastAlert, setLastAlert] = useState<AlertKind | null>(null);

  const handleLogin = () => {
    setScreen('home');
  };

  const triggerAlert = (kind: AlertKind) => {
    setLastAlert(kind);
    playAlert(kind);
  };

  const handlePrimaryAction = () => {
    const atDepartureQueue = queuePhase !== 'outside';

    if (atDepartureQueue && queuePhase === 'waiting') {
      setQueuePhase('called');
      triggerAlert('departure');
      return;
    }

    if (atDepartureQueue && queuePhase === 'called') {
      setQueuePhase('departed');
      setTracking(true);
      setCompletedStops(queuePoint === 'terminal' ? 1 : 1);
      return;
    }

    if (completedStops === 0 && queuePhase === 'outside') {
      setQueuePoint('terminal');
      setQueuePhase('waiting');
      triggerAlert('checkpoint');
      return;
    }

    if (tracking && completedStops < ROUTE_STOPS.length) {
      triggerAlert('checkpoint');
      if (completedStops >= ROUTE_STOPS.length - 1) {
        setCompletedStops(ROUTE_STOPS.length);
        setTracking(false);
        setQueuePoint('villa');
        setQueuePhase('waiting');
        return;
      }
      setCompletedStops((current) => Math.min(current + 1, ROUTE_STOPS.length));
    }
  };

  const handleLogout = () => {
    void Speech.stop();
    setScreen('login');
    setTracking(false);
    setCompletedStops(0);
    setQueuePoint('terminal');
    setQueuePhase('outside');
    setLastAlert(null);
  };

  const isLogin = screen === 'login';

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={[styles.root, { backgroundColor: isLogin ? COLORS.primaryStrong : COLORS.page }]}
    >
      <StatusBar
        style={isLogin ? 'light' : 'dark'}
        backgroundColor={isLogin ? COLORS.primaryStrong : COLORS.page}
      />

      {screen === 'login' ? (
        <LoginScreen onLogin={handleLogin} />
      ) : (
        <View style={styles.appFrame}>
          {screen === 'home' ? (
            <HomeScreen
              tracking={tracking}
              completedStops={completedStops}
              queuePoint={queuePoint}
              queuePhase={queuePhase}
              lastAlert={lastAlert}
              onNavigate={setScreen}
              onPrimaryAction={handlePrimaryAction}
            />
          ) : null}
          {screen === 'route' ? (
            <RouteScreen
              completedStops={completedStops}
              tracking={tracking}
              queuePoint={queuePoint}
              queuePhase={queuePhase}
            />
          ) : null}
          {screen === 'profile' ? <ProfileScreen onLogout={handleLogout} /> : null}
          <BottomNav active={screen} onChange={setScreen} />
        </View>
      )}
    </SafeAreaView>
  );
}

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [phone, setPhone] = useState<string>(MOCK_DRIVER.phone);
  const [plate, setPlate] = useState<string>(MOCK_DRIVER.plate);
  const [error, setError] = useState('');

  const submit = () => {
    const digits = phone.replace(/\D/g, '');
    const normalizedPlate = plate.trim().replace(/\s+/g, ' ');

    if (digits.length < 7) {
      setError('Ingresa un número de celular válido.');
      return;
    }

    if (normalizedPlate.length < 4) {
      setError('Ingresa la placa del vehículo.');
      return;
    }

    setError('');
    onLogin();
  };

  const fillDemo = () => {
    setPhone(MOCK_DRIVER.phone);
    setPlate(MOCK_DRIVER.plate);
    setError('');
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.loginScroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient
          colors={[COLORS.primaryStrong, '#4E42D7']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.loginHero}
        >
          <BrandMark light />
          <View style={styles.heroCopy}>
            <Text style={styles.heroEyebrow}>OPERACIÓN DE TRANSPORTE</Text>
            <Text style={styles.heroTitle}>Listo para{`\n`}tu jornada?</Text>
            <Text style={styles.heroSubtitle}>
              Ingresa tus datos para entrar directo al panel del chofer.
            </Text>
          </View>
          <View style={styles.heroOrbLarge} />
          <View style={styles.heroOrbSmall} />
        </LinearGradient>

        <View style={styles.loginPanel}>
          <View style={styles.demoPill}>
            <Ionicons name="flash-outline" size={15} color={COLORS.accentStrong} />
            <Text style={styles.demoPillText}>MOCKUP LOCAL · DATOS ESTÁTICOS</Text>
          </View>

          <Text style={styles.loginHeading}>Ingresa para continuar</Text>
          <Text style={styles.loginDescription}>
            No necesitas contraseña ni conexión. Solo usamos tu celular y la placa para identificar
            la jornada de prueba.
          </Text>

          <InputField
            label="Celular del chofer"
            placeholder="Ej. 700 12345"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            icon="call-outline"
          />
          <InputField
            label="Placa del vehículo"
            placeholder="Ej. 1234 ABC"
            value={plate}
            onChangeText={(value) => setPlate(value.toUpperCase())}
            autoCapitalize="characters"
            icon="car-outline"
          />

          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={18} color={COLORS.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <PrimaryButton label="Entrar al mockup" icon="arrow-forward" onPress={submit} />

          <Pressable onPress={fillDemo} style={styles.demoLink}>
            <Ionicons name="refresh-outline" size={16} color={COLORS.primary} />
            <Text style={styles.demoLinkText}>Restablecer datos de prueba</Text>
          </Pressable>

          <View style={styles.loginFooter}>
            <Ionicons name="shield-checkmark-outline" size={17} color={COLORS.success} />
            <Text style={styles.loginFooterText}>Flujo de demostración sin backend</Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function InputField({
  label,
  placeholder,
  value,
  onChangeText,
  icon,
  keyboardType = 'default',
  autoCapitalize = 'none',
}: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
  icon: IconName;
  keyboardType?: 'default' | 'phone-pad';
  autoCapitalize?: 'none' | 'characters';
}) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.inputShell, focused ? styles.inputShellFocused : null]}>
        <Ionicons name={icon} size={20} color={focused ? COLORS.primary : COLORS.textMuted} />
        <TextInput
          style={styles.textInput}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={COLORS.textMuted}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </View>
    </View>
  );
}

function HomeScreen({
  tracking,
  completedStops,
  queuePoint,
  queuePhase,
  lastAlert,
  onNavigate,
  onPrimaryAction,
}: {
  tracking: boolean;
  completedStops: number;
  queuePoint: ControlPointId;
  queuePhase: QueuePhase;
  lastAlert: AlertKind | null;
  onNavigate: (screen: MainScreen) => void;
  onPrimaryAction: () => void;
}) {
  const nextStop = ROUTE_STOPS[Math.min(completedStops, ROUTE_STOPS.length - 1)];
  const routeFinished = completedStops >= ROUTE_STOPS.length;
  const showQueue = queuePhase !== 'outside' && (completedStops === 0 || routeFinished);
  const statusTitle = showQueue
    ? queuePhase === 'called'
      ? 'Tu turno de salida'
      : 'Esperando en lista'
    : tracking
      ? 'Recorrido en curso'
      : 'Operación lista';

  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={styles.screenContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.topBar}>
        <View>
          <Text style={styles.topBarEyebrow}>MI JORNADA</Text>
          <Text style={styles.topBarTitle}>Buenos días, Carlos</Text>
        </View>
        <Pressable onPress={() => onNavigate('profile')} style={styles.avatarButton}>
          <Text style={styles.avatarText}>{MOCK_DRIVER.initials}</Text>
          <View style={styles.avatarStatus} />
        </Pressable>
      </View>

      <View style={styles.operationStatus}>
        <View style={styles.statusLine}>
          <View style={styles.statusDot} />
          <Text style={styles.statusTitle}>{statusTitle}</Text>
        </View>
        <Text style={styles.statusDetail}>
          {showQueue
            ? `${CONTROL_POINT_LABELS[queuePoint].title} · ${MOCK_DRIVER.plate}`
            : `${MOCK_DRIVER.line} · Turno mañana · ${MOCK_DRIVER.plate}`}
        </Text>
        <View style={styles.statusMetaRow}>
          <View style={styles.statusMetaItem}>
            <Ionicons name="navigate-outline" size={15} color={COLORS.primary} />
            <Text style={styles.statusMetaText}>{MOCK_DRIVER.route}</Text>
          </View>
          <View style={styles.statusMetaItem}>
            <Ionicons name="cloud-offline-outline" size={15} color={COLORS.textMuted} />
            <Text style={styles.statusMetaText}>Modo demo</Text>
          </View>
        </View>
      </View>

      <StaticMap completedStops={completedStops} tracking={tracking} />

      {lastAlert ? <SoundFeedbackBanner kind={lastAlert} /> : null}

      <View style={styles.sectionHeading}>
        <View>
          <Text style={styles.sectionEyebrow}>
            {showQueue ? 'ORDEN DE SALIDA' : 'SIGUIENTE PARADA'}
          </Text>
          <Text style={styles.sectionTitle}>
            {showQueue ? 'Tu turno en la lista' : 'Punto de control'}
          </Text>
        </View>
        <Pressable onPress={() => onNavigate('route')} style={styles.textAction}>
          <Text style={styles.textActionLabel}>Ver ruta</Text>
          <Ionicons name="chevron-forward" size={16} color={COLORS.primary} />
        </Pressable>
      </View>

      {showQueue ? (
        <QueueCard point={queuePoint} phase={queuePhase} onAction={onPrimaryAction} />
      ) : (
        <>
          <View style={styles.nextStopCard}>
            <View style={styles.nextStopIcon}>
              <Ionicons
                name={routeFinished ? 'flag-outline' : 'location-outline'}
                size={25}
                color={COLORS.primary}
              />
            </View>
            <View style={styles.nextStopCopy}>
              <Text style={styles.nextStopName}>
                {routeFinished ? 'Recorrido completado' : nextStop?.name}
              </Text>
              <Text style={styles.nextStopDetail}>
                {routeFinished
                  ? 'Todos los puntos fueron simulados'
                  : `${nextStop?.detail} · ${nextStop?.time}`}
              </Text>
            </View>
            {!routeFinished ? (
              <View style={styles.etaBadge}>
                <Text style={styles.etaValue}>{tracking ? '2' : '4'}</Text>
                <Text style={styles.etaLabel}>min</Text>
              </View>
            ) : null}
          </View>

          <PrimaryButton
            label={
              completedStops === 0
                ? 'Simular llegada al punto de salida'
                : routeFinished
                  ? 'Revisar recorrido'
                  : tracking
                    ? 'Simular llegada al punto'
                    : 'Iniciar recorrido'
            }
            icon={
              completedStops === 0
                ? 'location-outline'
                : routeFinished
                  ? 'list-outline'
                  : tracking
                    ? 'checkmark-circle-outline'
                    : 'play'
            }
            onPress={routeFinished ? () => onNavigate('route') : onPrimaryAction}
          />
        </>
      )}

      <View style={styles.statsGrid}>
        <StatCard
          icon="flag-outline"
          value={`${completedStops}/${ROUTE_STOPS.length}`}
          label="Puntos"
          accent="primary"
        />
        <StatCard icon="speedometer-outline" value="12.4 km" label="Distancia" accent="accent" />
        <StatCard icon="time-outline" value="2 h 18" label="Turno" accent="success" />
      </View>

      <View style={styles.mockupNote}>
        <Ionicons name="bulb-outline" size={19} color={COLORS.accentStrong} />
        <Text style={styles.mockupNoteText}>
          Simula la llegada a los controles y el turno de salida. El aviso de control y el aviso de
          salida usan sonidos diferentes.
        </Text>
      </View>
    </ScrollView>
  );
}

function SoundFeedbackBanner({ kind }: { kind: AlertKind }) {
  const departure = kind === 'departure';

  return (
    <View
      style={[
        styles.soundBanner,
        departure ? styles.soundBannerDeparture : styles.soundBannerCheckpoint,
      ]}
    >
      <View style={[styles.soundBannerIcon, departure ? styles.soundBannerIconDeparture : null]}>
        <Ionicons
          name={departure ? 'volume-high-outline' : 'radio-outline'}
          size={19}
          color={departure ? COLORS.accentStrong : COLORS.primary}
        />
      </View>
      <View style={styles.soundBannerCopy}>
        <Text style={styles.soundBannerTitle}>
          {departure ? 'Sonido de turno reproducido' : 'Sonido de control reproducido'}
        </Text>
        <Text style={styles.soundBannerText}>
          {departure ? 'Es tu turno de salida.' : 'Llegaste al punto de control.'}
        </Text>
      </View>
      <Ionicons
        name="checkmark-circle"
        size={19}
        color={departure ? COLORS.accentStrong : COLORS.success}
      />
    </View>
  );
}

function QueueCard({
  point,
  phase,
  onAction,
}: {
  point: ControlPointId;
  phase: QueuePhase;
  onAction: () => void;
}) {
  const entries = QUEUE_BY_CONTROL_POINT[point];
  const currentIndex = entries.findIndex((vehicle) => vehicle.plate === MOCK_DRIVER.plate);
  const currentVehicle = entries[currentIndex]!;
  const vehicleAhead = entries[currentIndex - 1];
  const called = phase === 'called';

  return (
    <View style={styles.queueCard}>
      <View style={styles.queueHeader}>
        <View style={styles.queueHeaderIcon}>
          <Ionicons name="list-outline" size={21} color={COLORS.primary} />
        </View>
        <View style={styles.queueHeaderCopy}>
          <Text style={styles.queueTitle}>Lista de salida</Text>
          <Text style={styles.queueSubtitle}>{CONTROL_POINT_LABELS[point].title}</Text>
        </View>
        <View style={[styles.queueStateBadge, called ? styles.queueStateBadgeCalled : null]}>
          <View style={[styles.queueStateDot, called ? styles.queueStateDotCalled : null]} />
          <Text style={[styles.queueStateText, called ? styles.queueStateTextCalled : null]}>
            {called ? 'TU TURNO' : 'EN ESPERA'}
          </Text>
        </View>
      </View>

      <View style={styles.queueSummary}>
        <View style={styles.queuePositionBlock}>
          <Text style={styles.queueSummaryEyebrow}>TU POSICIÓN</Text>
          <Text style={styles.queuePosition}>#{currentIndex + 1}</Text>
          <Text style={styles.queueSummaryCaption}>de {entries.length} vehículos</Text>
        </View>
        <View style={styles.queueSummaryDivider} />
        <View style={styles.queueEstimateBlock}>
          <Text style={styles.queueSummaryEyebrow}>ESTIMADO DE SALIDA</Text>
          <Text style={styles.queueEstimate}>
            {called ? 'Ahora' : currentVehicle.estimatedDeparture}
          </Text>
          <Text style={styles.queueSummaryCaption}>
            {called ? 'prepárate para salir' : 'hora aproximada'}
          </Text>
        </View>
      </View>

      <View style={styles.queueBehindCard}>
        <Ionicons name="arrow-forward-outline" size={19} color={COLORS.primary} />
        <View style={styles.queueBehindCopy}>
          <Text style={styles.queueBehindLabel}>Sales detrás de</Text>
          <Text style={styles.queueBehindValue}>
            {vehicleAhead
              ? `${vehicleAhead.plate} · ${vehicleAhead.driver}`
              : 'Eres el primero de la lista'}
          </Text>
        </View>
      </View>

      <Text style={styles.queueListTitle}>Orden de salida</Text>
      <View style={styles.queueList}>
        {entries.map((vehicle, index) => {
          const isCurrent = vehicle.plate === MOCK_DRIVER.plate;
          const before = index < currentIndex;
          return (
            <View
              key={vehicle.plate}
              style={[styles.queueRow, isCurrent ? styles.queueRowCurrent : null]}
            >
              <View style={[styles.queueNumber, isCurrent ? styles.queueNumberCurrent : null]}>
                <Text
                  style={[styles.queueNumberText, isCurrent ? styles.queueNumberTextCurrent : null]}
                >
                  {index + 1}
                </Text>
              </View>
              <View style={styles.queueVehicleCopy}>
                <Text style={styles.queueVehiclePlate}>{vehicle.plate}</Text>
                <Text style={styles.queueVehicleDriver}>
                  {isCurrent ? 'Tu vehículo · ' : ''}
                  {vehicle.driver}
                </Text>
              </View>
              <Text
                style={[styles.queueVehicleEta, isCurrent ? styles.queueVehicleEtaCurrent : null]}
              >
                {isCurrent
                  ? called
                    ? 'Ahora'
                    : vehicle.estimatedDeparture
                  : before
                    ? 'Antes'
                    : 'Después'}
              </Text>
            </View>
          );
        })}
      </View>

      <PrimaryButton
        label={called ? 'Simular salida ahora' : 'Simular que llegó mi turno'}
        icon={called ? 'car-sport-outline' : 'volume-high-outline'}
        onPress={onAction}
      />
    </View>
  );
}

function StaticMap({ completedStops, tracking }: { completedStops: number; tracking: boolean }) {
  const currentStop =
    ROUTE_STOPS[Math.min(completedStops, ROUTE_STOPS.length - 1)] ?? ROUTE_STOPS[0]!;

  return (
    <View style={styles.mapCard}>
      <View style={styles.mapHeader}>
        <View>
          <Text style={styles.mapEyebrow}>VISTA OPERATIVA</Text>
          <Text style={styles.mapTitle}>Mapa del recorrido</Text>
        </View>
        <View style={styles.staticBadge}>
          <View style={styles.staticBadgeDot} />
          <Text style={styles.staticBadgeText}>ESTÁTICO</Text>
        </View>
      </View>

      <View style={styles.mapCanvas}>
        <View style={[styles.mapBlock, styles.mapBlockOne]} />
        <View style={[styles.mapBlock, styles.mapBlockTwo]} />
        <View style={[styles.mapBlock, styles.mapBlockThree]} />
        <View style={[styles.mapBlock, styles.mapBlockFour]} />
        <Svg width="100%" height="100%" viewBox="0 0 360 220" style={StyleSheet.absoluteFillObject}>
          <Line x1="0" y1="45" x2="360" y2="45" stroke={COLORS.mapRoad} strokeWidth="13" />
          <Line x1="0" y1="122" x2="360" y2="122" stroke={COLORS.mapRoad} strokeWidth="9" />
          <Line x1="70" y1="0" x2="70" y2="220" stroke={COLORS.mapRoad} strokeWidth="11" />
          <Line x1="205" y1="0" x2="205" y2="220" stroke={COLORS.mapRoad} strokeWidth="8" />
          <Line x1="306" y1="0" x2="306" y2="220" stroke={COLORS.mapRoad} strokeWidth="12" />
          <Polyline
            points="44,178 112,140 178,164 246,100 312,72"
            fill="none"
            stroke={COLORS.primarySoft}
            strokeWidth="15"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Polyline
            points="44,178 112,140 178,164 246,100 312,72"
            fill="none"
            stroke={COLORS.primary}
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {ROUTE_STOPS.map((stop, index) => (
            <Circle
              key={stop.id}
              cx={stop.mapPoint[0]}
              cy={stop.mapPoint[1]}
              r={index === completedStops ? 9 : 6}
              fill={
                index < completedStops
                  ? COLORS.success
                  : index === completedStops
                    ? COLORS.accent
                    : COLORS.white
              }
              stroke={
                index < completedStops
                  ? COLORS.white
                  : index === completedStops
                    ? COLORS.white
                    : COLORS.primary
              }
              strokeWidth="3"
            />
          ))}
          <Circle
            cx={tracking ? currentStop.mapPoint[0] : 44}
            cy={tracking ? currentStop.mapPoint[1] : 178}
            r="13"
            fill={COLORS.primary}
            opacity="0.16"
          />
          <Circle
            cx={tracking ? currentStop.mapPoint[0] : 44}
            cy={tracking ? currentStop.mapPoint[1] : 178}
            r="6"
            fill={COLORS.primary}
            stroke={COLORS.white}
            strokeWidth="2"
          />
        </Svg>
        <View style={styles.mapLabel}>
          <Ionicons name="navigate" size={14} color={COLORS.primary} />
          <Text style={styles.mapLabelText}>{MOCK_DRIVER.line}</Text>
        </View>
        <View style={styles.mapCompass}>
          <Text style={styles.mapCompassText}>N</Text>
          <Ionicons name="arrow-up" size={15} color={COLORS.primary} />
        </View>
      </View>

      <View style={styles.mapLegend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: COLORS.success }]} />
          <Text style={styles.legendText}>Completado</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: COLORS.accent }]} />
          <Text style={styles.legendText}>Siguiente</Text>
        </View>
        <Text style={styles.mapDistance}>18.7 km total</Text>
      </View>
    </View>
  );
}

function RouteScreen({
  completedStops,
  tracking,
  queuePoint,
  queuePhase,
}: {
  completedStops: number;
  tracking: boolean;
  queuePoint: ControlPointId;
  queuePhase: QueuePhase;
}) {
  const waitingQueue = queuePhase === 'waiting' || queuePhase === 'called';

  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={styles.screenContent}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader
        eyebrow="PLAN DE HOY"
        title="Ruta de hoy"
        subtitle="Línea 12 · Miraflores – Terminal"
      />

      <View style={styles.routeSummary}>
        <View>
          <Text style={styles.routeSummaryEyebrow}>PROGRESO DEL RECORRIDO</Text>
          <Text style={styles.routeSummaryValue}>
            {completedStops} de {ROUTE_STOPS.length} puntos
          </Text>
        </View>
        <View style={styles.progressRing}>
          <Text style={styles.progressValue}>
            {Math.round((completedStops / ROUTE_STOPS.length) * 100)}%
          </Text>
        </View>
      </View>

      <View style={styles.routeStatusRow}>
        <View style={styles.routeStatusIcon}>
          <Ionicons
            name={tracking ? 'radio-outline' : 'pause-outline'}
            size={18}
            color={tracking ? COLORS.success : COLORS.textMuted}
          />
        </View>
        <View style={styles.routeStatusCopy}>
          <Text style={styles.routeStatusTitle}>
            {waitingQueue
              ? `En lista · ${CONTROL_POINT_LABELS[queuePoint].title}`
              : tracking
                ? 'Seguimiento activo'
                : 'Recorrido en pausa'}
          </Text>
          <Text style={styles.routeStatusDescription}>
            {waitingQueue
              ? 'Tu posición y el vehículo que sale antes están visibles en Inicio.'
              : tracking
                ? 'Puedes simular la llegada a cada punto desde Inicio.'
                : 'Inicia el recorrido desde Inicio para probar el flujo.'}
          </Text>
        </View>
      </View>

      <Text style={styles.timelineTitle}>Paradas y controles</Text>
      <View style={styles.timelineCard}>
        {ROUTE_STOPS.map((stop, index) => {
          const completed = index < completedStops;
          const active = index === completedStops && tracking;
          return (
            <View key={stop.id} style={styles.timelineItem}>
              <View style={styles.timelineRail}>
                <View
                  style={[
                    styles.timelineDot,
                    completed ? styles.timelineDotCompleted : null,
                    active ? styles.timelineDotActive : null,
                  ]}
                >
                  {completed ? <Ionicons name="checkmark" size={13} color={COLORS.white} /> : null}
                </View>
                {index < ROUTE_STOPS.length - 1 ? (
                  <View
                    style={[styles.timelineLine, completed ? styles.timelineLineCompleted : null]}
                  />
                ) : null}
              </View>
              <View style={styles.timelineContent}>
                <View style={styles.timelineTopLine}>
                  <Text style={styles.timelineStopName}>{stop.name}</Text>
                  <Text style={styles.timelineTime}>{stop.time}</Text>
                </View>
                <Text style={styles.timelineDetail}>{stop.detail}</Text>
                <View style={styles.timelineTagRow}>
                  <View
                    style={[
                      styles.timelineTag,
                      completed
                        ? styles.timelineTagCompleted
                        : active
                          ? styles.timelineTagActive
                          : styles.timelineTagPending,
                    ]}
                  >
                    <Text
                      style={[
                        styles.timelineTagText,
                        completed
                          ? styles.timelineTagTextCompleted
                          : active
                            ? styles.timelineTagTextActive
                            : null,
                      ]}
                    >
                      {completed ? 'Completado' : active ? 'Siguiente' : 'Pendiente'}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function ProfileScreen({ onLogout }: { onLogout: () => void }) {
  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={styles.screenContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.profileTopBar}>
        <BrandMark />
        <View style={styles.demoMiniBadge}>
          <View style={styles.staticBadgeDot} />
          <Text style={styles.demoMiniBadgeText}>DEMO</Text>
        </View>
      </View>

      <LinearGradient colors={[COLORS.primaryStrong, '#5146D7']} style={styles.profileCard}>
        <View style={styles.profileAvatarLarge}>
          <Text style={styles.profileAvatarText}>{MOCK_DRIVER.initials}</Text>
        </View>
        <Text style={styles.profileName}>{MOCK_DRIVER.name}</Text>
        <Text style={styles.profileRole}>Chofer · {MOCK_DRIVER.line}</Text>
        <View style={styles.profileCardFooter}>
          <View style={styles.profileCardFooterItem}>
            <Ionicons name="call-outline" size={15} color={COLORS.primarySoft} />
            <Text style={styles.profileCardFooterText}>{MOCK_DRIVER.phone}</Text>
          </View>
          <View style={styles.profileCardFooterItem}>
            <Ionicons name="car-outline" size={15} color={COLORS.primarySoft} />
            <Text style={styles.profileCardFooterText}>{MOCK_DRIVER.plate}</Text>
          </View>
        </View>
      </LinearGradient>

      <Text style={styles.profileSectionTitle}>Datos de la unidad</Text>
      <View style={styles.infoCard}>
        <InfoRow icon="car-sport-outline" label="Vehículo" value={MOCK_DRIVER.vehicle} />
        <InfoRow icon="barcode-outline" label="Unidad" value={MOCK_DRIVER.unit} />
        <InfoRow icon="navigate-outline" label="Ruta asignada" value={MOCK_DRIVER.route} last />
      </View>

      <Text style={styles.profileSectionTitle}>Sobre este prototipo</Text>
      <View style={styles.prototypeCard}>
        <View style={styles.prototypeIcon}>
          <Ionicons name="construct-outline" size={21} color={COLORS.accentStrong} />
        </View>
        <View style={styles.prototypeCopy}>
          <Text style={styles.prototypeTitle}>Modo mockup activado</Text>
          <Text style={styles.prototypeText}>
            Todas las pantallas usan datos estáticos. No se realizan llamadas de red, no hay GPS
            real y no se guarda una sesión.
          </Text>
        </View>
      </View>

      <OutlineButton label="Cerrar sesión de prueba" icon="log-out-outline" onPress={onLogout} />
    </ScrollView>
  );
}

function ScreenHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <View style={styles.screenHeader}>
      <Text style={styles.screenHeaderEyebrow}>{eyebrow}</Text>
      <Text style={styles.screenHeaderTitle}>{title}</Text>
      <Text style={styles.screenHeaderSubtitle}>{subtitle}</Text>
    </View>
  );
}

function StatCard({
  icon,
  value,
  label,
  accent,
}: {
  icon: IconName;
  value: string;
  label: string;
  accent: 'primary' | 'accent' | 'success';
}) {
  const color =
    accent === 'accent'
      ? COLORS.accentStrong
      : accent === 'success'
        ? COLORS.success
        : COLORS.primary;
  const background =
    accent === 'accent'
      ? COLORS.accentSoft
      : accent === 'success'
        ? COLORS.successSoft
        : COLORS.primarySubtle;

  return (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: background }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function InfoRow({
  icon,
  label,
  value,
  last = false,
}: {
  icon: IconName;
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.infoRow, last ? null : styles.infoRowBorder]}>
      <View style={styles.infoIcon}>
        <Ionicons name={icon} size={19} color={COLORS.primary} />
      </View>
      <View style={styles.infoCopy}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
      <Ionicons name="chevron-forward" size={17} color={COLORS.textMuted} />
    </View>
  );
}

function PrimaryButton({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.primaryButton, pressed ? styles.buttonPressed : null]}
    >
      <LinearGradient
        colors={[COLORS.primaryStrong, COLORS.primary]}
        style={styles.primaryButtonGradient}
      >
        <Text style={styles.primaryButtonText}>{label}</Text>
        <Ionicons name={icon} size={20} color={COLORS.white} />
      </LinearGradient>
    </Pressable>
  );
}

function OutlineButton({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.outlineButton, pressed ? styles.outlineButtonPressed : null]}
    >
      <Ionicons name={icon} size={19} color={COLORS.danger} />
      <Text style={styles.outlineButtonText}>{label}</Text>
    </Pressable>
  );
}

function BrandMark({ light = false }: { light?: boolean }) {
  return (
    <View style={styles.brandMark}>
      <View style={[styles.brandIcon, light ? styles.brandIconLight : null]}>
        <Ionicons name="navigate" size={19} color={light ? COLORS.white : COLORS.primary} />
      </View>
      <Text style={[styles.brandText, light ? styles.brandTextLight : null]}>QUIVO</Text>
    </View>
  );
}

function BottomNav({
  active,
  onChange,
}: {
  active: MainScreen;
  onChange: (screen: MainScreen) => void;
}) {
  return (
    <View style={styles.bottomNav}>
      <BottomNavItem
        active={active === 'home'}
        icon="home-outline"
        label="Inicio"
        onPress={() => onChange('home')}
      />
      <BottomNavItem
        active={active === 'route'}
        icon="map-outline"
        label="Ruta"
        onPress={() => onChange('route')}
      />
      <BottomNavItem
        active={active === 'profile'}
        icon="person-outline"
        label="Perfil"
        onPress={() => onChange('profile')}
      />
    </View>
  );
}

function BottomNavItem({
  active,
  icon,
  label,
  onPress,
}: {
  active: boolean;
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.bottomNavItem}>
      <View style={[styles.bottomNavIcon, active ? styles.bottomNavIconActive : null]}>
        <Ionicons name={icon} size={21} color={active ? COLORS.primary : COLORS.textMuted} />
      </View>
      <Text style={[styles.bottomNavLabel, active ? styles.bottomNavLabelActive : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1 },
  appFrame: { flex: 1, backgroundColor: COLORS.page },
  loadingScreen: {
    flex: 1,
    backgroundColor: COLORS.primaryStrong,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  loadingLabel: {
    marginTop: 22,
    color: COLORS.primarySoft,
    fontFamily: FONTS.bodyMedium,
    fontSize: 13,
    textAlign: 'center',
  },
  brandMark: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySubtle,
  },
  brandIconLight: { backgroundColor: 'rgba(255,255,255,0.17)' },
  brandText: {
    color: COLORS.primary,
    fontFamily: FONTS.displayBold,
    fontSize: 23,
    letterSpacing: 1.7,
  },
  brandTextLight: { color: COLORS.white },
  loginScroll: { flexGrow: 1, backgroundColor: COLORS.card },
  loginHero: {
    minHeight: 306,
    paddingHorizontal: 26,
    paddingTop: 28,
    paddingBottom: 38,
    overflow: 'hidden',
  },
  heroCopy: { marginTop: 44, maxWidth: 300 },
  heroEyebrow: {
    color: COLORS.accentSoft,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1.35,
  },
  heroTitle: {
    marginTop: 10,
    color: COLORS.white,
    fontFamily: FONTS.displayBold,
    fontSize: 37,
    lineHeight: 42,
  },
  heroSubtitle: {
    marginTop: 13,
    color: COLORS.primarySoft,
    fontFamily: FONTS.body,
    fontSize: 13,
    lineHeight: 20,
  },
  heroOrbLarge: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    right: -100,
    top: 132,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  heroOrbSmall: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    right: -25,
    top: 182,
    borderWidth: 1,
    borderColor: 'rgba(253,158,21,0.4)',
  },
  loginPanel: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 25,
    paddingBottom: 26,
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginTop: -18,
  },
  demoPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: COLORS.accentSoft,
  },
  demoPillText: {
    color: COLORS.accentStrong,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 9,
    letterSpacing: 0.65,
  },
  loginHeading: {
    marginTop: 21,
    color: COLORS.text,
    fontFamily: FONTS.display,
    fontSize: 27,
  },
  loginDescription: {
    marginTop: 8,
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 12,
    lineHeight: 19,
  },
  fieldGroup: { marginTop: 20 },
  fieldLabel: {
    marginBottom: 8,
    color: COLORS.text,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 12,
  },
  inputShell: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 15,
    backgroundColor: '#FAFAFD',
  },
  inputShellFocused: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.white,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.1,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  textInput: {
    flex: 1,
    paddingVertical: 0,
    color: COLORS.text,
    fontFamily: FONTS.bodyMedium,
    fontSize: 15,
  },
  errorBox: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 11,
    borderRadius: 12,
    backgroundColor: '#FBE5E8',
  },
  errorText: { flex: 1, color: COLORS.danger, fontFamily: FONTS.bodyMedium, fontSize: 11 },
  primaryButton: {
    marginTop: 23,
    minHeight: 56,
    overflow: 'hidden',
    borderRadius: 16,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.23,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 7 },
    elevation: 4,
  },
  primaryButtonGradient: {
    flex: 1,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 18,
  },
  primaryButtonText: { color: COLORS.white, fontFamily: FONTS.bodySemiBold, fontSize: 13 },
  buttonPressed: { opacity: 0.86, transform: [{ scale: 0.985 }] },
  demoLink: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 20,
    padding: 5,
  },
  demoLinkText: { color: COLORS.primary, fontFamily: FONTS.bodyMedium, fontSize: 11 },
  loginFooter: {
    justifyContent: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 23,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  loginFooterText: { color: COLORS.textMuted, fontFamily: FONTS.body, fontSize: 10 },
  screenScroll: { flex: 1 },
  screenContent: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 110 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topBarEyebrow: {
    color: COLORS.primary,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1.1,
  },
  topBarTitle: { marginTop: 5, color: COLORS.text, fontFamily: FONTS.display, fontSize: 24 },
  avatarButton: {
    width: 45,
    height: 45,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
  },
  avatarText: { color: COLORS.white, fontFamily: FONTS.bodySemiBold, fontSize: 13 },
  avatarStatus: {
    position: 'absolute',
    width: 10,
    height: 10,
    right: -1,
    bottom: -1,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: COLORS.page,
    backgroundColor: '#32B77C',
  },
  operationStatus: {
    marginTop: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E3E2F5',
    borderRadius: 18,
    backgroundColor: COLORS.card,
  },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#32B77C' },
  statusTitle: { color: COLORS.text, fontFamily: FONTS.bodySemiBold, fontSize: 13 },
  statusDetail: { marginTop: 7, color: COLORS.textSecondary, fontFamily: FONTS.body, fontSize: 11 },
  statusMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 15, marginTop: 15 },
  statusMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  statusMetaText: {
    color: COLORS.textMuted,
    fontFamily: FONTS.bodyMedium,
    fontSize: 10,
    flexShrink: 1,
  },
  mapCard: {
    marginTop: 18,
    padding: 12,
    borderRadius: 21,
    backgroundColor: COLORS.card,
    shadowColor: '#1A1A2E',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  mapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 5,
    paddingBottom: 11,
  },
  mapEyebrow: {
    color: COLORS.textMuted,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 9,
    letterSpacing: 1,
  },
  mapTitle: { marginTop: 4, color: COLORS.text, fontFamily: FONTS.display, fontSize: 18 },
  staticBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: COLORS.primarySubtle,
  },
  staticBadgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.accent },
  staticBadgeText: {
    color: COLORS.primary,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 8,
    letterSpacing: 0.65,
  },
  mapCanvas: {
    height: 220,
    overflow: 'hidden',
    borderRadius: 15,
    backgroundColor: COLORS.mapBackground,
  },
  mapBlock: { position: 'absolute', borderRadius: 8, backgroundColor: '#DDE3EF' },
  mapBlockOne: { width: 77, height: 44, top: 19, left: 9 },
  mapBlockTwo: { width: 98, height: 55, top: 74, left: 83 },
  mapBlockThree: { width: 77, height: 40, top: 142, left: 218 },
  mapBlockFour: { width: 62, height: 42, top: 87, right: 5 },
  mapLabel: {
    position: 'absolute',
    left: 13,
    top: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  mapLabelText: { color: COLORS.primary, fontFamily: FONTS.bodySemiBold, fontSize: 10 },
  mapCompass: {
    position: 'absolute',
    right: 11,
    top: 11,
    alignItems: 'center',
    justifyContent: 'center',
    width: 30,
    height: 35,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  mapCompassText: { color: COLORS.primary, fontFamily: FONTS.bodySemiBold, fontSize: 9 },
  mapLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 5,
    paddingTop: 11,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { color: COLORS.textMuted, fontFamily: FONTS.body, fontSize: 9 },
  mapDistance: {
    marginLeft: 'auto',
    color: COLORS.textSecondary,
    fontFamily: FONTS.bodyMedium,
    fontSize: 9,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 24,
    marginBottom: 11,
  },
  sectionEyebrow: {
    color: COLORS.textMuted,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 9,
    letterSpacing: 1,
  },
  sectionTitle: { marginTop: 4, color: COLORS.text, fontFamily: FONTS.display, fontSize: 20 },
  textAction: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingBottom: 2 },
  textActionLabel: { color: COLORS.primary, fontFamily: FONTS.bodySemiBold, fontSize: 11 },
  nextStopCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 17,
    backgroundColor: COLORS.card,
  },
  nextStopIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySubtle,
  },
  nextStopCopy: { flex: 1, marginLeft: 11 },
  nextStopName: { color: COLORS.text, fontFamily: FONTS.bodySemiBold, fontSize: 12 },
  nextStopDetail: { marginTop: 5, color: COLORS.textMuted, fontFamily: FONTS.body, fontSize: 10 },
  etaBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 44,
    paddingVertical: 7,
    borderRadius: 11,
    backgroundColor: COLORS.accentSoft,
  },
  etaValue: { color: COLORS.accentStrong, fontFamily: FONTS.displayBold, fontSize: 17 },
  etaLabel: {
    marginTop: -2,
    color: COLORS.accentStrong,
    fontFamily: FONTS.bodyMedium,
    fontSize: 8,
  },
  statsGrid: { flexDirection: 'row', gap: 9, marginTop: 17 },
  statCard: {
    flex: 1,
    minHeight: 105,
    padding: 11,
    borderRadius: 16,
    backgroundColor: COLORS.card,
  },
  statIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: { marginTop: 10, color: COLORS.text, fontFamily: FONTS.display, fontSize: 16 },
  statLabel: { marginTop: 3, color: COLORS.textMuted, fontFamily: FONTS.body, fontSize: 9 },
  mockupNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    marginTop: 17,
    padding: 13,
    borderRadius: 14,
    backgroundColor: COLORS.accentSoft,
  },
  mockupNoteText: {
    flex: 1,
    color: '#805D28',
    fontFamily: FONTS.body,
    fontSize: 10,
    lineHeight: 16,
  },
  soundBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    padding: 11,
    borderRadius: 14,
  },
  soundBannerCheckpoint: { backgroundColor: COLORS.primarySubtle },
  soundBannerDeparture: { backgroundColor: COLORS.accentSoft },
  soundBannerIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
  },
  soundBannerIconDeparture: { backgroundColor: 'rgba(255,255,255,0.64)' },
  soundBannerCopy: { flex: 1 },
  soundBannerTitle: { color: COLORS.text, fontFamily: FONTS.bodySemiBold, fontSize: 10 },
  soundBannerText: {
    marginTop: 3,
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 9,
  },
  queueCard: { padding: 14, borderRadius: 18, backgroundColor: COLORS.card },
  queueHeader: { flexDirection: 'row', alignItems: 'center' },
  queueHeaderIcon: {
    width: 43,
    height: 43,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySubtle,
  },
  queueHeaderCopy: { flex: 1, marginLeft: 10 },
  queueTitle: { color: COLORS.text, fontFamily: FONTS.bodySemiBold, fontSize: 12 },
  queueSubtitle: { marginTop: 4, color: COLORS.textMuted, fontFamily: FONTS.body, fontSize: 10 },
  queueStateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 9,
    backgroundColor: COLORS.primarySubtle,
  },
  queueStateBadgeCalled: { backgroundColor: COLORS.accentSoft },
  queueStateDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.primary },
  queueStateDotCalled: { backgroundColor: COLORS.accentStrong },
  queueStateText: {
    color: COLORS.primary,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 8,
    letterSpacing: 0.5,
  },
  queueStateTextCalled: { color: COLORS.accentStrong },
  queueSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 15,
    padding: 13,
    borderRadius: 15,
    backgroundColor: '#F8F7FE',
  },
  queuePositionBlock: { flex: 1 },
  queueEstimateBlock: { flex: 1.25 },
  queueSummaryEyebrow: {
    color: COLORS.textMuted,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 8,
    letterSpacing: 0.65,
  },
  queuePosition: {
    marginTop: 4,
    color: COLORS.primary,
    fontFamily: FONTS.displayBold,
    fontSize: 26,
  },
  queueEstimate: { marginTop: 5, color: COLORS.text, fontFamily: FONTS.display, fontSize: 21 },
  queueSummaryCaption: {
    marginTop: 2,
    color: COLORS.textMuted,
    fontFamily: FONTS.body,
    fontSize: 9,
  },
  queueSummaryDivider: {
    width: 1,
    height: 47,
    marginHorizontal: 11,
    backgroundColor: COLORS.border,
  },
  queueBehindCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 11,
    padding: 11,
    borderRadius: 13,
    backgroundColor: COLORS.successSoft,
  },
  queueBehindCopy: { flex: 1 },
  queueBehindLabel: { color: COLORS.success, fontFamily: FONTS.bodyMedium, fontSize: 9 },
  queueBehindValue: {
    marginTop: 3,
    color: COLORS.text,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 11,
  },
  queueListTitle: { marginTop: 17, color: COLORS.text, fontFamily: FONTS.display, fontSize: 16 },
  queueList: { marginTop: 5 },
  queueRow: {
    minHeight: 57,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  queueRowCurrent: {
    marginHorizontal: -5,
    paddingHorizontal: 5,
    borderRadius: 11,
    borderBottomWidth: 0,
    backgroundColor: COLORS.primarySubtle,
  },
  queueNumber: {
    width: 25,
    height: 25,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.page,
  },
  queueNumberCurrent: { backgroundColor: COLORS.primary },
  queueNumberText: { color: COLORS.textMuted, fontFamily: FONTS.bodySemiBold, fontSize: 10 },
  queueNumberTextCurrent: { color: COLORS.white },
  queueVehicleCopy: { flex: 1, marginLeft: 9 },
  queueVehiclePlate: { color: COLORS.text, fontFamily: FONTS.bodySemiBold, fontSize: 11 },
  queueVehicleDriver: {
    marginTop: 3,
    color: COLORS.textMuted,
    fontFamily: FONTS.body,
    fontSize: 9,
  },
  queueVehicleEta: { color: COLORS.textMuted, fontFamily: FONTS.bodyMedium, fontSize: 9 },
  queueVehicleEtaCurrent: { color: COLORS.primary, fontFamily: FONTS.bodySemiBold },
  screenHeader: { marginBottom: 22 },
  screenHeaderEyebrow: {
    color: COLORS.primary,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1.1,
  },
  screenHeaderTitle: { marginTop: 6, color: COLORS.text, fontFamily: FONTS.display, fontSize: 29 },
  screenHeaderSubtitle: {
    marginTop: 6,
    color: COLORS.textSecondary,
    fontFamily: FONTS.body,
    fontSize: 12,
  },
  routeSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 17,
    borderRadius: 18,
    backgroundColor: COLORS.primary,
  },
  routeSummaryEyebrow: {
    color: COLORS.primarySoft,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 9,
    letterSpacing: 0.8,
  },
  routeSummaryValue: { marginTop: 7, color: COLORS.white, fontFamily: FONTS.display, fontSize: 22 },
  progressRing: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 5,
    borderColor: COLORS.accent,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  progressValue: { color: COLORS.white, fontFamily: FONTS.displayBold, fontSize: 15 },
  routeStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    padding: 14,
    borderRadius: 16,
    backgroundColor: COLORS.card,
  },
  routeStatusIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySubtle,
  },
  routeStatusCopy: { flex: 1, marginLeft: 11 },
  routeStatusTitle: { color: COLORS.text, fontFamily: FONTS.bodySemiBold, fontSize: 12 },
  routeStatusDescription: {
    marginTop: 4,
    color: COLORS.textMuted,
    fontFamily: FONTS.body,
    fontSize: 10,
    lineHeight: 15,
  },
  timelineTitle: {
    marginTop: 24,
    marginBottom: 11,
    color: COLORS.text,
    fontFamily: FONTS.display,
    fontSize: 20,
  },
  timelineCard: { padding: 16, borderRadius: 18, backgroundColor: COLORS.card },
  timelineItem: { flexDirection: 'row', minHeight: 88 },
  timelineRail: { width: 27, alignItems: 'center' },
  timelineDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  timelineDotCompleted: { borderColor: COLORS.success, backgroundColor: COLORS.success },
  timelineDotActive: { borderColor: COLORS.accent, backgroundColor: COLORS.accentSoft },
  timelineLine: { width: 2, flex: 1, marginVertical: 4, backgroundColor: COLORS.border },
  timelineLineCompleted: { backgroundColor: COLORS.success },
  timelineContent: { flex: 1, marginLeft: 10, paddingBottom: 17 },
  timelineTopLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timelineStopName: { flex: 1, color: COLORS.text, fontFamily: FONTS.bodySemiBold, fontSize: 12 },
  timelineTime: {
    marginLeft: 8,
    color: COLORS.textMuted,
    fontFamily: FONTS.bodyMedium,
    fontSize: 10,
  },
  timelineDetail: { marginTop: 5, color: COLORS.textMuted, fontFamily: FONTS.body, fontSize: 10 },
  timelineTagRow: { marginTop: 8, flexDirection: 'row' },
  timelineTag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 7,
    backgroundColor: COLORS.page,
  },
  timelineTagCompleted: { backgroundColor: COLORS.successSoft },
  timelineTagActive: { backgroundColor: COLORS.accentSoft },
  timelineTagPending: { backgroundColor: COLORS.page },
  timelineTagText: { color: COLORS.textMuted, fontFamily: FONTS.bodyMedium, fontSize: 8 },
  timelineTagTextCompleted: { color: COLORS.success },
  timelineTagTextActive: { color: COLORS.accentStrong },
  profileTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 22,
  },
  demoMiniBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: COLORS.accentSoft,
  },
  demoMiniBadgeText: {
    color: COLORS.accentStrong,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 9,
    letterSpacing: 0.7,
  },
  profileCard: { alignItems: 'center', padding: 24, borderRadius: 22, overflow: 'hidden' },
  profileAvatarLarge: {
    width: 76,
    height: 76,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  profileAvatarText: { color: COLORS.white, fontFamily: FONTS.displayBold, fontSize: 25 },
  profileName: { marginTop: 13, color: COLORS.white, fontFamily: FONTS.display, fontSize: 24 },
  profileRole: { marginTop: 5, color: COLORS.primarySoft, fontFamily: FONTS.body, fontSize: 11 },
  profileCardFooter: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
    gap: 9,
    marginTop: 23,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.17)',
  },
  profileCardFooterItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  profileCardFooterText: { color: COLORS.white, fontFamily: FONTS.bodyMedium, fontSize: 10 },
  profileSectionTitle: {
    marginTop: 24,
    marginBottom: 10,
    color: COLORS.text,
    fontFamily: FONTS.display,
    fontSize: 19,
  },
  infoCard: { paddingHorizontal: 15, borderRadius: 18, backgroundColor: COLORS.card },
  infoRow: { minHeight: 67, flexDirection: 'row', alignItems: 'center' },
  infoRowBorder: { borderBottomWidth: 1, borderBottomColor: COLORS.border },
  infoIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySubtle,
  },
  infoCopy: { flex: 1, marginLeft: 11 },
  infoLabel: { color: COLORS.textMuted, fontFamily: FONTS.body, fontSize: 9 },
  infoValue: { marginTop: 4, color: COLORS.text, fontFamily: FONTS.bodySemiBold, fontSize: 12 },
  prototypeCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 14,
    borderRadius: 17,
    backgroundColor: COLORS.accentSoft,
  },
  prototypeIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  prototypeCopy: { flex: 1, marginLeft: 11 },
  prototypeTitle: { color: '#674D22', fontFamily: FONTS.bodySemiBold, fontSize: 12 },
  prototypeText: {
    marginTop: 5,
    color: '#805D28',
    fontFamily: FONTS.body,
    fontSize: 10,
    lineHeight: 16,
  },
  outlineButton: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginTop: 22,
    borderWidth: 1,
    borderColor: '#E7B9C0',
    borderRadius: 15,
    backgroundColor: COLORS.card,
  },
  outlineButtonPressed: { backgroundColor: '#FFF5F6' },
  outlineButtonText: { color: COLORS.danger, fontFamily: FONTS.bodySemiBold, fontSize: 12 },
  bottomNav: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    height: 76,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 22,
    borderTopWidth: 1,
    borderTopColor: '#E1E1ED',
    backgroundColor: 'rgba(255,255,255,0.97)',
  },
  bottomNavItem: { width: 70, alignItems: 'center', justifyContent: 'center', gap: 3 },
  bottomNavIcon: {
    width: 42,
    height: 30,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomNavIconActive: { backgroundColor: COLORS.primarySubtle },
  bottomNavLabel: { color: COLORS.textMuted, fontFamily: FONTS.bodyMedium, fontSize: 9 },
  bottomNavLabelActive: { color: COLORS.primary },
});
