import { WeatherCondition } from './types'

const icons: Record<WeatherCondition, string> = {
  sunny:         '☀️',
  partly_cloudy: '⛅',
  cloudy:        '☁️',
  rainy:         '🌧',
  thunderstorm:  '⛈',
  snow:          '❄️',
  windy:         '💨',
  fog:           '🌫',
  night:         '🌙',
  night_cloudy:  '🌑',
  night_rainy:   '🌧',
}

export default function WeatherIcon({ condition, size = 24 }: { condition: WeatherCondition; size?: number }) {
  return <span style={{ fontSize: size, lineHeight: 1 }}>{icons[condition]}</span>
}
