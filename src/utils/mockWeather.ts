import { WeatherData, WeatherCondition } from '../types/weather';

const CONDITIONS: WeatherCondition[] = [
  'sunny', 'partly_cloudy', 'cloudy', 'rainy', 'thunderstorm',
  'snow', 'windy', 'fog', 'night', 'night_cloudy', 'night_rainy',
];

export function getMockWeather(city: string = 'San Francisco'): WeatherData {
  const hour = new Date().getHours();
  const isDay = hour >= 6 && hour < 20;
  const condition: WeatherCondition = isDay ? 'sunny' : 'night';

  return {
    city,
    country: 'Demo Mode',
    temperature: 72,
    feelsLike: 70,
    humidity: 58,
    windSpeed: 8,
    condition,
    conditionText: isDay ? 'Sunny' : 'Clear Night',
    isDay,
    uvIndex: 5,
    visibility: 10,
    lastUpdated: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    hourly: Array.from({ length: 8 }, (_, i) => ({
      time: (hour + i * 2) % 24,
      temperature: 68 + Math.floor(Math.sin(i) * 8),
      condition: i < 4 ? 'sunny' : 'partly_cloudy',
      chanceOfRain: i > 5 ? 20 : 5,
    })),
    weekly: [
      { day: 'Today', high: 76, low: 62, condition: 'sunny', chanceOfRain: 5 },
      { day: 'Mon', high: 72, low: 60, condition: 'partly_cloudy', chanceOfRain: 15 },
      { day: 'Tue', high: 68, low: 58, condition: 'rainy', chanceOfRain: 75 },
      { day: 'Wed', high: 65, low: 55, condition: 'thunderstorm', chanceOfRain: 90 },
      { day: 'Thu', high: 70, low: 58, condition: 'cloudy', chanceOfRain: 30 },
      { day: 'Fri', high: 74, low: 61, condition: 'sunny', chanceOfRain: 5 },
      { day: 'Sat', high: 78, low: 64, condition: 'sunny', chanceOfRain: 0 },
    ],
  };
}

export function getCycleMockWeather(city: string, conditionIndex: number): WeatherData {
  const condition = CONDITIONS[conditionIndex % CONDITIONS.length];
  const isDay = !condition.startsWith('night');
  const conditionLabels: Record<WeatherCondition, string> = {
    sunny: 'Sunny', partly_cloudy: 'Partly Cloudy', cloudy: 'Cloudy',
    rainy: 'Rainy', thunderstorm: 'Thunderstorm', snow: 'Snowing',
    windy: 'Windy', fog: 'Foggy', night: 'Clear Night',
    night_cloudy: 'Cloudy Night', night_rainy: 'Rainy Night',
  };

  return {
    city,
    country: 'Demo Mode',
    temperature: condition === 'snow' ? 32 : condition === 'thunderstorm' ? 65 : condition.startsWith('night') ? 55 : 72,
    feelsLike: condition === 'snow' ? 28 : 68,
    humidity: condition === 'rainy' || condition === 'thunderstorm' ? 85 : 55,
    windSpeed: condition === 'windy' ? 28 : condition === 'thunderstorm' ? 18 : 8,
    condition,
    conditionText: conditionLabels[condition],
    isDay,
    uvIndex: isDay ? 6 : 0,
    visibility: condition === 'fog' ? 2 : 10,
    lastUpdated: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    hourly: Array.from({ length: 8 }, (_, i) => ({
      time: (new Date().getHours() + i * 2) % 24,
      temperature: 65 + Math.floor(Math.sin(i) * 10),
      condition: i < 4 ? condition : 'partly_cloudy',
      chanceOfRain: (condition === 'rainy' || condition === 'thunderstorm') ? 80 : 10,
    })),
    weekly: [
      { day: 'Today', high: 76, low: 62, condition, chanceOfRain: 10 },
      { day: 'Mon', high: 72, low: 60, condition: 'partly_cloudy', chanceOfRain: 20 },
      { day: 'Tue', high: 68, low: 55, condition: 'rainy', chanceOfRain: 70 },
      { day: 'Wed', high: 70, low: 58, condition: 'cloudy', chanceOfRain: 35 },
      { day: 'Thu', high: 74, low: 61, condition: 'sunny', chanceOfRain: 5 },
      { day: 'Fri', high: 71, low: 59, condition: 'windy', chanceOfRain: 10 },
      { day: 'Sat', high: 78, low: 64, condition: 'sunny', chanceOfRain: 0 },
    ],
  };
}
