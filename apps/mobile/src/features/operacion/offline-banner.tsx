import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { quivoFonts, quivoRadius, quivoSpacing } from '../../shared/theme/quivo-theme';

export function OfflineBanner({ isOffline }: { isOffline: boolean }) {
  const height = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (isOffline) {
      height.value = withSpring(56, { damping: 15, stiffness: 100 });
      opacity.value = withTiming(1, { duration: 300 });
    } else {
      height.value = withTiming(0, { duration: 300 });
      opacity.value = withTiming(0, { duration: 200 });
    }
  }, [isOffline, height, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    height: height.value,
    opacity: opacity.value,
    overflow: 'hidden',
    marginTop: height.value > 0 ? quivoSpacing.sm : 0,
  }));

  return (
    <Animated.View style={[styles.container, animatedStyle]}>
      <View style={styles.content}>
        <Ionicons name="cloud-offline" size={24} color="#C96800" style={styles.icon} />
        <View style={styles.textContainer}>
          <Text style={styles.text}>
            Trabajando offline. Los eventos se sincronizarán al recuperar conexión.
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFE5C5',
    borderRadius: quivoRadius.lg,
    borderWidth: 1,
    borderColor: '#FFC480',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: quivoSpacing.md,
    paddingVertical: quivoSpacing.sm,
    height: 56,
  },
  icon: {
    marginRight: quivoSpacing.sm,
  },
  textContainer: {
    flex: 1,
  },
  text: {
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 13,
    color: '#8A4700',
    lineHeight: 18,
  },
});
