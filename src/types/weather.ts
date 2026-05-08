export type WeatherCondition =
  | 'sunny'
  | 'partly_cloudy'
  | 'cloudy'
  | 'rainy'
  | 'thunderstorm'
  | 'snow'
  | 'windy'
  | 'fog'
  | 'night'
  | 'night_cloudy'
  | 'night_rainy';

export interface WeatherData {
  city: string;
  country: string;
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  condition: WeatherCondition;
  conditionText: string;
  isDay: boolean;
  uvIndex: number;
  visibility: number;
  hourly: HourlyForecast[];
  weekly: DailyForecast[];
  lastUpdated: string;
}

export interface HourlyForecast {
  time: number | string;
  temperature: number;
  condition: WeatherCondition;
  chanceOfRain: number;
}

export interface DailyForecast {
  day: string;
  high: number;
  low: number;
  condition: WeatherCondition;
  chanceOfRain: number;
}

export interface MascotState {
  mood: 'happy' | 'sad' | 'scared' | 'cozy' | 'sleepy' | 'annoyed' | 'calm';
  accessory: 'none' | 'umbrella' | 'scarf' | 'none_open' | 'sunglasses';
  animation: 'bounce' | 'shake' | 'shiver' | 'sway' | 'idle' | 'float';
}
