import React from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { WeatherCondition } from '../../types/weather';
import { WEATHER_GRADIENTS } from '../../constants/weather';
import RainParticles from '../particles/RainParticles';
import SnowParticles from '../particles/SnowParticles';
import LeafParticles from '../particles/LeafParticles';
import LightningEffect from '../particles/LightningEffect';
import FogEffect from '../particles/FogEffect';
import SunRays from '../particles/SunRays';
import StarField from '../particles/StarField';

interface Props {
  condition: WeatherCondition;
  children: React.ReactNode;
}

export default function WeatherScene({ condition, children }: Props) {
  const gradient = WEATHER_GRADIENTS[condition] as [string, string, ...string[]];

  return (
    <LinearGradient colors={gradient} style={styles.container} start={{ x: 0.3, y: 0 }} end={{ x: 0.7, y: 1 }}>
      {condition === 'sunny' && <SunRays />}
      {(condition === 'night' || condition === 'night_cloudy') && <StarField />}
      {(condition === 'rainy' || condition === 'night_rainy') && <RainParticles />}
      {condition === 'thunderstorm' && (
        <>
          <RainParticles />
          <LightningEffect />
        </>
      )}
      {condition === 'snow' && <SnowParticles />}
      {condition === 'windy' && <LeafParticles />}
      {condition === 'fog' && <FogEffect />}
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
