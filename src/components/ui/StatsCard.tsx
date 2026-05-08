import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import Svg, { Path, Circle, Line } from 'react-native-svg';

interface StatItem {
  icon: 'humidity' | 'wind' | 'uv' | 'visibility' | 'feels';
  label: string;
  value: string;
}

interface Props {
  items: StatItem[];
  isLight: boolean;
}

function StatIcon({ type, color }: { type: StatItem['icon']; color: string }) {
  switch (type) {
    case 'humidity':
      return (
        <Svg width="18" height="18" viewBox="0 0 24 24">
          <Path d="M12 2 L18 10 C18 14 15 18 12 18 C9 18 6 14 6 10 Z" fill={color} opacity="0.8" />
        </Svg>
      );
    case 'wind':
      return (
        <Svg width="18" height="18" viewBox="0 0 24 24">
          <Path d="M3,8 L18,8 C20,8 21,7 21,5 C21,3 20,2 18,2" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
          <Path d="M3,12 L20,12 C22,12 23,11 23,9" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
          <Path d="M3,16 L16,16 C18,16 19,17 19,19 C19,21 18,22 16,22" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </Svg>
      );
    case 'uv':
      return (
        <Svg width="18" height="18" viewBox="0 0 24 24">
          <Circle cx="12" cy="12" r="4" fill={color} opacity="0.8" />
          {[0, 60, 120, 180, 240, 300].map((a, i) => {
            const rad = (a * Math.PI) / 180;
            return <Line key={i} x1={12 + 6 * Math.cos(rad)} y1={12 + 6 * Math.sin(rad)} x2={12 + 9 * Math.cos(rad)} y2={12 + 9 * Math.sin(rad)} stroke={color} strokeWidth="2" strokeLinecap="round" />;
          })}
        </Svg>
      );
    case 'visibility':
      return (
        <Svg width="18" height="18" viewBox="0 0 24 24">
          <Path d="M1,12 C4,6 8,3 12,3 C16,3 20,6 23,12 C20,18 16,21 12,21 C8,21 4,18 1,12 Z" fill="none" stroke={color} strokeWidth="2" />
          <Circle cx="12" cy="12" r="4" fill={color} opacity="0.7" />
        </Svg>
      );
    case 'feels':
      return (
        <Svg width="18" height="18" viewBox="0 0 24 24">
          <Path d="M12,2 C14,2 16,4 16,7 L16,14 C17.5,15 18,16.5 18,18 C18,21 15.3,23 12,23 C8.7,23 6,21 6,18 C6,16.5 6.5,15 8,14 L8,7 C8,4 10,2 12,2 Z" fill="none" stroke={color} strokeWidth="1.5" />
          <Path d="M12,16 C13,16 14,17 14,18 C14,19 13,20 12,20 C11,20 10,19 10,18 C10,17 11,16 12,16 Z" fill={color} opacity="0.8" />
        </Svg>
      );
    default:
      return null;
  }
}

export default function StatsCard({ items, isLight }: Props) {
  const textColor = isLight ? '#1a1a2e' : '#ffffff';
  const subColor = isLight ? '#555' : 'rgba(255,255,255,0.65)';
  const iconColor = isLight ? '#444' : 'rgba(255,255,255,0.8)';

  return (
    <View style={styles.container}>
      <BlurView intensity={20} tint={isLight ? 'light' : 'dark'} style={styles.blurCard}>
        <View style={styles.grid}>
          {items.map((item, i) => (
            <View key={i} style={styles.item}>
              <StatIcon type={item.icon} color={iconColor} />
              <Text style={[styles.label, { color: subColor }]}>{item.label}</Text>
              <Text style={[styles.value, { color: textColor }]}>{item.value}</Text>
            </View>
          ))}
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 24,
    overflow: 'hidden',
  },
  blurCard: {
    padding: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  item: {
    width: '46%',
    alignItems: 'flex-start',
    gap: 4,
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16,
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  value: {
    fontSize: 18,
    fontWeight: '700',
  },
});
