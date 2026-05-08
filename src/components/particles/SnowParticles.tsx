import React, { useEffect } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, withDelay, Easing,
} from 'react-native-reanimated';

const { width, height } = Dimensions.get('window');
const FLAKE_COUNT = 35;

function Snowflake({ index }: { index: number }) {
  const y = useSharedValue(-20);
  const x0 = Math.random() * width;
  const sway = useSharedValue(0);
  const size = 4 + Math.random() * 7;
  const duration = 3000 + Math.random() * 3000;
  const delay = Math.random() * 3000;
  const opacity = 0.5 + Math.random() * 0.5;

  useEffect(() => {
    y.value = withDelay(
      delay,
      withRepeat(withTiming(height + 20, { duration, easing: Easing.linear }), -1, false),
    );
    sway.value = withRepeat(
      withTiming(30, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }, { translateX: sway.value }],
  }));

  return (
    <Animated.View
      style={[styles.flake, { left: x0, width: size, height: size, borderRadius: size / 2, opacity }, style]}
    />
  );
}

export default function SnowParticles() {
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {Array.from({ length: FLAKE_COUNT }).map((_, i) => (
        <Snowflake key={i} index={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flake: {
    position: 'absolute',
    top: -20,
    backgroundColor: '#FFFFFF',
  },
});
