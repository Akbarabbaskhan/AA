import React, { useEffect } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, withDelay, Easing,
} from 'react-native-reanimated';

const { width, height } = Dimensions.get('window');
const LEAF_COUNT = 12;
const LEAF_COLORS = ['#A8D5A2', '#F4A261', '#E76F51', '#E9C46A', '#84C36E'];

function Leaf({ index }: { index: number }) {
  const x = useSharedValue(-30);
  const y0 = Math.random() * height * 0.7 + 50;
  const rotate = useSharedValue(0);
  const yWave = useSharedValue(0);
  const duration = 1800 + Math.random() * 1200;
  const delay = Math.random() * 2000;
  const size = 10 + Math.random() * 10;
  const color = LEAF_COLORS[Math.floor(Math.random() * LEAF_COLORS.length)];

  useEffect(() => {
    x.value = withDelay(
      delay,
      withRepeat(withTiming(width + 30, { duration, easing: Easing.linear }), -1, false),
    );
    rotate.value = withRepeat(
      withTiming(360, { duration: 1000, easing: Easing.linear }),
      -1,
      false,
    );
    yWave.value = withRepeat(
      withTiming(60, { duration: 800, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: yWave.value },
      { rotate: `${rotate.value}deg` },
    ],
  }));

  return (
    <Animated.View
      style={[
        styles.leaf,
        { top: y0, width: size, height: size * 0.6, borderRadius: size / 3, backgroundColor: color },
        style,
      ]}
    />
  );
}

export default function LeafParticles() {
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {Array.from({ length: LEAF_COUNT }).map((_, i) => (
        <Leaf key={i} index={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  leaf: {
    position: 'absolute',
    left: -30,
    opacity: 0.85,
  },
});
