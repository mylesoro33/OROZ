// Weather from Open-Meteo (free, no key). We send only your city name to find it,
// then its rounded coordinates for the forecast. No GPS, no history.
import { store, type WeatherDay } from '../data/store';

export async function refreshWeather(): Promise<void> {
  const st = store().state; const city = st.profile.city?.trim();
  if (!city) return;
  if (st.weather && st.weather.city === city && Date.now() - st.weather.at < 3 * 3_600_000) return;
  try {
    const g = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(city.split(',')[0])}`)).json();
    const loc = g.results?.[0]; if (!loc) return;
    const unit = ['US', 'LR', 'MM'].includes(loc.country_code) ? 'F' : 'C';
    const f = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude.toFixed(2)}&longitude=${loc.longitude.toFixed(2)}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=auto&forecast_days=7${unit === 'F' ? '&temperature_unit=fahrenheit' : ''}`)).json();
    const days: WeatherDay[] = (f.daily?.time ?? []).map((d: string, i: number) => ({ date: d, tmax: f.daily.temperature_2m_max[i], tmin: f.daily.temperature_2m_min[i], precip: f.daily.precipitation_probability_max[i] ?? 0, code: f.daily.weather_code[i] }));
    store().set('weather', { city, at: Date.now(), unit, days });
  } catch { /* offline: no weather line, that's fine */ }
}
