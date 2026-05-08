import axios from 'axios'
import { WeatherData, WeatherCondition } from './types'
import { API_KEY, API_BASE, CODE_MAP, DAYS } from './constants'

function mapCode(code: number, isDay: boolean): WeatherCondition {
  const base = CODE_MAP[code] ?? 'cloudy'
  if (!isDay) {
    if (base === 'sunny' || base === 'partly_cloudy') return 'night'
    if (base === 'cloudy') return 'night_cloudy'
    if (base === 'rainy') return 'night_rainy'
  }
  return base
}

export async function fetchWeather(city: string): Promise<WeatherData> {
  const { data } = await axios.get(`${API_BASE}/forecast.json`, {
    params: { key: API_KEY, q: city, days: 7, aqi: 'no', alerts: 'no' },
  })

  const cur = data.current
  const loc = data.location
  const isDay = cur.is_day === 1

  const hourly = data.forecast.forecastday[0].hour
    .filter((_: unknown, i: number) => i % 3 === 0)
    .slice(0, 8)
    .map((h: Record<string, unknown>) => ({
      time: new Date(h.time as string).getHours(),
      temperature: Math.round(h.temp_f as number),
      condition: mapCode((h.condition as Record<string, number>).code, (h.is_day as number) === 1),
      chanceOfRain: h.chance_of_rain as number,
    }))

  const weekly = data.forecast.forecastday.map((d: Record<string, unknown>) => {
    const date = new Date(d.date as string)
    const day = d.day as Record<string, unknown>
    return {
      day: DAYS[date.getDay()],
      high: Math.round(day.maxtemp_f as number),
      low: Math.round(day.mintemp_f as number),
      condition: mapCode((day.condition as Record<string, number>).code, true),
      chanceOfRain: day.daily_chance_of_rain as number,
    }
  })

  return {
    city: loc.name,
    country: loc.country,
    temperature: Math.round(cur.temp_f),
    feelsLike: Math.round(cur.feelslike_f),
    humidity: cur.humidity,
    windSpeed: Math.round(cur.wind_mph),
    condition: mapCode(cur.condition.code, isDay),
    conditionText: cur.condition.text,
    isDay,
    uvIndex: cur.uv,
    visibility: Math.round(cur.vis_miles),
    hourly,
    weekly,
    lastUpdated: cur.last_updated.split(' ')[1],
  }
}
