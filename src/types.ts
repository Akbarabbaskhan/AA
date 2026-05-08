export type WeatherCondition =
  | 'sunny' | 'partly_cloudy' | 'cloudy'
  | 'rainy' | 'thunderstorm' | 'snow'
  | 'windy' | 'fog' | 'night' | 'night_cloudy' | 'night_rainy'

export interface WeatherData {
  city: string
  country: string
  temperature: number
  feelsLike: number
  humidity: number
  windSpeed: number
  condition: WeatherCondition
  conditionText: string
  isDay: boolean
  uvIndex: number
  visibility: number
  hourly: HourlyForecast[]
  weekly: DailyForecast[]
  lastUpdated: string
  timezone: string
}

export interface HourlyForecast {
  time: number
  temperature: number
  condition: WeatherCondition
  chanceOfRain: number
}

export interface DailyForecast {
  day: string
  high: number
  low: number
  condition: WeatherCondition
  chanceOfRain: number
}

export type MascotMood = 'happy' | 'sad' | 'scared' | 'cozy' | 'sleepy' | 'annoyed' | 'calm'
export type MascotAnim = 'bounce' | 'float' | 'shake' | 'shiver' | 'sway' | 'idle'
export type MascotAccessory = 'none' | 'umbrella' | 'scarf'

export interface MascotState {
  mood: MascotMood
  animation: MascotAnim
  accessory: MascotAccessory
}
