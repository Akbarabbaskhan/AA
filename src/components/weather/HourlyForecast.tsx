import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { HourlyForecast as HourlyType } from '../../types/weather';
import WeatherIcon from './WeatherIcon';

interface Props {
  data: HourlyType[];
  isLight: boolean;
}

function formatHour(hour: number | string): string {
  const h = Number(hour);
  if (h === 0) return '12 AM';
  if (h === 12) return '12 PM';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

export default function HourlyForecast({ data, isLight }: Props) {
  const textColor = isLight ? '#1a1a2e' : '#ffffff';
  const subColor = isLight ? '#555' : 'rgba(255,255,255,0.7)';

  return (
    <View style={styles.container}>
      <BlurView intensity={20} tint={isLight ? 'light' : 'dark'} style={styles.blurCard}>
        <Text style={[styles.sectionTitle, { color: textColor }]}>Hourly Forecast</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {data.map((item, index) => (
            <View key={index} style={styles.hourItem}>
              <Text style={[styles.hourText, { color: subColor }]}>{formatHour(item.time)}</Text>
              <WeatherIcon condition={item.condition} size={28} />
              {item.chanceOfRain > 20 && (
                <Text style={styles.rainText}>{item.chanceOfRain}%</Text>
              )}
              <Text style={[styles.tempText, { color: textColor }]}>{item.temperature}°</Text>
            </View>
          ))}
        </ScrollView>
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
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
    opacity: 0.7,
    marginBottom: 12,
  },
  scroll: {
    paddingRight: 8,
  },
  hourItem: {
    alignItems: 'center',
    marginRight: 18,
    gap: 6,
  },
  hourText: {
    fontSize: 12,
    fontWeight: '500',
  },
  rainText: {
    fontSize: 10,
    color: '#5B8CFF',
    fontWeight: '600',
  },
  tempText: {
    fontSize: 16,
    fontWeight: '700',
  },
});
