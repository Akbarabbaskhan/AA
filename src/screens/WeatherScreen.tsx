import React, { useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, SafeAreaView, Dimensions, ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSpring, Easing,
} from 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';
import { useWeather } from '../hooks/useWeather';
import WeatherScene from '../components/weather/WeatherScene';
import KawaiiMascot from '../components/mascot/KawaiiMascot';
import HourlyForecast from '../components/weather/HourlyForecast';
import WeeklyForecast from '../components/weather/WeeklyForecast';
import StatsCard from '../components/ui/StatsCard';
import SearchBar from '../components/ui/SearchBar';
import { WeatherCondition } from '../types/weather';

const { width } = Dimensions.get('window');

const LIGHT_CONDITIONS: WeatherCondition[] = ['sunny', 'partly_cloudy', 'snow', 'windy', 'fog'];

function isLightTheme(condition: WeatherCondition): boolean {
  return LIGHT_CONDITIONS.includes(condition);
}

function getMoodMessage(condition: WeatherCondition): string {
  const messages: Record<WeatherCondition, string> = {
    sunny: '✨ A perfect day to spread your wings!',
    partly_cloudy: '🌤 Mix of sun and clouds — lovely!',
    cloudy: '☁️ A cozy, overcast kinda day.',
    rainy: '🌂 Stay dry! The puddles are cute though.',
    thunderstorm: '⚡ Hold tight — it\'s getting stormy!',
    snow: '❄️ Wrap up warm, it\'s snowing!',
    windy: '🍃 Hold onto your cream puff!',
    fog: '🌫 Dreamy and misty today...',
    night: '🌙 Sleepy time under the stars~',
    night_cloudy: '🌑 The clouds are hiding the moon.',
    night_rainy: '🌧 Rainy night vibes... cozy indoors!',
  };
  return messages[condition] ?? '🌈 Checking the skies for you!';
}

