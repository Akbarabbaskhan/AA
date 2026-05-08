import { useState, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WeatherData } from '../types/weather';
import { fetchWeather } from '../services/weatherApi';
import { getMockWeather, getCycleMockWeather } from '../utils/mockWeather';
import { WEATHER_API_KEY } from '../constants/weather';

const LAST_CITY_KEY = '@kawaii_weather_last_city';
const IS_DEMO = WEATHER_API_KEY === 'YOUR_API_KEY_HERE';

export function useWeather() {
  const [data, setData] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const demoIndex = useRef(0);

  const search = useCallback(async (city: string) => {
    setLoading(true);
    setError(null);
    try {
      if (IS_DEMO) {
        // Simulate network delay
        await new Promise(r => setTimeout(r, 600));
        setData(getCycleMockWeather(city, demoIndex.current));
        demoIndex.current = (demoIndex.current + 1) % 11;
      } else {
        const result = await fetchWeather(city);
        setData(result);
        await AsyncStorage.setItem(LAST_CITY_KEY, city);
      }
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message || 'City not found. Try again!';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLastCity = useCallback(async () => {
    const city = IS_DEMO ? 'San Francisco' : (await AsyncStorage.getItem(LAST_CITY_KEY)) || 'San Francisco';
    await search(city);
  }, [search]);

  return { data, loading, error, search, loadLastCity, isDemo: IS_DEMO };
}
