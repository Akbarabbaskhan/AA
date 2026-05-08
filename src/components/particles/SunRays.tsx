import React, { useEffect } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing,
} from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Stop, Rect, G, Path } from 'react-native-svg';

const { width, height } = Dimensions.get('window');

export default function SunRays() {
  const rotate = useSharedValue(0);
  const scale = useSharedValue(1);

  useEffect(() => {
    rotate.value = withRepeat(
      withTiming(360, { duration: 20000, easing: Easing.linear }),
      -1,
      false,
    );
    scale.value = withRepeat(
      withTiming(1.08, { duration: 3000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotate.value}deg` }, { scale: scale.value }],
  }));

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <Animated.View style={[StyleSheet.absoluteFillObject, styles.raysContainer, style]}>
        <Svg width={width * 2} height={width * 2} viewBox={`0 0 ${width * 2} ${width * 2}`}>
          <Defs>
            <RadialGradient id="sunGrad" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#FFE580" stopOpacity="0.5" />
              <Stop offset="40%" stopColor="#FFD040" stopOpacity="0.25" />
              <Stop offset="100%" stopColor="#FFB830" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width={width * 2} height={width * 2} fill="url(#sunGrad)" />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  raysContainer: {
    top: -width * 0.2,
    left: -width * 0.5,
    opacity: 0.6,
  },
});
