import React, { useEffect } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, withDelay, Easing,
} from 'react-native-reanimated';

const { width, height } = Dimensions.get('window');
const STAR_COUNT = 40;

function Star({ index }: { index: number }) {
  const opacity = useSharedValue(Math.random() * 0.5 + 0.3);
  const x = Math.random() * width;
  const y = Math.random() * height * 0.6;
  const size = 1 + Math.random() * 3;

  useEffect(() => {
    opacity.value = withDelay(
      Math.random() * 2000,
      withRepeat(
        withTiming(Math.random() * 0.4 + 0.6, { duration: 1500 + Math.random() * 1500 }),
        -1,
        true,
      ),
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[styles.star, { left: x, top: y, width: size, height: size, borderRadius: size / 2 }, style]}
    />
  );
}

export default function StarField() {
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {Array.from({ length: STAR_COUNT }).map((_, i) => (
        <Star key={i} index={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  star: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
  },
});
