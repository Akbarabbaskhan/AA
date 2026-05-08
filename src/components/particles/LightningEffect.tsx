import React, { useEffect } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';

const { width, height } = Dimensions.get('window');

export default function LightningEffect() {
  const flash = useSharedValue(0);

  useEffect(() => {
    flash.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 2000 }),
        withTiming(0.7, { duration: 50 }),
        withTiming(0, { duration: 80 }),
        withTiming(0.5, { duration: 60 }),
        withTiming(0, { duration: 100 }),
        withTiming(0, { duration: 1500 }),
      ),
      -1,
    );
  }, []);

  const flashStyle = useAnimatedStyle(() => ({
    opacity: flash.value,
  }));

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {/* Flash overlay */}
      <Animated.View style={[StyleSheet.absoluteFillObject, styles.flashOverlay, flashStyle]} />
      {/* Lightning bolt SVG */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFillObject}>
        <Defs>
          <LinearGradient id="boltGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#FFFFFF" />
            <Stop offset="100%" stopColor="#A8D8FF" />
          </LinearGradient>
        </Defs>
        <Path
          d={`M${width * 0.6},20 L${width * 0.45},${height * 0.35} L${width * 0.55},${height * 0.35} L${width * 0.38},${height * 0.65}`}
          fill="none"
          stroke="url(#boltGrad)"
          strokeWidth="3"
          opacity="0.6"
        />
        <Path
          d={`M${width * 0.25},40 L${width * 0.15},${height * 0.28} L${width * 0.22},${height * 0.28} L${width * 0.1},${height * 0.5}`}
          fill="none"
          stroke="url(#boltGrad)"
          strokeWidth="2"
          opacity="0.4"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  flashOverlay: {
    backgroundColor: '#E8F4FF',
  },
});
