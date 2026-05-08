import React, { useEffect } from 'react';
import { TouchableOpacity } from 'react-native';
import Svg, {
  G, Path, Circle, Ellipse, Defs, RadialGradient, Stop, LinearGradient, Line,
} from 'react-native-svg';
import Animated, {
  useSharedValue, useAnimatedStyle, useAnimatedProps,
  withRepeat, withTiming, withSequence, withSpring, Easing, interpolate,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { WeatherCondition, MascotState } from '../../types/weather';
import { MASCOT_STATES } from '../../constants/weather';

const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);

interface Props {
  condition: WeatherCondition;
  size?: number;
}

export default function KawaiiMascot({ condition, size = 220 }: Props) {
  const state: MascotState = MASCOT_STATES[condition];

  const bodyY = useSharedValue(0);
  const bodyScale = useSharedValue(1);
  const bodyRotate = useSharedValue(0);
  const blinkRy = useSharedValue(8);
  const blushOpacity = useSharedValue(0.7);
  const shakeX = useSharedValue(0);

  useEffect(() => {
    // Blink
    blinkRy.value = withRepeat(
      withSequence(
        withTiming(8, { duration: 2400 }),
        withTiming(0.5, { duration: 80 }),
        withTiming(8, { duration: 80 }),
      ),
      -1,
    );

    // Blush
    blushOpacity.value = withTiming(
      ['happy', 'cozy'].includes(state.mood) ? 0.85 : 0.4,
      { duration: 800 }
    );

    // Body animation by mood
    bodyY.value = withTiming(0, { duration: 100 });
    bodyScale.value = withTiming(1, { duration: 100 });
    bodyRotate.value = withTiming(0, { duration: 100 });
    shakeX.value = withTiming(0, { duration: 100 });

    switch (state.animation) {
      case 'bounce':
        bodyY.value = withRepeat(
          withSequence(
            withTiming(-16, { duration: 500, easing: Easing.out(Easing.quad) }),
            withTiming(0, { duration: 500, easing: Easing.in(Easing.quad) }),
          ),
          -1,
        );
        bodyScale.value = withRepeat(
          withSequence(
            withTiming(1.05, { duration: 500 }),
            withTiming(0.97, { duration: 500 }),
          ),
          -1,
        );
        break;
      case 'float':
        bodyY.value = withRepeat(
          withSequence(
            withTiming(-10, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
            withTiming(4, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
          ),
          -1,
        );
        break;
      case 'shake':
        shakeX.value = withRepeat(
          withSequence(
            withTiming(-8, { duration: 80 }),
            withTiming(8, { duration: 80 }),
            withTiming(-6, { duration: 80 }),
            withTiming(6, { duration: 80 }),
            withTiming(0, { duration: 800 }),
          ),
          -1,
        );
        break;
      case 'shiver':
        shakeX.value = withRepeat(
          withSequence(
            withTiming(-3, { duration: 100 }),
            withTiming(3, { duration: 100 }),
          ),
          -1,
        );
        bodyY.value = withRepeat(
          withSequence(
            withTiming(-2, { duration: 200 }),
            withTiming(2, { duration: 200 }),
          ),
          -1,
        );
        break;
      case 'sway':
        bodyRotate.value = withRepeat(
          withSequence(
            withTiming(-10, { duration: 600, easing: Easing.inOut(Easing.sin) }),
            withTiming(10, { duration: 600, easing: Easing.inOut(Easing.sin) }),
          ),
          -1,
        );
        break;
      default:
        bodyY.value = withRepeat(
          withSequence(
            withTiming(-5, { duration: 3000, easing: Easing.inOut(Easing.sin) }),
            withTiming(2, { duration: 3000, easing: Easing.inOut(Easing.sin) }),
          ),
          -1,
        );
    }
  }, [condition]);

  const handleTap = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    bodyScale.value = withSequence(
      withSpring(1.2, { damping: 4, stiffness: 200 }),
      withSpring(1.0, { damping: 8, stiffness: 200 }),
    );
    blushOpacity.value = withSequence(
      withTiming(1, { duration: 150 }),
      withTiming(['happy', 'cozy'].includes(state.mood) ? 0.85 : 0.4, { duration: 600 }),
    );
  };

  const bodyAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: bodyY.value },
      { translateX: shakeX.value },
      { scale: bodyScale.value },
      { rotate: `${bodyRotate.value}deg` },
    ],
  }));

  const leftEyeProps = useAnimatedProps(() => ({ ry: blinkRy.value }));
  const rightEyeProps = useAnimatedProps(() => ({ ry: blinkRy.value }));
  const leftBlushProps = useAnimatedProps(() => ({ opacity: blushOpacity.value }));
  const rightBlushProps = useAnimatedProps(() => ({ opacity: blushOpacity.value }));

  const isHappy = state.mood === 'happy' || state.mood === 'cozy';
  const isScared = state.mood === 'scared';
  const isSleepy = state.mood === 'sleepy';
  const isSad = state.mood === 'sad';
  const isAnnoyed = state.mood === 'annoyed';
  const isCalm = state.mood === 'calm';

  const cx = 110;
  const cy = 110;

  return (
    <TouchableOpacity activeOpacity={0.9} onPress={handleTap}>
      <Animated.View style={[{ width: size, height: size }, bodyAnimStyle]}>
        <Svg width={size} height={size} viewBox="0 0 220 220">
          <Defs>
            <RadialGradient id="bodyGrad" cx="50%" cy="40%" r="55%">
              <Stop offset="0%" stopColor="#FFF8C8" />
              <Stop offset="55%" stopColor="#F5E060" />
              <Stop offset="100%" stopColor="#DDB830" />
            </RadialGradient>
            <RadialGradient id="blushGrad" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#FFB3C6" stopOpacity="0.9" />
              <Stop offset="100%" stopColor="#FF8FAB" stopOpacity="0" />
            </RadialGradient>
            <RadialGradient id="wingGrad" cx="40%" cy="30%" r="60%">
              <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
              <Stop offset="100%" stopColor="#D0E8FF" stopOpacity="0.55" />
            </RadialGradient>
            <LinearGradient id="creamGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#FFFFFF" />
              <Stop offset="100%" stopColor="#F0E8DC" />
            </LinearGradient>
            <LinearGradient id="scarfGrad" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0%" stopColor="#5B8CFF" />
              <Stop offset="50%" stopColor="#A78BFA" />
              <Stop offset="100%" stopColor="#5B8CFF" />
            </LinearGradient>
            <RadialGradient id="umbrellaGrad" cx="50%" cy="30%" r="70%">
              <Stop offset="0%" stopColor="#FFCCE0" />
              <Stop offset="100%" stopColor="#FF6B9D" />
            </RadialGradient>
          </Defs>

          {/* ── FAIRY WINGS ── */}
          {/* Left wing top */}
          <Path
            d={`M${cx - 10},${cy - 8} C${cx - 50},${cy - 52} ${cx - 75},${cy - 15} ${cx - 58},${cy + 12} C${cx - 44},${cy + 36} ${cx - 16},${cy + 22} ${cx - 10},${cy + 6} Z`}
            fill="url(#wingGrad)"
            stroke="#C8D8F8"
            strokeWidth="1"
            opacity="0.88"
          />
          {/* Left wing bottom */}
          <Path
            d={`M${cx - 10},${cy + 6} C${cx - 30},${cy + 40} ${cx - 55},${cy + 45} ${cx - 48},${cy + 22} C${cx - 42},${cy + 8} ${cx - 20},${cy + 14} ${cx - 10},${cy + 6} Z`}
            fill="url(#wingGrad)"
            stroke="#C8D8F8"
            strokeWidth="1"
            opacity="0.7"
          />
          {/* Right wing top */}
          <Path
            d={`M${cx + 10},${cy - 8} C${cx + 50},${cy - 52} ${cx + 75},${cy - 15} ${cx + 58},${cy + 12} C${cx + 44},${cy + 36} ${cx + 16},${cy + 22} ${cx + 10},${cy + 6} Z`}
            fill="url(#wingGrad)"
            stroke="#C8D8F8"
            strokeWidth="1"
            opacity="0.88"
          />
          {/* Right wing bottom */}
          <Path
            d={`M${cx + 10},${cy + 6} C${cx + 30},${cy + 40} ${cx + 55},${cy + 45} ${cx + 48},${cy + 22} C${cx + 42},${cy + 8} ${cx + 20},${cy + 14} ${cx + 10},${cy + 6} Z`}
            fill="url(#wingGrad)"
            stroke="#C8D8F8"
            strokeWidth="1"
            opacity="0.7"
          />

          {/* ── BODY ── */}
          {/* Feet / lower base */}
          <Ellipse cx={cx} cy={cy + 54} rx="22" ry="12" fill="#8B6347" opacity="0.9" />

          {/* Star body - outer glow */}
          <Path
            d={`M${cx},${cy - 58}
               C${cx - 10},${cy - 54} ${cx - 22},${cy - 48} ${cx - 30},${cy - 36}
               C${cx - 45},${cy - 20} ${cx - 60},${cy - 14} ${cx - 60},${cy}
               C${cx - 60},${cy + 16} ${cx - 46},${cy + 22} ${cx - 36},${cy + 30}
               C${cx - 26},${cy + 38} ${cx - 22},${cy + 48} ${cx - 10},${cy + 54}
               C${cx - 4},${cy + 57} ${cx + 4},${cy + 57} ${cx + 10},${cy + 54}
               C${cx + 22},${cy + 48} ${cx + 26},${cy + 38} ${cx + 36},${cy + 30}
               C${cx + 46},${cy + 22} ${cx + 60},${cy + 16} ${cx + 60},${cy}
               C${cx + 60},${cy - 14} ${cx + 45},${cy - 20} ${cx + 30},${cy - 36}
               C${cx + 22},${cy - 48} ${cx + 10},${cy - 54} ${cx},${cy - 58} Z`}
            fill="url(#bodyGrad)"
            stroke="#E0B830"
            strokeWidth="1.5"
          />

          {/* Ear tufts */}
          <Path d={`M${cx - 30},${cy - 36} C${cx - 42},${cy - 54} ${cx - 34},${cy - 66} ${cx - 20},${cy - 58} C${cx - 16},${cy - 52} ${cx - 18},${cy - 44} ${cx - 30},${cy - 36}`} fill="#F5E070" />
          <Path d={`M${cx + 30},${cy - 36} C${cx + 42},${cy - 54} ${cx + 34},${cy - 66} ${cx + 20},${cy - 58} C${cx + 16},${cy - 52} ${cx + 18},${cy - 44} ${cx + 30},${cy - 36}`} fill="#F5E070" />
          {/* Inner ear pink */}
          <Path d={`M${cx - 26},${cy - 40} C${cx - 33},${cy - 52} ${cx - 27},${cy - 60} ${cx - 18},${cy - 54} C${cx - 15},${cy - 48} ${cx - 18},${cy - 44} ${cx - 26},${cy - 40}`} fill="#FFD0E0" opacity="0.65" />
          <Path d={`M${cx + 26},${cy - 40} C${cx + 33},${cy - 52} ${cx + 27},${cy - 60} ${cx + 18},${cy - 54} C${cx + 15},${cy - 48} ${cx + 18},${cy - 44} ${cx + 26},${cy - 40}`} fill="#FFD0E0" opacity="0.65" />

          {/* Cream whip top */}
          <Path
            d={`M${cx - 15},${cy - 54}
               C${cx - 12},${cy - 66} ${cx - 5},${cy - 72} ${cx},${cy - 76}
               C${cx + 5},${cy - 72} ${cx + 12},${cy - 66} ${cx + 15},${cy - 54}
               C${cx + 8},${cy - 50} ${cx + 3},${cy - 56} ${cx},${cy - 58}
               C${cx - 3},${cy - 56} ${cx - 8},${cy - 50} ${cx - 15},${cy - 54} Z`}
            fill="url(#creamGrad)"
          />
          <Circle cx={cx} cy={cy - 78} r="4" fill="white" opacity="0.9" />
          <Circle cx={cx} cy={cy - 83} r="2.5" fill="#F5F0E8" opacity="0.8" />

          {/* Chocolate drizzle */}
          <Path d={`M${cx - 18},${cy - 48} C${cx - 24},${cy - 32} ${cx - 16},${cy - 16} ${cx - 22},${cy + 2}`} fill="none" stroke="#8B6347" strokeWidth="2.5" strokeLinecap="round" opacity="0.65" />
          <Path d={`M${cx + 14},${cy - 44} C${cx + 20},${cy - 28} ${cx + 11},${cy - 12} ${cx + 18},${cy + 6}`} fill="none" stroke="#8B6347" strokeWidth="2" strokeLinecap="round" opacity="0.55" />

          {/* Arms */}
          <Ellipse cx={cx - 52} cy={cy + 6} rx="11" ry="8" fill="#EDCA50" transform={`rotate(-25,${cx - 52},${cy + 6})`} />
          <Ellipse cx={cx + 52} cy={cy + 6} rx="11" ry="8" fill="#EDCA50" transform={`rotate(25,${cx + 52},${cy + 6})`} />

          {/* ── BLUSH ── */}
          <AnimatedEllipse
            cx={cx - 23} cy={cy + 14} rx="14" ry="9"
            fill="url(#blushGrad)"
            animatedProps={leftBlushProps}
          />
          <AnimatedEllipse
            cx={cx + 23} cy={cy + 14} rx="14" ry="9"
            fill="url(#blushGrad)"
            animatedProps={rightBlushProps}
          />

          {/* ── EYES ── */}
          {isSleepy ? (
            <>
              <Path d={`M${cx - 17},${cy - 1} C${cx - 17},${cy - 10} ${cx - 7},${cy - 10} ${cx - 7},${cy - 1}`} fill="#2D2D2D" />
              <Path d={`M${cx + 7},${cy - 1} C${cx + 7},${cy - 10} ${cx + 17},${cy - 10} ${cx + 17},${cy - 1}`} fill="#2D2D2D" />
              <Path d={`M${cx + 20},${cy - 22} L${cx + 26},${cy - 22} L${cx + 20},${cy - 28} L${cx + 26},${cy - 28}`} fill="none" stroke="#B0B0D0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
            </>
          ) : isScared ? (
            <>
              <Circle cx={cx - 13} cy={cy - 5} r="9" fill="white" />
              <Circle cx={cx + 13} cy={cy - 5} r="9" fill="white" />
              <Circle cx={cx - 13} cy={cy - 5} r="6" fill="#1a1a2e" />
              <Circle cx={cx + 13} cy={cy - 5} r="6" fill="#1a1a2e" />
              <Circle cx={cx - 10} cy={cy - 8} r="2" fill="white" />
              <Circle cx={cx + 16} cy={cy - 8} r="2" fill="white" />
            </>
          ) : isAnnoyed ? (
            <>
              <Path d={`M${cx - 19},${cy - 2} C${cx - 14},${cy - 9} ${cx - 7},${cy - 9} ${cx - 5},${cy - 2}`} fill="#2D2D2D" />
              <Path d={`M${cx + 5},${cy - 2} C${cx + 7},${cy - 9} ${cx + 14},${cy - 9} ${cx + 19},${cy - 2}`} fill="#2D2D2D" />
              <Line x1={cx - 20} y1={cy - 14} x2={cx - 5} y2={cy - 18} stroke="#5D4037" strokeWidth="2.5" strokeLinecap="round" />
              <Line x1={cx + 20} y1={cy - 14} x2={cx + 5} y2={cy - 18} stroke="#5D4037" strokeWidth="2.5" strokeLinecap="round" />
            </>
          ) : (
            <>
              <AnimatedEllipse
                cx={cx - 13} cy={cy - 4} rx="7"
                fill="#1a1a2e"
                animatedProps={leftEyeProps}
              />
              <AnimatedEllipse
                cx={cx + 13} cy={cy - 4} rx="7"
                fill="#1a1a2e"
                animatedProps={rightEyeProps}
              />
              <Circle cx={cx - 10} cy={cy - 7} r="2.5" fill="white" opacity="0.9" />
              <Circle cx={cx + 16} cy={cy - 7} r="2.5" fill="white" opacity="0.9" />
            </>
          )}

          {/* ── MOUTH ── */}
          {isHappy && (
            <Path d={`M${cx - 11},${cy + 20} C${cx - 6},${cy + 28} ${cx + 6},${cy + 28} ${cx + 11},${cy + 20}`} fill="none" stroke="#5D4037" strokeWidth="2.5" strokeLinecap="round" />
          )}
          {isSad && (
            <Path d={`M${cx - 11},${cy + 27} C${cx - 6},${cy + 20} ${cx + 6},${cy + 20} ${cx + 11},${cy + 27}`} fill="none" stroke="#5D4037" strokeWidth="2.5" strokeLinecap="round" />
          )}
          {isScared && (
            <Ellipse cx={cx} cy={cy + 24} rx="9" ry="8" fill="#3D2010" />
          )}
          {(isAnnoyed || isCalm) && (
            <Line x1={cx - 10} y1={cy + 23} x2={cx + 10} y2={cy + 23} stroke="#5D4037" strokeWidth="2.5" strokeLinecap="round" />
          )}
          {isSleepy && (
            <Path d={`M${cx - 8},${cy + 22} C${cx - 4},${cy + 27} ${cx + 4},${cy + 27} ${cx + 8},${cy + 22}`} fill="none" stroke="#5D4037" strokeWidth="2" strokeLinecap="round" />
          )}

          {/* ── UMBRELLA ── */}
          {state.accessory === 'umbrella' && (
            <G transform={`translate(${cx - 50},${cy - 78})`}>
              <Path d="M2,32 C2,5 48,5 48,32 C40,20 10,20 2,32 Z" fill="url(#umbrellaGrad)" stroke="#FF6B9D" strokeWidth="1.5" />
              <Line x1="25" y1="32" x2="25" y2="72" stroke="#FF6B9D" strokeWidth="3" strokeLinecap="round" />
              <Path d="M25,72 C25,82 18,88 15,82" fill="none" stroke="#FF6B9D" strokeWidth="3" strokeLinecap="round" />
              <Line x1="8" y1="20" x2="25" y2="32" stroke="#FFB3C8" strokeWidth="1" opacity="0.7" />
              <Line x1="25" y1="14" x2="25" y2="32" stroke="#FFB3C8" strokeWidth="1" opacity="0.7" />
              <Line x1="42" y1="20" x2="25" y2="32" stroke="#FFB3C8" strokeWidth="1" opacity="0.7" />
            </G>
          )}

          {/* ── SCARF ── */}
          {state.accessory === 'scarf' && (
            <G>
              <Path
                d={`M${cx - 40},${cy + 30} C${cx - 34},${cy + 22} ${cx},${cy + 20} ${cx + 34},${cy + 22} C${cx + 40},${cy + 26} ${cx + 40},${cy + 34} ${cx + 34},${cy + 38} C${cx},${cy + 44} ${cx - 34},${cy + 38} ${cx - 40},${cy + 30} Z`}
                fill="url(#scarfGrad)" opacity="0.95"
              />
              <Path d={`M${cx + 32},${cy + 36} C${cx + 42},${cy + 44} ${cx + 37},${cy + 58} ${cx + 28},${cy + 62}`} fill="none" stroke="#5B8CFF" strokeWidth="10" strokeLinecap="round" />
              <Path d={`M${cx - 38},${cy + 29} C${cx - 30},${cy + 27} ${cx},${cy + 25} ${cx + 30},${cy + 27}`} fill="none" stroke="#C4B5FD" strokeWidth="2" strokeDasharray="4,3" opacity="0.8" />
            </G>
          )}

          {/* ── NIGHT STARS ── */}
          {(condition === 'night' || condition === 'night_cloudy' || condition === 'night_rainy') && (
            <G opacity="0.85">
              <Path d={`M36,26 L38,20 L40,26 L46,28 L40,30 L38,36 L36,30 L30,28 Z`} fill="#FFE566" />
              <Path d={`M170,42 L172,36 L174,42 L180,44 L174,46 L172,52 L170,46 L164,44 Z`} fill="#FFE566" opacity="0.7" />
              <Circle cx="164" cy="24" r="2.5" fill="#FFE566" opacity="0.6" />
              <Circle cx="50" cy="44" r="1.5" fill="#FFE566" opacity="0.5" />
            </G>
          )}
        </Svg>
      </Animated.View>
    </TouchableOpacity>
  );
}
