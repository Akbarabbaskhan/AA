import React, { useEffect } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, withDelay, Easing,
} from 'react-native-reanimated';

const { width, height } = Dimensions.get('window');

function FogLayer({ index }: { index: number }) {
  const x = useSharedValue(index % 2 === 0 ? -width : width);
  const opacity = useSharedValue(0);
  const duration = 8000 + index * 2000;
  const yPos = (height * 0.15) + index * (height * 0.12);

  useEffect(() => {
    opacity.value = withDelay(
      index * 500,
      withRepeat(
        withTiming(0.18 + index * 0.04, { duration: 3000 }),
        -1,
        true,
      ),
    );
    x.value = withRepeat(
      withTiming(index % 2 === 0 ? width * 0.3 : -width * 0.3, {
        duration,
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      true,
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[styles.layer, { top: yPos, width: width * 1.5, height: 80 + index * 20 }, style]}
    />
  );
}

export default function FogEffect() {
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {Array.from({ length: 5 }).map((_, i) => (
        <FogLayer key={i} index={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: -width * 0.25,
    backgroundColor: '#C8D8E8',
    borderRadius: 50,
  },
});
