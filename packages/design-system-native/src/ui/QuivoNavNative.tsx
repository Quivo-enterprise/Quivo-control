import { useMemo, useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type ImageSourcePropType,
} from "react-native";
import { colors, elevation, fontSize, fontWeight, radius, space, type QuivoTheme } from "../tokens";

/**
 * Router-agnostic contract shared across platforms — see
 * docs/design-system/14-proximos-pasos-multiplataforma.md (Fase 1). `route`
 * is an opaque string the host app's router resolves; this package never
 * imports a router.
 */
export type QuivoNavNativeItem = {
  id: string;
  label: string;
  route: string;
  /** Matches this route (or prefix) to decide whether the item is active, when different from `route`. */
  activeRoute?: string;
  external?: boolean;
};

export type QuivoNavNativeBrand = {
  /** Image source shown in dark theme (or the only logo, if the app has a single mark). */
  dark: ImageSourcePropType;
  /** Image source shown in light theme. Falls back to `dark` when omitted. */
  light?: ImageSourcePropType;
  alt: string;
};

export type QuivoNavNativeCta = {
  label: string;
  route: string;
};

export type QuivoNavNativeLanguage = {
  code: string;
  label: string;
};

export type QuivoNavNativeLabels = {
  themeToDark: string;
  themeToLight: string;
  openMenu: string;
  closeMenu: string;
};

export type QuivoNavNativeConfig = {
  brand: QuivoNavNativeBrand;
  items: readonly QuivoNavNativeItem[];
  cta?: QuivoNavNativeCta;
  languages?: readonly QuivoNavNativeLanguage[];
  labels?: Partial<QuivoNavNativeLabels>;
  defaultTheme?: QuivoTheme;
};

export type QuivoNavNativeProps = {
  config: QuivoNavNativeConfig;
  /** The app's current route, compared against each item's `activeRoute ?? route`. */
  currentRoute?: string;
  theme?: QuivoTheme;
  onThemeChange?: (theme: QuivoTheme) => void;
  language?: string;
  defaultLanguage?: string;
  onLanguageChange?: (language: string) => void;
  /** Resolves navigation for internal items and the CTA — this package never touches a router directly. */
  onNavigate?: (item: QuivoNavNativeItem | QuivoNavNativeCta) => void;
};

const MOBILE_BREAKPOINT = 720;

function isActiveItem(item: QuivoNavNativeItem, currentRoute?: string) {
  if (!currentRoute) return false;
  const target = item.activeRoute ?? item.route;
  return currentRoute === target || currentRoute.startsWith(`${target}/`);
}

