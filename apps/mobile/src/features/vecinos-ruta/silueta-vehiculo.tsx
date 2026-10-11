import Svg, { ClipPath, Circle, Defs, Path, Rect } from 'react-native-svg';
import { quivoColors } from '../../shared/theme/quivo-theme';
import { variantePorTipo, type VarianteSilueta } from './silueta-vehiculo-variante';
import { colorSecundarioAHex, colorVehiculoAHex } from './color-vehiculo';

interface Props {
  tipo: string;
  color: string;
  colorSecundario: string | null;
  /** Fila vacía / sin dato: contorno punteado sin color. */
  fantasma?: boolean;
}

const CUERPO: Record<VarianteSilueta, string> = {
  bus: 'M2 24V9a3 3 0 0 1 3-3h50a4 4 0 0 1 3.6 2.2L62 17c.7 1.4 1 2.8 1 4.5V24z',
  minibus: 'M3 24V10a4 4 0 0 1 4-4h38a5 5 0 0 1 3.7 1.7L58 18c1.3 1.4 2 3 2 5v1z',
  micro: 'M6 24V14a3 3 0 0 1 3-3h10l7-5h14a6 6 0 0 1 4.5 2L52 17c3 .6 6 2 6 5v2z',
};

/** Ventanas por variante, dentro del cuerpo (el micro es más bajo y corto que el bus). */
const VENTANAS: Record<VarianteSilueta, string> = {
  bus: 'M7 10h9v7H7zM18 10h9v7h-9zM29 10h9v7h-9zM40 10h9v7h-9z',
  minibus: 'M8 10h9v7H8zM19 10h9v7h-9zM30 10h9v7h-9z',
  micro: 'M9 15h7v4H9zM28 10h8v7h-8zM38 10h6v7h-6z',
};

/**
 * Silueta lateral decorativa; el color real del vehículo entra como relleno. La franja del color
 * secundario se recorta al cuerpo de cada variante para que no sobresalga de la carrocería.
 */
export function SiluetaVehiculo({ tipo, color, colorSecundario, fantasma }: Props) {
  const variante = variantePorTipo(tipo);
  const cuerpo = CUERPO[variante];
  if (fantasma) {
    return (
      <Svg width={48} height={24} viewBox="0 0 64 32" accessible={false}>
        <Path
          d={cuerpo}
          fill="none"
          stroke={quivoColors.textMuted}
          strokeWidth={1.8}
          strokeDasharray="3 3"
          strokeLinejoin="round"
        />
        <Circle cx={16} cy={25} r={4.5} fill="none" stroke={quivoColors.textMuted} strokeWidth={1.8} />
        <Circle cx={47} cy={25} r={4.5} fill="none" stroke={quivoColors.textMuted} strokeWidth={1.8} />
      </Svg>
    );
  }
  const secundario = colorSecundarioAHex(colorSecundario);
  const idClip = `cuerpo-${variante}`;
  return (
    <Svg width={48} height={24} viewBox="0 0 64 32" accessible={false}>
      <Defs>
        <ClipPath id={idClip}>
          <Path d={cuerpo} />
        </ClipPath>
      </Defs>
      <Path
        d={cuerpo}
        fill={colorVehiculoAHex(color)}
        stroke={quivoColors.text}
        strokeOpacity={0.6}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {secundario ? (
        <Rect
          x={0}
          y={19.5}
          width={64}
          height={3}
          fill={secundario}
          clipPath={`url(#${idClip})`}
        />
      ) : null}
      <Path d={VENTANAS[variante]} fill={quivoColors.white} fillOpacity={0.92} />
      <Circle cx={16} cy={25} r={5} fill={quivoColors.text} />
      <Circle cx={16} cy={25} r={2} fill={quivoColors.border} />
      <Circle cx={47} cy={25} r={5} fill={quivoColors.text} />
      <Circle cx={47} cy={25} r={2} fill={quivoColors.border} />
    </Svg>
  );
}
