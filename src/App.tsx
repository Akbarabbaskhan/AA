import { useState, useEffect, useCallback } from 'react'
import { fetchWeather } from './weather'
import { WeatherData, WeatherCondition } from './types'
import { GRADIENTS, LIGHT_CONDITIONS, MOOD_MSG } from './constants'
import Mascot from './Mascot'
import Particles from './Particles'
import Scene from './Scene'
import WeatherIcon from './WeatherIcon'

const isLight = (c: WeatherCondition) => LIGHT_CONDITIONS.includes(c)

function formatHour(h: number) {
  if (h === 0) return '12 AM'
  if (h === 12) return '12 PM'
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

export default function App() {
  const [data, setData]       = useState<WeatherData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [query, setQuery]     = useState('')
  const [visible, setVisible] = useState(false)

  const search = useCallback(async (city: string) => {
    setLoading(true); setError(null); setVisible(false)
    try {
      const r = await fetchWeather(city)
      setData(r)
      setTimeout(() => setVisible(true), 60)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      setError(err?.response?.data?.error?.message ?? 'City not found!')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { search('San Francisco') }, [])

  const cond  = data?.condition ?? 'sunny'
  const light = isLight(cond)
  const txt   = light ? '#1a1228' : '#ffffff'
  const sub   = light ? 'rgba(26,18,40,0.62)' : 'rgba(255,255,255,0.7)'
  const cardBg     = light ? 'rgba(255,255,255,0.38)' : 'rgba(20,15,40,0.38)'
  const cardBorder = light ? 'rgba(255,255,255,0.7)'  : 'rgba(255,255,255,0.14)'
  const glass = (extra?: React.CSSProperties): React.CSSProperties => ({
    background: cardBg,
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
    border: `1px solid ${cardBorder}`,
    borderRadius: 28,
    ...extra,
  })

  const allH = data?.weekly.map(d => d.high) ?? [80]
  const allL = data?.weekly.map(d => d.low)  ?? [60]
  const maxH = Math.max(...allH), minL = Math.min(...allL)
  const range = maxH - minL || 1

  return (
    <div style={{
      minHeight: '100vh',
      background: GRADIENTS[cond],
      transition: 'background 1.4s cubic-bezier(0.4,0,0.2,1)',
      fontFamily: "'Nunito', sans-serif",
      position: 'relative', overflowX: 'hidden',
    }}>
      {/* ── ILLUSTRATED SCENE ── */}
      <div style={{ position:'fixed', inset:0, pointerEvents:'none', zIndex:0 }}>
        <Scene condition={cond} />
      </div>

      {/* ── PARTICLES ── */}
      <div style={{ position:'fixed', inset:0, pointerEvents:'none', zIndex:1 }}>
        <Particles condition={cond} />
      </div>

      {/* ── CONTENT ── */}
      <div style={{ position:'relative', zIndex:2, maxWidth:480, margin:'0 auto', padding:'0 0 80px', minHeight:'100vh' }}>

        {/* ── TOP BAR ── */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', padding:'52px 22px 10px' }}>
          <div>
            <div style={{ fontSize:28, fontWeight:900, color:txt, letterSpacing:-0.5, lineHeight:1.1,
              textShadow: light ? 'none' : '0 2px 12px rgba(0,0,0,0.4)', transition:'color 0.6s' }}>
              {data?.city ?? 'Kawaii Weather'}
            </div>
            <div style={{ fontSize:13, fontWeight:600, color:sub, marginTop:3, transition:'color 0.6s' }}>
              {data?.country ?? ''}
            </div>
          </div>
          {data && (
            <div style={{ ...glass({ padding:'6px 14px', borderRadius:40 }), fontSize:11, fontWeight:700, color:sub, marginTop:4 }}>
              🕐 {data.lastUpdated}
            </div>
          )}
        </div>

        {/* ── SEARCH ── */}
        <form onSubmit={e => { e.preventDefault(); if(query.trim()) search(query.trim()) }}
          style={{ padding:'0 16px 6px' }}>
          <div style={{ ...glass({ display:'flex', alignItems:'center', padding:'12px 18px', gap:12 }) }}>
            <span style={{ fontSize:16, opacity:0.55 }}>🔍</span>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search any city..."
              style={{ flex:1, border:'none', outline:'none', background:'transparent', fontSize:15,
                fontWeight:700, color:txt, fontFamily:'inherit' }}/>
            {loading
              ? <div style={{ width:18, height:18, border:`2px solid ${sub}`, borderTopColor:'transparent',
                  borderRadius:'50%', animation:'spin 0.8s linear infinite' }}/>
              : query && <button type="button" onClick={()=>setQuery('')}
                  style={{ background:'none', border:'none', cursor:'pointer', fontSize:20, color:sub, lineHeight:1, padding:0 }}>×</button>
            }
          </div>
        </form>

        {/* ── ERROR ── */}
        {error && !loading && (
          <div style={{ textAlign:'center', padding:'50px 32px', animation:'fade-in-up 0.4s ease' }}>
            <div style={{ fontSize:52 }}>😿</div>
            <div style={{ color:txt, fontSize:16, fontWeight:700, marginTop:14 }}>{error}</div>
            <button onClick={()=>search('Tokyo')}
              style={{ marginTop:18, padding:'11px 28px', borderRadius:40, border:'none', cursor:'pointer',
                background:'rgba(255,255,255,0.22)', color:'white', fontFamily:'inherit', fontWeight:800, fontSize:14,
                backdropFilter:'blur(10px)' }}>
              Try Tokyo
            </button>
          </div>
        )}

        {/* ── MAIN ── */}
        {data && (
          <div style={{ opacity:visible?1:0, transform:visible?'translateY(0)':'translateY(20px)',
            transition:'opacity 0.7s ease, transform 0.7s ease' }}>

            {/* ── HERO ── */}
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'2px 20px 4px',
              position:'relative' }}>

              {/* Glow ring behind mascot */}
              <div style={{
                position:'absolute', top:'10%', width:200, height:200, borderRadius:'50%',
                background: light
                  ? 'radial-gradient(circle, rgba(255,200,100,0.35) 0%, transparent 70%)'
                  : 'radial-gradient(circle, rgba(100,150,255,0.3) 0%, transparent 70%)',
                filter:'blur(20px)', pointerEvents:'none',
              }}/>

              <Mascot condition={cond} onClick={() => {}} />

              {/* Temp + condition */}
              <div style={{ textAlign:'center', marginTop:-8 }}>
                <div style={{ fontSize:92, fontWeight:200, lineHeight:1, letterSpacing:-6, color:txt,
                  textShadow: light?'none':'0 4px 24px rgba(0,0,0,0.3)', transition:'color 0.6s' }}>
                  {data.temperature}°
                </div>
                <div style={{ fontSize:24, fontWeight:800, color:sub, marginTop:2, transition:'color 0.6s',
                  textShadow: light?'none':'0 2px 10px rgba(0,0,0,0.2)' }}>
                  {data.conditionText}
                </div>
                <div style={{ display:'flex', gap:10, justifyContent:'center', alignItems:'center',
                  marginTop:8, color:sub, fontSize:14, fontWeight:600 }}>
                  <span>Feels {data.feelsLike}°</span>
                  <span style={{ opacity:0.35, fontSize:18 }}>·</span>
                  <span>{data.isDay ? '☀️ Day' : '🌙 Night'}</span>
                </div>
              </div>

              {/* Mood pill */}
              <div style={{ ...glass({ marginTop:16, padding:'10px 22px', borderRadius:50 }),
                fontSize:13, fontWeight:700, color:txt, textAlign:'center',
                boxShadow:'0 4px 20px rgba(0,0,0,0.1)' }}>
                {MOOD_MSG[cond]}
              </div>
            </div>

            {/* ── STATS ── */}
            <div style={{ margin:'16px 16px 12px' }}>
              <div style={{ ...glass({ padding:'18px 16px' }), display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                {[
                  { icon:'💧', label:'Humidity',   value:`${data.humidity}%` },
                  { icon:'💨', label:'Wind',        value:`${data.windSpeed} mph` },
                  { icon:'🌤', label:'UV Index',    value:`${data.uvIndex}` },
                  { icon:'👁', label:'Visibility',  value:`${data.visibility} mi` },
                ].map(s => (
                  <div key={s.label} style={{
                    background: light ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.08)',
                    borderRadius:18, padding:'14px 16px',
                    border: `1px solid ${light?'rgba(255,255,255,0.7)':'rgba(255,255,255,0.08)'}`,
                    transition:'all 0.3s',
                  }}>
                    <div style={{ fontSize:22 }}>{s.icon}</div>
                    <div style={{ fontSize:11, color:sub, fontWeight:700, marginTop:6, letterSpacing:0.4, textTransform:'uppercase' }}>{s.label}</div>
                    <div style={{ fontSize:26, fontWeight:900, color:txt, marginTop:2, letterSpacing:-0.5 }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── HOURLY ── */}
            {data.hourly.length > 0 && (
              <div style={{ margin:'0 16px 12px' }}>
                <div style={{ ...glass({ padding:'16px' }) }}>
                  <div style={{ fontSize:11, fontWeight:800, color:sub, letterSpacing:1.2, marginBottom:14, textTransform:'uppercase' }}>
                    Hourly Forecast
                  </div>
                  <div style={{ display:'flex', gap:8, overflowX:'auto', paddingBottom:4,
                    scrollbarWidth:'none', msOverflowStyle:'none' as never }}>
                    {data.hourly.map((h, i) => (
                      <div key={i} style={{
                        display:'flex', flexDirection:'column', alignItems:'center', gap:7,
                        minWidth:62, padding:'12px 6px',
                        background: light ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.07)',
                        borderRadius:20,
                        border: `1px solid ${light?'rgba(255,255,255,0.8)':'rgba(255,255,255,0.08)'}`,
                        transition:'transform 0.2s',
                      }}>
                        <div style={{ fontSize:11, fontWeight:700, color:sub }}>{formatHour(h.time as number)}</div>
                        <WeatherIcon condition={h.condition} size={24} />
                        {h.chanceOfRain > 20 && (
                          <div style={{ fontSize:10, color:'#74B9FF', fontWeight:800 }}>{h.chanceOfRain}%</div>
                        )}
                        <div style={{ fontSize:16, fontWeight:900, color:txt }}>{h.temperature}°</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── WEEKLY ── */}
            {data.weekly.length > 0 && (
              <div style={{ margin:'0 16px 12px' }}>
                <div style={{ ...glass({ padding:'16px 18px' }) }}>
                  <div style={{ fontSize:11, fontWeight:800, color:sub, letterSpacing:1.2, marginBottom:14, textTransform:'uppercase' }}>
                    7-Day Forecast
                  </div>
                  {data.weekly.map((d, i) => {
                    const barL = ((d.low - minL) / range) * 50
                    const barW = Math.max(((d.high - d.low) / range) * 50, 10)
                    return (
                      <div key={i} style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 0',
                        borderTop: i ? `1px solid ${light?'rgba(0,0,0,0.06)':'rgba(255,255,255,0.08)'}` : 'none' }}>
                        <div style={{ width:46, fontSize:14, fontWeight:800, color:txt }}>
                          {i === 0 ? 'Today' : d.day}
                        </div>
                        <WeatherIcon condition={d.condition} size={22} />
                        <div style={{ width:34, fontSize:11, color:'#74B9FF', fontWeight:800, textAlign:'center' }}>
                          {d.chanceOfRain > 20 ? `${d.chanceOfRain}%` : ''}
                        </div>
                        <div style={{ flex:1, display:'flex', alignItems:'center', gap:8, justifyContent:'flex-end' }}>
                          <span style={{ fontSize:13, color:sub, fontWeight:600, minWidth:30, textAlign:'right' }}>{d.low}°</span>
                          <div style={{ flex:1, maxWidth:80, height:7, borderRadius:4,
                            background: light?'rgba(0,0,0,0.1)':'rgba(255,255,255,0.15)' }}>
                            <div style={{ marginLeft:barL, width:barW, height:7, borderRadius:4,
                              background:'linear-gradient(90deg,#74B9FF,#A29BFE,#FF6B9D)' }}/>
                          </div>
                          <span style={{ fontSize:14, color:txt, fontWeight:900, minWidth:32 }}>{d.high}°</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ── BOTTOM PADDING ── */}
            <div style={{ height:20 }} />
          </div>
        )}
      </div>
    </div>
  )
}