export function QuivoNavNative({
  config,
  currentRoute,
  theme: themeProp,
  onThemeChange,
  language: languageProp,
  defaultLanguage,
  onLanguageChange,
  onNavigate,
}: QuivoNavNativeProps) {
  const { width } = useWindowDimensions();
  const isCompact = width < MOBILE_BREAKPOINT;

  const [internalTheme, setInternalTheme] = useState<QuivoTheme>(config.defaultTheme ?? "light");
  const theme = themeProp ?? internalTheme;

  const [internalLanguage, setInternalLanguage] = useState(defaultLanguage ?? config.languages?.[0]?.code ?? "es");
  const language = languageProp ?? internalLanguage;

  const labels: QuivoNavNativeLabels = {
    themeToDark: "Cambiar a tema oscuro",
    themeToLight: "Cambiar a tema claro",
    openMenu: "Abrir menú de navegación",
    closeMenu: "Cerrar menú",
    ...config.labels,
  };

  const [menuOpen, setMenuOpen] = useState(false);

  const c = colors[theme];
  const logoSource = useMemo(
    () => (theme === "light" ? config.brand.light ?? config.brand.dark : config.brand.dark),
    [theme, config.brand]
  );

  function handleThemeToggle() {
    const next: QuivoTheme = theme === "light" ? "dark" : "light";
    if (onThemeChange) onThemeChange(next);
    else setInternalTheme(next);
  }

  function handleLanguageSelect(code: string) {
    if (onLanguageChange) onLanguageChange(code);
    else setInternalLanguage(code);
  }

  function handleNavigate(item: QuivoNavNativeItem) {
    setMenuOpen(false);
    onNavigate?.(item);
  }

  function handleCta() {
    setMenuOpen(false);
    if (config.cta) onNavigate?.(config.cta);
  }

  const barBackground = theme === "light" ? "rgba(255, 255, 255, 0.96)" : "rgba(18, 12, 48, 0.9)";
  const borderColor = theme === "light" ? "rgba(50, 38, 180, 0.1)" : "rgba(255, 255, 255, 0.1)";

  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: barBackground,
          borderRadius: radius.full,
          borderWidth: 1,
          borderColor,
          paddingVertical: space.sm,
          paddingHorizontal: space.md,
          gap: space.md,
        },
        elevation(2),
      ]}
      accessibilityRole="header"
    >
      <Image
        source={logoSource}
        accessibilityLabel={config.brand.alt}
        style={{ height: 28, width: 96 }}
        resizeMode="contain"
      />

      {!isCompact && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            {config.items.map((item) => {
              const active = isActiveItem(item, currentRoute);
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="link"
                  accessibilityState={{ selected: active }}
                  onPress={() => handleNavigate(item)}
                  style={{
                    paddingVertical: space.xs,
                    paddingHorizontal: space.sm,
                    borderRadius: radius.md,
                    backgroundColor: active ? "rgba(253, 158, 21, 0.16)" : "transparent",
                  }}
                >
                  <Text
                    style={{
                      color: active ? c.accent : c.textPrimary,
                      fontSize: fontSize.sm,
                      fontWeight: active ? fontWeight.bold : fontWeight.medium,
                    }}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      )}

      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        {!isCompact && config.cta && (
          <Pressable
            onPress={handleCta}
            style={{
              paddingVertical: space.xs,
              paddingHorizontal: space.md,
              borderRadius: radius.full,
              backgroundColor: c.accent,
            }}
          >
            <Text style={{ color: c.black, fontSize: fontSize.sm, fontWeight: fontWeight.bold }}>
              {config.cta.label}
            </Text>
          </Pressable>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={theme === "light" ? labels.themeToDark : labels.themeToLight}
          onPress={handleThemeToggle}
          style={{ padding: space.xs }}
        >
          <Text style={{ fontSize: fontSize.md }}>{theme === "light" ? "\u{1F319}" : "☀️"}</Text>
        </Pressable>

        {isCompact && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={labels.openMenu}
            onPress={() => setMenuOpen(true)}
            style={{ padding: space.xs }}
          >
            <Text style={{ color: c.textPrimary, fontSize: fontSize.lg, fontWeight: fontWeight.bold }}>{"☰"}</Text>
          </Pressable>
        )}
      </View>

      <Modal visible={isCompact && menuOpen} animationType="slide" transparent onRequestClose={() => setMenuOpen(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(10, 7, 32, 0.5)" }}
          onPress={() => setMenuOpen(false)}
          accessibilityLabel={labels.closeMenu}
        >
          <View
            style={{
              marginTop: "auto",
              backgroundColor: theme === "light" ? c.surfacePage : c.surfaceCard,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              padding: space.lg,
              gap: space.sm,
            }}
          >
            {config.items.map((item) => {
              const active = isActiveItem(item, currentRoute);
              return (
                <Pressable
                  key={item.id}
                  onPress={() => handleNavigate(item)}
                  style={{
                    paddingVertical: space.sm,
                    paddingHorizontal: space.md,
                    borderRadius: radius.md,
                    backgroundColor: active ? "rgba(253, 158, 21, 0.16)" : "transparent",
                  }}
                >
                  <Text
                    style={{
                      color: active ? c.accentStrong : c.textPrimary,
                      fontSize: fontSize.md,
                      fontWeight: active ? fontWeight.bold : fontWeight.medium,
                    }}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}

            {config.languages && config.languages.length > 0 && (
              <View style={{ flexDirection: "row", gap: space.xs, marginTop: space.sm }}>
                {config.languages.map((lang) => (
                  <Pressable
                    key={lang.code}
                    onPress={() => handleLanguageSelect(lang.code)}
                    style={{
                      paddingVertical: space.xs,
                      paddingHorizontal: space.sm,
                      borderRadius: radius.sm,
                      backgroundColor: language === lang.code ? "rgba(253, 158, 21, 0.16)" : "transparent",
                    }}
                  >
                    <Text
                      style={{
                        color: language === lang.code ? c.accentStrong : c.textSecondary,
                        fontSize: fontSize.sm,
                        fontWeight: fontWeight.semibold,
                      }}
                    >
                      {lang.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            {config.cta && (
              <Pressable
                onPress={handleCta}
                style={{
                  marginTop: space.sm,
                  alignItems: "center",
                  paddingVertical: space.sm,
                  borderRadius: radius.full,
                  backgroundColor: c.accent,
                }}
              >
                <Text style={{ color: c.black, fontSize: fontSize.sm, fontWeight: fontWeight.bold }}>
                  {config.cta.label}
                </Text>
              </Pressable>
            )}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
