/** Previsão do tempo via Open-Meteo (grátis, sem chave). Geocoding + forecast. */
export async function getWeather(city: string): Promise<{
  cidade: string;
  agora: { temperatura: number; sensacao: number; condicao: string; vento: number } | null;
  hoje: { min: number; max: number; chuvaMm: number } | null;
  erro?: string;
}> {
  // 1) geocoding do nome da cidade
  const geo = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=pt&format=json`,
  ).then((r) => r.json() as Promise<{ results?: { latitude: number; longitude: number; name: string; country?: string }[] }>);
  const place = geo.results?.[0];
  if (!place) return { cidade: city, agora: null, hoje: null, erro: "cidade não encontrada" };

  // 2) previsão
  const wx = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
      `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m` +
      `&daily=temperature_2m_min,temperature_2m_max,precipitation_sum&timezone=auto&forecast_days=1`,
  ).then((r) => r.json() as Promise<{
    current?: { temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number };
    daily?: { temperature_2m_min: number[]; temperature_2m_max: number[]; precipitation_sum: number[] };
  }>);

  return {
    cidade: `${place.name}${place.country ? ", " + place.country : ""}`,
    agora: wx.current
      ? {
          temperatura: wx.current.temperature_2m,
          sensacao: wx.current.apparent_temperature,
          condicao: weatherText(wx.current.weather_code),
          vento: wx.current.wind_speed_10m,
        }
      : null,
    hoje: wx.daily
      ? { min: wx.daily.temperature_2m_min[0], max: wx.daily.temperature_2m_max[0], chuvaMm: wx.daily.precipitation_sum[0] }
      : null,
  };
}

// códigos WMO → texto pt-BR (resumido)
function weatherText(code: number): string {
  if (code === 0) return "céu limpo";
  if (code <= 3) return "parcialmente nublado";
  if (code <= 48) return "névoa";
  if (code <= 67) return "chuva";
  if (code <= 77) return "neve";
  if (code <= 82) return "pancadas de chuva";
  if (code <= 99) return "tempestade";
  return "indefinido";
}
