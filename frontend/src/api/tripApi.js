import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || ''

export async function planTrip(payload) {
  const { data } = await axios.post(`${BASE}/api/trip/plan/`, payload)
  return data
}

export async function geocodeSuggest(q) {
  if (!q || q.length < 3) return []
  const { data } = await axios.get(`${BASE}/api/geocode/`, { params: { q } })
  return Array.isArray(data) ? data : []
}
