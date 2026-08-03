import Svg, { Circle, Path } from 'react-native-svg';
import { quivoColors } from '../theme/quivo-theme';

export type QuivoIconName =
  | 'route'
  | 'alert-triangle'
  | 'user'
  | 'chevron-left'
  | 'location';

interface QuivoIconProps {
  name: QuivoIconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

/** Iconografía lineal compartida con QUIVO Rutas y adaptada a React Native. */
export function QuivoIcon({
  name,
  size = 22,
  color = quivoColors.primary,
  strokeWidth = 2,
}: QuivoIconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityElementsHidden
    >
      {name === 'route' ? (
        <>
          <Circle cx="6" cy="19" r="3" />
          <Path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
          <Circle cx="18" cy="5" r="3" />
        </>
      ) : null}
      {name === 'alert-triangle' ? (
        <>
          <Path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <Path d="M12 9v4" />
          <Path d="M12 17h.01" />
        </>
      ) : null}
      {name === 'user' ? (
        <>
          <Path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
          <Circle cx="12" cy="7" r="4" />
        </>
      ) : null}
      {name === 'chevron-left' ? <Path d="m15 18-6-6 6-6" /> : null}
      {name === 'location' ? (
        <>
          <Circle cx="12" cy="12" r="3" />
          <Circle cx="12" cy="12" r="9" />
        </>
      ) : null}
    </Svg>
  );
}
