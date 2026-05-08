import { WeatherCondition, MascotState } from '../types/weather';

// Get a free API key at https://www.weatherapi.com/
// Replace 'YOUR_API_KEY_HERE' with your key to enable live weather
export const WEATHER_API_KEY = 'cd54c93e92e34eb9be2140952260805';
export const WEATHER_API_BASE = 'https://api.weatherapi.com/v1';

export const WEATHER_GRADIENTS: Record<WeatherCondition, string[]> = {
  sunny: ['#FFD580', '#FF9F43', '#FF6B6B'],
  partly_cloudy: ['#74B9FF', '#A29BFE', '#FD79A8'],
  cloudy: ['#B2BEC3', '#636E72', '#2D3436'],
  rainy: ['#2C3E6B', '#1a2a4a', '#0d1a30'],
  thunderstorm: ['#1a1a2e', '#16213e', '#0f3460'],
  snow: ['#E8F4FD', '#B8D4E8', '#7EB8D4'],
  windy: ['#81ECEC', '#74B9FF', '#A29BFE'],
  fog: ['#B2BEC3', '#DFE6E9', '#C8D6E5'],
  night: ['#0f0c29', '#302b63', '#24243e'],
  night_cloudy: ['#1a1a2e', '#2d2d44', '#16213e'],
  night_rainy: ['#0d1117', '#161b22', '#21262d'],
};

export const MASCOT_STATES: Record<WeatherCondition, MascotState> = {
  sunny: { mood: 'happy', accessory: 'none', animation: 'bounce' },
  partly_cloudy: { mood: 'happy', accessory: 'none', animation: 'float' },
  cloudy: { mood: 'calm', accessory: 'none', animation: 'idle' },
  rainy: { mood: 'sad', accessory: 'umbrella', animation: 'idle' },
  thunderstorm: { mood: 'scared', accessory: 'none', animation: 'shake' },
  snow: { mood: 'cozy', accessory: 'scarf', animation: 'shiver' },
  windy: { mood: 'annoyed', accessory: 'none', animation: 'sway' },
  fog: { mood: 'sleepy', accessory: 'none', animation: 'float' },
  night: { mood: 'sleepy', accessory: 'none', animation: 'float' },
  night_cloudy: { mood: 'calm', accessory: 'none', animation: 'idle' },
  night_rainy: { mood: 'sad', accessory: 'umbrella', animation: 'idle' },
};

export const WEATHER_CODE_MAP: Record<number, WeatherCondition> = {
  1000: 'sunny',
  1003: 'partly_cloudy',
  1006: 'cloudy',
  1009: 'cloudy',
  1030: 'fog',
  1063: 'rainy',
  1066: 'snow',
  1069: 'rainy',
  1072: 'rainy',
  1087: 'thunderstorm',
  1114: 'snow',
  1117: 'snow',
  1135: 'fog',
  1147: 'fog',
  1150: 'rainy',
  1153: 'rainy',
  1168: 'rainy',
  1171: 'rainy',
  1180: 'rainy',
  1183: 'rainy',
  1186: 'rainy',
  1189: 'rainy',
  1192: 'rainy',
  1195: 'rainy',
  1198: 'rainy',
  1201: 'rainy',
  1204: 'snow',
  1207: 'snow',
  1210: 'snow',
  1213: 'snow',
  1216: 'snow',
  1219: 'snow',
  1222: 'snow',
  1225: 'snow',
  1237: 'snow',
  1240: 'rainy',
  1243: 'rainy',
  1246: 'rainy',
  1249: 'snow',
  1252: 'snow',
  1255: 'snow',
  1258: 'snow',
  1261: 'snow',
  1264: 'snow',
  1273: 'thunderstorm',
  1276: 'thunderstorm',
  1279: 'thunderstorm',
  1282: 'thunderstorm',
};

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
