import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { DailyForecast as DailyType } from '../../types/weather';
import WeatherIcon from './WeatherIcon';

interface Props {
  data: DailyType[];
  isLight: boolean;
}

export default function WeeklyForecast({ data, isLight }: Props) {
  const textColor = isLight ? '#1a1a2e' : '#ffffff';
  const subColor = isLight ? '#555' : 'rgba(255,255,255,0.7)';

  const allHighs = data.map(d => d.high);
  const allLows = data.map(d => d.low);
  const maxHigh = Math.max(...allHighs);
  const minLow = Math.min(...allLows);
  const range = maxHigh - minLow || 1;

  return (
    <View style={styles.container}>
      <BlurView intensity={20} tint={isLight ? 'light' : 'dark'} style={styles.blurCard}>
        <Text style={[styles.sectionTitle, { color: textColor }]}>7-Day Forecast</Text>
        {data.map((item, index) => {
          const barLeft = ((item.low - minLow) / range) * 60;
          const barWidth = ((item.high - item.low) / range) * 60;
          return (
            <View key={index} style={styles.row}>
              <Text style={[styles.dayText, { color: textColor }]}>{index === 0 ? 'Today' : item.day}</Text>
              <WeatherIcon condition={item.condition} size={24} />
              {item.chanceOfRain > 20 && (
                <Text style={styles.rainChance}>{item.chanceOfRain}%</Text>
              )}
              <View style={styles.tempBar}>
                <Text style={[styles.lowText, { color: subColor }]}>{item.low}°</Text>
                <View style={styles.barBg}>
                  <View style={[styles.barFill, { marginLeft: barLeft, width: Math.max(barWidth, 8) }]} />
                </View>
                <Text style={[styles.highText, { color: textColor }]}>{item.high}°</Text>
              </View>
            </View>
          );
        })}
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 24,
    borderRadius: 24,
    overflow: 'hidden',
  },
  blurCard: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
    opacity: 0.7,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.15)',
  },
  dayText: {
    width: 50,
    fontSize: 15,
    fontWeight: '600',
  },
  rainChance: {
    width: 36,
    fontSize: 11,
    color: '#5B8CFF',
    fontWeight: '600',
    textAlign: 'center',
  },
  tempBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  barBg: {
    flex: 1,
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 3,
  },
  barFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFB830',
  },
  lowText: {
    fontSize: 14,
    fontWeight: '500',
    width: 32,
    textAlign: 'right',
  },
  highText: {
    fontSize: 14,
    fontWeight: '700',
    width: 32,
    textAlign: 'right',
  },
});
