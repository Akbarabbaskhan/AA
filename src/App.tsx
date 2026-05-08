import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchWeather } from './weather'
import { WeatherData, WeatherCondition } from './types'
import { GRADIENTS, LIGHT_CONDITIONS, MOOD_MSG } from './constants'
import Mascot from './Mascot'
import Particles from './Particles'
import WeatherIcon from './WeatherIcon'

function isLight(c: WeatherCondition) { return LIGHT_CONDITIONS.includes(c) }
function formatHour(h: number) {
  if (h === 0) return '12 AM'
  if (h === 12) return '12 PM'
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

export default function App() {
  const [data, setData] = useState<WeatherData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [visible, setVisible] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const search = useCallback(async (city: string) => {
    setLoading(true)
    setError(null)
    setVisible(false)
    try {
      const result = await fetchWeather(city)
      setData(result)
      setTimeout(() => setVisible(true), 50)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      setError(err?.response?.data?.error?.message ?? 'City not found. Try again!')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { search('San Francisco') }, [])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim()) search(query.trim())
  }

  const condition = data?.condition ?? 'sunny'
  const light = isLight(condition)
  const txt = light ? '#1a1a2e' : '#fff'
  const sub = light ? 'rgba(26,26,46,0.65)' : 'rgba(255,255,255,0.72)'
  const glass = light
    ? 'rgba(255,255,255,0.45)'
    : 'rgba(255,255,255,0.1)'
  const border = light
    ? 'rgba(255,255,255,0.65)'
    : 'rgba(255,255,255,0.18)'

  const cardStyle = (extra?: object) => ({
    background: glass,
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: `1px solid ${border}`,
    borderRadius: 24,
    ...extra,
  })

  // Temperature range bar for weekly
  const allHighs = data?.weekly.map(d => d.high) ?? [80]
  const allLows  = data?.weekly.map(d => d.low)  ?? [60]
  const maxH = Math.max(...allHighs)
  const minL = Math.min(...allLows)
  const range = maxH - minL || 1

  return (
    <div style={{
      minHeight: '100vh',
      background: GRADIENTS[condition],
      transition: 'background 1.2s ease',
      fontFamily: "'Nunito', sans-serif",
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Particles */}
      <Particles condition={condition} />

      {/* Scroll container */}
      <div style={{
        position: 'relative', zIndex: 1,
        maxWidth: 480,
        margin: '0 auto',
        padding: '0 0 60px',
        minHeight: '100vh',
      }}>

        {/* ── HEADER ── */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          padding: '52px 20px 12px',
        }}>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800, color: txt, letterSpacing: -0.5, transition: 'color 0.6s' }}>
              {data?.city ?? 'Kawaii Weather'}
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, color: sub, marginTop: 2, transition: 'color 0.6s' }}>
              {data?.country ?? ''}
            </div>
          </div>
          {data && (
            <div style={{ fontSize: 12, color: sub, marginTop: 4 }}>
              Updated {data.lastUpdated}
            </div>
          )}
        </div>

        {/* ── SEARCH ── */}
        <form onSubmit={handleSearch} style={{ padding: '0 16px 8px' }}>
          <div style={{
            ...cardStyle(),
            display: 'flex', alignItems: 'center',
            padding: '10px 16px', gap: 10,
          }}>
            <span style={{ fontSize: 18, opacity: 0.6 }}>🔍</span>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search any city..."
              style={{
                flex: 1, border: 'none', outline: 'none', background: 'transparent',
                fontSize: 15, fontWeight: 600, color: txt, fontFamily: 'inherit',
              }}
            />
            {loading && <span style={{ fontSize: 18, animation: 'spin 1s linear infinite', display: 'inline-block' }}>🌀</span>}
            {query && !loading && (
              <button type="button" onClick={() => setQuery('')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: sub }}>
                ×
              </button>
            )}
          </div>
        </form>

        {/* ── ERROR ── */}
        {error && !loading && (
          <div style={{ textAlign: 'center', padding: '40px 32px', animation: 'fade-in-up 0.4s ease' }}>
            <div style={{ fontSize: 48 }}>😿</div>
            <div style={{ color: txt, fontSize: 16, fontWeight: 600, marginTop: 12 }}>{error}</div>
            <button onClick={() => search('San Francisco')}
              style={{ marginTop: 16, padding: '10px 24px', borderRadius: 20, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.2)', color: 'white', fontFamily: 'inherit', fontWeight: 700, fontSize: 14 }}>
              Try San Francisco
            </button>
          </div>
        )}

        {/* ── MAIN CONTENT ── */}
        {data && (
          <div style={{
            opacity: visible ? 1 : 0,
            transform: visible ? 'translateY(0)' : 'translateY(16px)',
            transition: 'opacity 0.6s ease, transform 0.6s ease',
          }}>

            {/* ── HERO: MASCOT + TEMP ── */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 20px 12px' }}>
              <Mascot condition={condition} onClick={() => { /* tap bounce is handled inside */ }} />

              <div style={{ textAlign: 'center', marginTop: -4 }}>
                <div style={{
                  fontSize: 88, fontWeight: 200, lineHeight: 1, letterSpacing: -6,
                  color: txt, transition: 'color 0.6s',
                }}>
                  {data.temperature}°
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: sub, marginTop: 4, transition: 'color 0.6s' }}>
                  {data.conditionText}
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 6, color: sub, fontSize: 14, fontWeight: 500 }}>
                  <span>Feels {data.feelsLike}°</span>
                  <span style={{ opacity: 0.4 }}>•</span>
                  <span>{data.isDay ? '☀️ Day' : '🌙 Night'}</span>
                </div>
              </div>

              {/* Mood message */}
              <div style={{
                marginTop: 14, padding: '8px 20px',
                ...cardStyle({ borderRadius: 40 }),
                fontSize: 13, fontWeight: 600, color: sub,
                fontStyle: 'italic', textAlign: 'center',
              }}>
                {MOOD_MSG[condition]}
              </div>
            </div>

            {/* ── STATS GRID ── */}
            <div style={{ margin: '0 16px 12px' }}>
              <div style={{
                ...cardStyle({ padding: 16 }),
                display: 'grid', gridTemplateColumns: '1fr 1fr',
                gap: 10,
              }}>
                {[
                  { icon: '💧', label: 'Humidity',   value: `${data.humidity}%` },
                  { icon: '💨', label: 'Wind',       value: `${data.windSpeed} mph` },
                  { icon: '☀️', label: 'UV Index',   value: `${data.uvIndex}` },
                  { icon: '👁', label: 'Visibility', value: `${data.visibility} mi` },
                ].map(s => (
                  <div key={s.label} style={{
                    background: 'rgba(255,255,255,0.12)',
                    borderRadius: 16, padding: '12px 14px',
                  }}>
                    <div style={{ fontSize: 20 }}>{s.icon}</div>
                    <div style={{ fontSize: 11, color: sub, fontWeight: 600, marginTop: 4, letterSpacing: 0.3 }}>{s.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: txt, marginTop: 2 }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── HOURLY FORECAST ── */}
            {data.hourly.length > 0 && (
              <div style={{ margin: '0 16px 12px' }}>
                <div style={{ ...cardStyle({ padding: '14px 16px' }) }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: sub, letterSpacing: 0.5, marginBottom: 12 }}>
                    HOURLY FORECAST
                  </div>
                  <div style={{
                    display: 'flex', gap: 6, overflowX: 'auto',
                    paddingBottom: 4,
                    scrollbarWidth: 'none',
                  }}>
                    {data.hourly.map((h, i) => (
                      <div key={i} style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        gap: 6, minWidth: 58,
                        padding: '10px 4px',
                        background: 'rgba(255,255,255,0.1)',
                        borderRadius: 16,
                      }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: sub }}>{formatHour(h.time as number)}</div>
                        <WeatherIcon condition={h.condition} size={22} />
                        {h.chanceOfRain > 20 && (
                          <div style={{ fontSize: 10, color: '#74B9FF', fontWeight: 700 }}>{h.chanceOfRain}%</div>
                        )}
                        <div style={{ fontSize: 15, fontWeight: 800, color: txt }}>{h.temperature}°</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── WEEKLY FORECAST ── */}
            {data.weekly.length > 0 && (
              <div style={{ margin: '0 16px 12px' }}>
                <div style={{ ...cardStyle({ padding: '14px 16px' }) }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: sub, letterSpacing: 0.5, marginBottom: 12 }}>
                    7-DAY FORECAST
                  </div>
                  {data.weekly.map((d, i) => {
                    const barL = ((d.low - minL) / range) * 55
                    const barW = Math.max(((d.high - d.low) / range) * 55, 8)
                    return (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 0',
                        borderTop: i > 0 ? `1px solid rgba(255,255,255,0.1)` : 'none',
                      }}>
                        <div style={{ width: 48, fontSize: 14, fontWeight: 700, color: txt }}>
                          {i === 0 ? 'Today' : d.day}
                        </div>
                        <WeatherIcon condition={d.condition} size={20} />
                        {d.chanceOfRain > 20 ? (
                          <div style={{ width: 32, fontSize: 11, color: '#74B9FF', fontWeight: 700 }}>{d.chanceOfRain}%</div>
                        ) : <div style={{ width: 32 }} />}
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                          <span style={{ fontSize: 13, color: sub, fontWeight: 600, minWidth: 30, textAlign: 'right' }}>{d.low}°</span>
                          <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.18)', borderRadius: 3, maxWidth: 80 }}>
                            <div style={{ marginLeft: barL, width: barW, height: 6, borderRadius: 3, background: 'linear-gradient(90deg, #74B9FF, #FFB830)' }} />
                          </div>
                          <span style={{ fontSize: 14, color: txt, fontWeight: 800, minWidth: 30 }}>{d.high}°</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
