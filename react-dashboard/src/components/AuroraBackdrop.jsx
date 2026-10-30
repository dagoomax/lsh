import { useEffect, useState } from 'react'

// The living wallpaper behind the dashboard: soft aurora light that drifts
// slowly, tinted by the time of day ("auto") or a fixed palette picked in
// Edit Home View. Pure CSS gradients moved with transform only, so it stays
// on the compositor; glass surfaces (global.css, .aurora-on) blur it.

export const WALLPAPERS = ['auto', 'aurora', 'sunset', 'ocean', 'forest', 'off']

export function paletteFor(wallpaper, hour) {
  if (wallpaper !== 'auto') return wallpaper
  if (hour >= 5 && hour < 10) return 'sunrise'
  if (hour >= 10 && hour < 17) return 'ocean'
  if (hour >= 17 && hour < 21) return 'sunset'
  return 'aurora'
}

export default function AuroraBackdrop({ wallpaper = 'auto' }) {
  const [hour, setHour] = useState(() => new Date().getHours())
  useEffect(() => {
    if (wallpaper !== 'auto') return
    const t = setInterval(() => setHour(new Date().getHours()), 60000)
    return () => clearInterval(t)
  }, [wallpaper])
  if (wallpaper === 'off') return null
  return (
    <div className="aurora" data-pal={paletteFor(wallpaper, hour)} aria-hidden="true">
      <i className="aurora-b1" /><i className="aurora-b2" /><i className="aurora-b3" /><i className="aurora-b4" />
      <i className="aurora-veil" />
    </div>
  )
}
