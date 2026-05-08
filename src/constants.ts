import { WeatherCondition, MascotState } from './types'

export const API_KEY = 'cd54c93e92e34eb9be2140952260805'
export const API_BASE = 'https://api.weatherapi.com/v1'

export const GRADIENTS: Record<WeatherCondition, string> = {
  sunny:         'linear-gradient(160deg, #FFD580 0%, #FF9F43 50%, #FF6B6B 100%)',
  partly_cloudy: 'linear-gradient(160deg, #74B9FF 0%, #A29BFE 50%, #FD79A8 100%)',
  cloudy:        'linear-gradient(160deg, #636E72 0%, #2D3436 100%)',
  rainy:         'linear-gradient(160deg, #2C3E6B 0%, #1a2a4a 60%, #0d1a30 100%)',
  thunderstorm:  'linear-gradient(160deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
  snow:          'linear-gradient(160deg, #E8F4FD 0%, #B8D4E8 60%, #7EB8D4 100%)',
  windy:         'linear-gradient(160deg, #81ECEC 0%, #74B9FF 50%, #A29BFE 100%)',
  fog:           'linear-gradient(160deg, #B2BEC3 0%, #DFE6E9 50%, #C8D6E5 100%)',
  night:         'linear-gradient(160deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
  night_cloudy:  'linear-gradient(160deg, #1a1a2e 0%, #2d2d44 50%, #16213e 100%)',
  night_rainy:   'linear-gradient(160deg, #0d1117 0%, #161b22 50%, #21262d 100%)',
}

export const MASCOT: Record<WeatherCondition, MascotState> = {
  sunny:         { mood: 'happy',   animation: 'bounce', accessory: 'none' },
  partly_cloudy: { mood: 'happy',   animation: 'float',  accessory: 'none' },
  cloudy:        { mood: 'calm',    animation: 'idle',   accessory: 'none' },
  rainy:         { mood: 'sad',     animation: 'idle',   accessory: 'umbrella' },
  thunderstorm:  { mood: 'scared',  animation: 'shake',  accessory: 'none' },
  snow:          { mood: 'cozy',    animation: 'shiver', accessory: 'scarf' },
  windy:         { mood: 'annoyed', animation: 'sway',   accessory: 'none' },
  fog:           { mood: 'sleepy',  animation: 'float',  accessory: 'none' },
  night:         { mood: 'sleepy',  animation: 'float',  accessory: 'none' },
  night_cloudy:  { mood: 'calm',    animation: 'idle',   accessory: 'none' },
  night_rainy:   { mood: 'sad',     animation: 'idle',   accessory: 'umbrella' },
}

export const CODE_MAP: Record<number, WeatherCondition> = {
  1000:'sunny',1003:'partly_cloudy',1006:'cloudy',1009:'cloudy',
  1030:'fog',1063:'rainy',1066:'snow',1069:'rainy',1072:'rainy',
  1087:'thunderstorm',1114:'snow',1117:'snow',1135:'fog',1147:'fog',
  1150:'rainy',1153:'rainy',1168:'rainy',1171:'rainy',1180:'rainy',
  1183:'rainy',1186:'rainy',1189:'rainy',1192:'rainy',1195:'rainy',
  1198:'rainy',1201:'rainy',1204:'snow',1207:'snow',1210:'snow',
  1213:'snow',1216:'snow',1219:'snow',1222:'snow',1225:'snow',
  1237:'snow',1240:'rainy',1243:'rainy',1246:'rainy',1249:'snow',
  1252:'snow',1255:'snow',1258:'snow',1261:'snow',1264:'snow',
  1273:'thunderstorm',1276:'thunderstorm',1279:'thunderstorm',1282:'thunderstorm',
}

export const MOOD_MSG: Record<WeatherCondition, string> = {
  sunny:        '✨ A perfect day to spread your wings!',
  partly_cloudy:'🌤 Mix of sun and clouds — lovely!',
  cloudy:       '☁️ A cozy overcast kinda day.',
  rainy:        '🌂 Stay dry! The puddles are cute though.',
  thunderstorm: '⚡ Hold tight — it\'s getting stormy!',
  snow:         '❄️ Wrap up warm, it\'s snowing!',
  windy:        '🍃 Hold onto your cream puff!',
  fog:          '🌫 Dreamy and misty today...',
  night:        '🌙 Sleepy time under the stars~',
  night_cloudy: '🌑 The clouds are hiding the moon.',
  night_rainy:  '🌧 Rainy night vibes... cozy indoors!',
}

export const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

export const LIGHT_CONDITIONS: WeatherCondition[] = ['sunny','partly_cloudy','snow','windy','fog']
