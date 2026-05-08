import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, withDelay, Easing,
} from 'react-native-reanimated';

const { width, height } = Dimensions.get('window');
const DROP_COUNT = 30;

function RainDrop({ index }: { index: number }) {
  const y = useSharedValue(-20);
  const x = (Math.random() * width * 1.3) - width * 0.15;
  const duration = 700 + Math.random() * 500;
  const delay = Math.random() * 1200;
  const dropHeight = 15 + Math.random() * 20;
  const opacity = 0.3 + Math.random() * 0.5;

  useEffect(() => {
    y.value = withDelay(
      delay,
      withRepeat(
        withTiming(height + 20, { duration, easing: Easing.linear }),
        -1,
        false,
      ),
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
  }));

  return (
    <Animated.View
      style={[styles.drop, { left: x, height: dropHeight, opacity }, style]}
    />
  );
}

export default function RainParticles() {
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {Array.from({ length: DROP_COUNT }).map((_, i) => (
        <RainDrop key={i} index={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  drop: {
    position: 'absolute',
    top: -30,
    width: 2,
    borderRadius: 2,
    backgroundColor: '#A8C8FF',
  },
});
