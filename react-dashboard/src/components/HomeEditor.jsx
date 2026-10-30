import { useState } from 'react'
import { motion, AnimatePresence, Reorder, useDragControls } from 'framer-motion'
import { gt } from '../i18n'
import { resolveIcon } from './Icons'
import { WALLPAPERS } from './AuroraBackdrop'
import { useHomePrefs, setHomePrefs, resetHomePrefs, toggleSectionHidden, toggleFav, toggleDeviceHidden, orderSections } from '../homePrefs'

// Apple-Home-style "Edit Home View" sheet: drag sections into order, switch
// them on/off, reorder or remove favourites, and bring back hidden devices.

const WALL_LABELS = { auto: 'Time of day', aurora: 'Aurora', sunset: 'Sunset', ocean: 'Ocean', forest: 'Forest', off: 'None' }

function Handle({ controls }) {
  return (
    <span className="he-handle" aria-hidden="true"
      onPointerDown={e => { e.preventDefault(); controls.start(e) }}>
      <svg width="18" height="18" viewBox="0 0 18 18"><path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
    </span>
  )
}

function SectionRow({ section, shown }) {
  const controls = useDragControls()
  const Icon = section.Icon
  return (
    <Reorder.Item value={section.id} dragListener={false} dragControls={controls} className="he-row" data-off={!shown || undefined}>
      <Handle controls={controls} />
      <span className="he-icon">{Icon && <Icon size={17} color="currentColor" />}</span>
      <span className="he-label">{section.label}</span>
      {section.count != null && <span className="he-count">{section.count}</span>}
      <div role="switch" aria-checked={shown} aria-label={section.label} tabIndex={0}
        onClick={() => toggleSectionHidden(section.id, shown)}
        onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleSectionHidden(section.id, shown) } }}
        style={{ padding: 8, margin: -8, cursor: 'pointer' }}>
        <div className="ios-switch" data-on={String(shown)} />
      </div>
    </Reorder.Item>
  )
}

function FavRow({ device }) {
  const controls = useDragControls()
  const I = resolveIcon(device)
  return (
    <Reorder.Item value={device.key} dragListener={false} dragControls={controls} className="he-row">
      <Handle controls={controls} />
      <span className="he-icon"><I size={17} color="currentColor" /></span>
      <span className="he-label">{device.label}</span>
      <button type="button" className="he-mini" onClick={() => toggleFav(device.key, false)}
        title={gt('home_unfav', 'Remove from favourites')} aria-label={gt('home_unfav', 'Remove from favourites')}>★</button>
    </Reorder.Item>
  )
}

export default function HomeEditor({ open, onClose, sections, devices }) {
  const prefs = useHomePrefs()
  // two-tap reset (no window.confirm — the macOS app's WKWebView has no dialog handler)
  const [confirmReset, setConfirmReset] = useState(false)
  const byKey = new Map(devices.map(d => [d.key, d]))
  const order = orderSections(sections.map(s => s.id), prefs.order)
  const meta = new Map(sections.map(s => [s.id, s]))
  const favs = prefs.favs.filter(k => byKey.has(k))
  const hiddenDevs = prefs.hiddenDevices.filter(k => byKey.has(k))

  return (
    <AnimatePresence>
      {open && (
        <motion.div key="he-backdrop" className="dm-backdrop"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
          onClick={onClose}
          style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'var(--hk-backdrop)',
            backdropFilter: 'blur(26px) saturate(1.5)', WebkitBackdropFilter: 'blur(26px) saturate(1.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
          <motion.div key="he-card" className="dm-card"
            initial={{ opacity: 0, scale: 0.92, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            onClick={e => e.stopPropagation()}
            style={{ position: 'relative', width: 'min(520px, 100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column',
              background: 'var(--modal-grad)', borderRadius: 'var(--sheet-radius)', overflow: 'hidden' }}>
            <div className="dm-handle" aria-hidden="true" />
            <div className="he-head">
              <button type="button" className="he-text-btn" data-danger={confirmReset || undefined}
                onClick={() => { if (confirmReset) { resetHomePrefs(); setConfirmReset(false) } else setConfirmReset(true) }}
                onBlur={() => setConfirmReset(false)}>
                {confirmReset ? gt('home_reset_confirm', 'Tap again') : gt('home_reset', 'Reset')}
              </button>
              <div className="he-title">{gt('home_edit_title', 'Edit Home View')}</div>
              <button type="button" className="he-text-btn he-done" onClick={onClose}>{gt('dash_edit_done', 'Done')}</button>
            </div>

            <div className="he-body">
              <div className="he-group-label">{gt('home_wallpaper', 'Wallpaper')}</div>
              <div className="he-walls" role="radiogroup" aria-label={gt('home_wallpaper', 'Wallpaper')}>
                {WALLPAPERS.map(w => (
                  <button key={w} type="button" role="radio" aria-checked={prefs.wallpaper === w} className="he-wall"
                    data-active={prefs.wallpaper === w || undefined} onClick={() => setHomePrefs({ wallpaper: w })}>
                    <span className="he-wall-sw" data-pal={w} />
                    {gt('wall_' + w, WALL_LABELS[w])}
                  </button>
                ))}
              </div>

              <div className="he-group-label">{gt('home_sections', 'Sections')}</div>
              <Reorder.Group axis="y" values={order} onReorder={next => setHomePrefs({ order: next })} className="he-list">
                {order.map(id => <SectionRow key={id} section={meta.get(id)} shown={!prefs.hidden.includes(id)} />)}
              </Reorder.Group>
              <div className="he-hint">{gt('home_sections_hint', 'Drag ≡ to reorder. Switched-off sections stay reachable from the sidebar.')}</div>

              <div className="he-group-label">{gt('home_favs', 'Favourites')}</div>
              {favs.length > 0 ? (
                <Reorder.Group axis="y" values={favs} onReorder={next => setHomePrefs({ favs: next })} className="he-list">
                  {favs.map(k => <FavRow key={k} device={byKey.get(k)} />)}
                </Reorder.Group>
              ) : (
                <div className="he-empty">{gt('home_favs_empty', 'Open a device and tap ☆ to add it here.')}</div>
              )}

              {hiddenDevs.length > 0 && <>
                <div className="he-group-label">{gt('home_hidden_devices', 'Hidden from home view')}</div>
                <div className="he-list">
                  {hiddenDevs.map(k => {
                    const d = byKey.get(k), I = resolveIcon(d)
                    return (
                      <div key={k} className="he-row">
                        <span className="he-icon"><I size={17} color="currentColor" /></span>
                        <span className="he-label">{d.label}</span>
                        <button type="button" className="he-text-btn" onClick={() => toggleDeviceHidden(k, false)}>{gt('home_show', 'Show')}</button>
                      </div>
                    )
                  })}
                </div>
              </>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
