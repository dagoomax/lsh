import { useEffect, useState } from 'react'
import { gt } from '../i18n'

// Laundry link on the home view. Reads the public price list, the same data
// guests see on the /laundry page. Server: core-go/laundry_api.go.

export function useLaundry() {
  const [data, setData] = useState(null)
  useEffect(() => {
    const load = () => fetch('/api/order/laundry/menu', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setData((j && j.data) || null))
      .catch(() => {})
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [])
  return data
}

export default function LaundryCard({ data }) {
  if (!data || !data.enabled || data.hideHotelServices || !data.items?.length) return null
  return (
    <a className="card" href="/laundry" target="_blank" rel="noreferrer"
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', color: 'inherit', textDecoration: 'none' }}>
      <span style={{ fontSize: 18 }}>🧺</span>
      <span style={{ flex: 1, fontWeight: 700, fontSize: 15 }}>{data.title || gt('home_sec_laundry', 'Laundry')}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent, #0a84ff)' }}>{gt('rs_open_page', 'Open')} ↗</span>
    </a>
  )
}
