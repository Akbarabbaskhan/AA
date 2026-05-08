import axios from 'axios';
import { WeatherData, WeatherCondition, HourlyForecast, DailyForecast } from '../types/weather';
import { WEATHER_API_KEY, WEATHER_API_BASE, WEATHER_CODE_MAP, DAY_NAMES } from '../constants/weather';

function mapCondition(code: number, isDay: boolean): WeatherCondition {
  const base = WEATHER_CODE_MAP[code] || 'cloudy';
  if (!isDay) {
    if (base === 'sunny' || base === 'partly_cloudy') return 'night';
    if (base === 'cloudy') return 'night_cloudy';
    if (base === 'rainy') return 'night_rainy';
  }
  return base;
}

export async function fetchWeather(city: string): Promise<WeatherData> {
  const res = await axios.get(`${WEATHER_API_BASE}/forecast.json`, {
    params: {
      key: WEATHER_API_KEY,
      q: city,
      days: 7,
      aqi: 'no',
      alerts: 'no',
    },
  });

  const d = res.data;
  const current = d.current;
  const location = d.location;
  const isDay = current.is_day === 1;

  const hourly: HourlyForecast[] = d.forecast.forecastday[0].hour
    .filter((_: any, i: number) => i % 2 === 0)
    .slice(0, 8)
    .map((h: any) => ({
      time: new Date(h.time).getHours(),
      temperature: Math.round(h.temp_f),
      condition: mapCondition(h.condition.code, h.is_day === 1),
      chanceOfRain: h.chance_of_rain,
    }));

  const weekly: DailyForecast[] = d.forecast.forecastday.map((day: any) => {
    const date = new Date(day.date);
    return {
      day: DAY_NAMES[date.getDay()],
      high: Math.round(day.day.maxtemp_f),
      low: Math.round(day.day.mintemp_f),
      condition: mapCondition(day.day.condition.code, true),
      chanceOfRain: day.day.daily_chance_of_rain,
    };
  });

  return {
    city: location.name,
    country: location.country,
    temperature: Math.round(current.temp_f),
    feelsLike: Math.round(current.feelslike_f),
    humidity: current.humidity,
    windSpeed: Math.round(current.wind_mph),
    condition: mapCondition(current.condition.code, isDay),
    conditionText: current.condition.text,
    isDay,
    uvIndex: current.uv,
    visibility: Math.round(current.vis_miles),
    hourly,
    weekly,
    lastUpdated: current.last_updated,
  };
}
