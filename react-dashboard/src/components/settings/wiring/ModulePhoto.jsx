import { useState } from 'react'
import { t } from './i18n.js'

// Real photo of the module with the connectors a diagram uses outlined, and a
// zoom lens on the one being wired right now (the current assistant step, or
// the terminal you last clicked). The photo comes from the private manuals
// repository on demand (/api/manuals/<id>/pdf), like the manuals themselves.

export default function ModulePhoto({ device, scenario, focus }) {
  const photo = device.photo
  const [picked, setPicked] = useState(null)
  const [failed, setFailed] = useState(false)
  if (!photo) return null

  const src = `/api/manuals/${photo.manual}/pdf`
  const used = [...new Set((scenario.terminals || device.terminals.map((x) => x.id)).map((id) => photo.terminals[id]).filter(Boolean))]
  const focusRegion = photo.terminals[focus] || picked || used[0]
  const region = photo.regions[focusRegion]
  const focusTerm = focus && photo.terminals[focus] === focusRegion ? device.terminals.find((x) => x.id === focus) : null

  // Lens: scale so the region fills ~80% of the lens width, centred on it
  const [x0, y0, x1, y1] = region.box
  const LENS = 0.625 // lens height / width (16:10)
  const scale = Math.min(4.5, 0.62 / ((x1 - x0) / photo.w), (0.62 * LENS) / ((y1 - y0) / photo.w))
  const ringW = ((x1 - x0) / photo.w) * scale * 100, ringH = ((y1 - y0) / photo.w) * scale / LENS * 100
  const cx = (x0 + x1) / 2 / photo.w, cy = (y0 + y1) / 2 / photo.h

  return (
    <div className="wr-panel wr-photo">
      <div className="ble-dd-title">{t('Real module')} · {device.model}</div>
      {failed ? (
        <div className="stg-hint">{t('The photo is loaded from the manuals repository — add the GitHub token in Settings → Device manuals.')}</div>
      ) : (
        <>
          <div className="wr-photo-lens">
            <img src={src} alt="" draggable="false" onError={() => setFailed(true)}
              style={{ width: `${scale * 100}%`, transform: `translate(${-cx * 100}%, ${-cy * 100}%)` }}/>
            <div className="wr-photo-ring" style={{ width: `${ringW + 6}%`, height: `${ringH + 10}%` }}/>
          </div>
          <div className="wr-photo-tag">
            <b>{t(region.label)}</b>
            {focusTerm && <span>→ <b>{focusTerm.label}</b> {t(focusTerm.desc)}</span>}
          </div>
          <div className="wr-photo-overview">
            <img src={src} alt={`${device.manufacturer} ${device.model}`} onError={() => setFailed(true)} draggable="false"/>
            <svg viewBox={`0 0 ${photo.w} ${photo.h}`} preserveAspectRatio="none">
              {used.map((k) => {
                const [a, b, c, d] = photo.regions[k].box
                return (
                  <g key={k} className={`wr-photo-box${k === focusRegion ? ' active' : ''}`} onClick={() => setPicked(k)}>
                    <rect x={a} y={b} width={c - a} height={d - b} rx="6"/>
                    <title>{t(photo.regions[k].label)}</title>
                  </g>
                )
              })}
            </svg>
          </div>
          <div className="stg-hint wr-photo-note">{t('Outlined: the connectors this diagram uses — click one to zoom.')} {region.note ? t(region.note) : ''} <span className="wr-photo-credit">{photo.credit}</span></div>
        </>
      )}
    </div>
  )
}