export default function WeatherScreen() {
  const { data, loading, error, search, loadLastCity, isDemo } = useWeather();
  const contentOpacity = useSharedValue(0);
  const mascotScale = useSharedValue(0.8);
  const tempOpacity = useSharedValue(0);

  useEffect(() => {
    loadLastCity();
  }, []);

  useEffect(() => {
    if (data) {
      contentOpacity.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.quad) });
      mascotScale.value = withSpring(1, { damping: 8, stiffness: 100 });
      tempOpacity.value = withTiming(1, { duration: 800 });
    } else {
      contentOpacity.value = withTiming(0, { duration: 200 });
      mascotScale.value = withTiming(0.8);
      tempOpacity.value = withTiming(0);
    }
  }, [data]);

  const contentStyle = useAnimatedStyle(() => ({ opacity: contentOpacity.value }));
  const mascotStyle = useAnimatedStyle(() => ({ transform: [{ scale: mascotScale.value }] }));
  const tempStyle = useAnimatedStyle(() => ({ opacity: tempOpacity.value }));

  const condition = data?.condition ?? 'sunny';
  const isLight = isLightTheme(condition);
  const textColor = isLight ? '#1a1a2e' : '#ffffff';
  const subTextColor = isLight ? 'rgba(26,26,46,0.7)' : 'rgba(255,255,255,0.75)';

  return (
    <WeatherScene condition={condition}>
      <StatusBar style={isLight ? 'dark' : 'light'} />
      <SafeAreaView style={styles.safeArea}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Animated.Text style={[styles.cityName, { color: textColor }, contentStyle]} numberOfLines={1}>
              {data?.city ?? 'Kawaii Weather'}
            </Animated.Text>
            <Animated.Text style={[styles.countryName, { color: subTextColor }, contentStyle]}>
              {data?.country ?? 'Loading...'}
            </Animated.Text>
          </View>
          <Animated.View style={contentStyle}>
            <Text style={[styles.updateTime, { color: subTextColor }]}>
              {data ? `Updated ${data.lastUpdated}` : ''}
            </Text>
          </Animated.View>
        </View>

        {/* Demo mode banner */}
        {isDemo && (
          <TouchableOpacity onPress={() => search(data?.city ?? 'Tokyo')} style={styles.demoBanner}>
            <Text style={styles.demoText}>🎮 Demo Mode — Tap to cycle weather • Add API key in constants/weather.ts</Text>
          </TouchableOpacity>
        )}

        {/* Search bar */}
        <SearchBar onSearch={search} isLight={isLight} loading={loading} />

        <ScrollView
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Loading */}
          {loading && !data && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={isLight ? '#666' : 'white'} />
              <Text style={[styles.loadingText, { color: subTextColor }]}>Fetching weather...</Text>
            </View>
          )}

          {/* Error */}
          {error && !loading && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorEmoji}>😿</Text>
              <Text style={[styles.errorText, { color: textColor }]}>{error}</Text>
              <TouchableOpacity onPress={() => search('San Francisco')} style={styles.retryBtn}>
                <Text style={styles.retryText}>Try San Francisco</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Main content */}
          {data && (
            <Animated.View style={contentStyle}>
              {/* Hero: Mascot + Temp */}
              <View style={styles.heroSection}>
                <Animated.View style={[styles.mascotWrapper, mascotStyle]}>
                  <KawaiiMascot condition={condition} size={220} />
                </Animated.View>

                <Animated.View style={[styles.tempContainer, tempStyle]}>
                  <Text style={[styles.temperature, { color: textColor }]}>
                    {data.temperature}°
                  </Text>
                  <Text style={[styles.conditionText, { color: subTextColor }]}>
                    {data.conditionText}
                  </Text>
                  <View style={styles.feelsRow}>
                    <Text style={[styles.feelsLike, { color: subTextColor }]}>
                      Feels {data.feelsLike}°
                    </Text>
                    <View style={[styles.dot, { backgroundColor: subTextColor }]} />
                    <Text style={[styles.feelsLike, { color: subTextColor }]}>
                      {data.isDay ? '☀️ Day' : '🌙 Night'}
                    </Text>
                  </View>
                </Animated.View>
              </View>

              {/* Stats */}
              <StatsCard
                isLight={isLight}
                items={[
                  { icon: 'humidity', label: 'Humidity', value: `${data.humidity}%` },
                  { icon: 'wind', label: 'Wind', value: `${data.windSpeed} mph` },
                  { icon: 'uv', label: 'UV Index', value: `${data.uvIndex}` },
                  { icon: 'visibility', label: 'Visibility', value: `${data.visibility} mi` },
                ]}
              />

              {/* Hourly */}
              {data.hourly.length > 0 && (
                <HourlyForecast data={data.hourly} isLight={isLight} />
              )}

              {/* Weekly */}
              {data.weekly.length > 0 && (
                <WeeklyForecast data={data.weekly} isLight={isLight} />
              )}

              {/* Mood hint */}
              <View style={styles.moodHintContainer}>
                <Text style={[styles.moodHint, { color: subTextColor }]}>
                  {getMoodMessage(condition)}
                </Text>
              </View>
            </Animated.View>
          )}
        </ScrollView>
      </SafeAreaView>
    </WeatherScene>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  cityName: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  countryName: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  updateTime: {
    fontSize: 12,
    fontWeight: '500',
    opacity: 0.7,
    marginTop: 4,
  },
  demoBanner: {
    marginHorizontal: 16,
    marginBottom: 6,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  demoText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 4,
    paddingBottom: 48,
  },
  heroSection: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  mascotWrapper: {
    marginBottom: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
  },
  tempContainer: {
    alignItems: 'center',
    marginBottom: 8,
  },
  temperature: {
    fontSize: 84,
    fontWeight: '200',
    lineHeight: 84,
    letterSpacing: -4,
  },
  conditionText: {
    fontSize: 22,
    fontWeight: '600',
    marginTop: 4,
    letterSpacing: 0.3,
  },
  feelsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  feelsLike: {
    fontSize: 14,
    fontWeight: '500',
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    opacity: 0.5,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    fontWeight: '500',
  },
  errorContainer: {
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: 32,
    gap: 12,
  },
  errorEmoji: {
    fontSize: 48,
  },
  errorText: {
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
  },
  retryBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    marginTop: 8,
  },
  retryText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
  moodHintContainer: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingBottom: 8,
  },
  moodHint: {
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
