import React from 'react';
import Svg, { ClipPath, Defs, Ellipse, G, Path } from 'react-native-svg';
import { useTheme } from '@/hooks/useTheme';
import { brand } from '@/constants/theme';

// The Quo mark (Q speech bubble, orbit ring, sparkles) from the brand
// logo.svg, drawn as vectors so it stays crisp and recolours per theme.
// Coordinates are the original 1024-unit artwork; the viewBox is cropped to
// the mark's measured bounds (incl. strokes) so `size` is the visible width.

const Q_OUTER =
  'M 490 200 C 682 200 812 340 812 505 C 812 592 784 652 745 696 L 803 828 Q 816 862 780 856 L 600 798 C 565 808 528 812 490 812 C 298 812 175 680 175 505 C 175 330 298 200 490 200 Z';
const Q_SHAPE =
  `${Q_OUTER} M 495 320 C 380 320 302 400 302 510 C 302 620 380 700 495 700 C 525 700 552 695 575 688 L 652 734 Q 674 744 667 721 L 640 668 C 670 630 688 580 688 510 C 688 400 610 320 495 320 Z`;
const RING_FRONT = 'M -455 0 A 455 95 0 0 0 455 0';
const SPARKLES = [
  'M 238 128 C 243 166 254 178 294 183 C 254 188 243 200 238 238 C 233 200 222 188 182 183 C 222 178 233 166 238 128 Z',
  'M 141 266 C 144 292 151 299 178 303 C 151 307 144 314 141 340 C 138 314 131 307 104 303 C 131 299 138 292 141 266 Z',
  'M 886 602 C 890 636 900 645 934 650 C 900 655 890 664 886 698 C 882 664 872 655 838 650 C 872 645 882 636 886 602 Z',
];

const VIEW_BOX = { x: 55, y: 121, width: 900, height: 755 };
export const QUO_LOGO_ASPECT = VIEW_BOX.width / VIEW_BOX.height;

interface QuoLogoProps {
  /** Rendered width in dp; height follows the mark's aspect ratio. */
  size: number;
  /** Mark colour. Defaults to brand indigo on light, white on dark. */
  color?: string;
  /**
   * Colour of whatever sits behind the mark — the ring's separation gap is
   * painted in it. Defaults to the theme background.
   */
  backgroundColor?: string;
  /** Hide the sparkles (e.g. very small sizes). */
  sparkles?: boolean;
  /** Ring stroke in artwork units; thicken slightly for small renders. */
  ringWidth?: number;
}

export function QuoLogo({ size, color, backgroundColor, sparkles = true, ringWidth = 24 }: QuoLogoProps) {
  const { colors, isDark } = useTheme();
  const mark = color ?? (isDark ? brand.white : brand.indigo);
  const gap = backgroundColor ?? colors.background;
  const ringTransform = 'translate(505 470) rotate(-18)';

  return (
    <Svg
      width={size}
      height={size / QUO_LOGO_ASPECT}
      viewBox={`${VIEW_BOX.x} ${VIEW_BOX.y} ${VIEW_BOX.width} ${VIEW_BOX.height}`}
      accessibilityLabel="Quo"
    >
      <Defs>
        <ClipPath id="quo-q-clip">
          <Path d={Q_OUTER} />
        </ClipPath>
      </Defs>

      {/* Full ring; its back half is then covered by the Q and its gap */}
      <G transform={ringTransform}>
        <Ellipse cx={0} cy={0} rx={455} ry={95} fill="none" stroke={mark} strokeWidth={ringWidth} />
      </G>
      <Path d={Q_OUTER} fill={gap} stroke={gap} strokeWidth={30} strokeLinejoin="round" />
      <Path d={Q_SHAPE} fill={mark} fillRule="evenodd" />

      {/* Front of the ring over the Q, with a gap only where it crosses it */}
      <G clipPath="url(#quo-q-clip)">
        <G transform={ringTransform}>
          <Path d={RING_FRONT} fill="none" stroke={gap} strokeWidth={ringWidth + 30} />
        </G>
      </G>
      <G transform={ringTransform}>
        <Path d={RING_FRONT} fill="none" stroke={mark} strokeWidth={ringWidth} />
      </G>

      {sparkles && (
        <G fill={mark} stroke={mark} strokeWidth={6} strokeLinejoin="round">
          {SPARKLES.map((d) => <Path key={d} d={d} />)}
        </G>
      )}
    </Svg>
  );
}
