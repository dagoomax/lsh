import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { DEVICES, CONNECTORS } from './devices.js'
import { t } from './i18n.js'

// "How it works" dialog for the wiring emulator: modes, legend, controls,
// what the simulation checks, and where the data comes from.

const LEGEND = [
  { swatch: '#b5651d', text: 'Live (L) — brown; dots moving along it = current flowing' },
  { swatch: '#2f80ed', text: 'Neutral (N) — blue' },
  { swatch: '#9acd32', dashed: true, text: 'Protective earth (PE) — green-yellow' },
  { swatch: '#ff9f0a', text: 'Switch supply from the dimmer’s Sx terminal — orange' },
  { swatch: '#ff3b30', text: '+24 V DC (controller side) — red' },
  { swatch: '#3a3a3c', text: '0 V DC — black' },
  { swatch: '#8e8e93', text: 'Not live right now (switched wire with the switch open, or power off)' },
]

export default function WiringInfo({ onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return createPortal(
    <div className="lan-popup-backdrop wr-info-backdrop" onClick={onClose}>
      <div className="wr-info" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('How the wiring emulator works')}>
        <div className="lan-popup-head">
          <b>ℹ {t('How the wiring emulator works')}</b>
          <span style={{ flex: 1 }}/>
          <button className="lan-popup-close" onClick={onClose} title={t('Close (Esc)')}>✕</button>
        </div>
        <div className="wr-info-body">
          <section>
            <h4>{t('Two ways to use it')}</h4>
            <p><b>📖 {t('Assistant')}</b> — {t('shows the manual’s diagram wire by wire. Click a step to jump to it; the current wire is highlighted.')}</p>
            <p><b>🧪 {t('Practice')}</b> — {t('you wire it yourself, then Check wiring compares it with the manual and Power on simulates it.')}</p>
            <p><b>☑ {t('Real wall box (connectors)')}</b> — {t('the incoming cable has one L, one N and one PE conductor, like in a real box, so every split needs a connector. The assistant adds the right ones and the materials list counts them.')}</p>
          </section>

          <section>
            <h4>{t('Colours and symbols')}</h4>
            {LEGEND.map((l) => (
              <div key={l.text} className="wr-info-row">
                <svg width="34" height="10"><line x1="2" x2="32" y1="5" y2="5" stroke={l.swatch} strokeWidth="4" strokeDasharray={l.dashed ? '6 4' : undefined}/></svg>
                <span>{t(l.text)}</span>
              </div>
            ))}
            <div className="wr-info-row"><span className="wr-info-sym">💡</span><span>{t('Lamp glows when it has live on one side and neutral on the other; dimmer level shows as brightness.')}</span></div>
            <div className="wr-info-row"><span className="wr-info-sym" style={{ color: '#30d158' }}>●</span><span>{t('Green LED on the module = it has power.')}</span></div>
            <div className="wr-info-row"><span className="wr-info-sym">⚡</span><span>{t('Red flash = the breaker tripped (short circuit or earth fault).')}</span></div>
            <div className="wr-info-row"><span className="wr-info-sym">○ ●</span><span>{t('Push-button (pressed while held) · I / O = toggle switch position.')}</span></div>
          </section>

          <section>
            <h4>{t('Controls')}</h4>
            <ul>
              <li>{t('Draw a wire: click a connection point, click empty space for each bend, click the end point. Esc or right-click cancels.')}</li>
              <li>{t('Pick the wire colour first — a wrong colour (e.g. blue on live) is flagged.')}</li>
              <li>{t('Remove a wire: click it. Connectors: add from the palette, drag to move, × to remove.')}</li>
              <li>{t('Power on, then use the wall switch or the Z-Wave buttons; dimmers have a level slider, blinds run to their limits.')}</li>
              <li>{t('⤢ opens a large window: scroll to zoom, drag the background to pan, Esc closes.')}</li>
            </ul>
          </section>

          <section>
            <h4>{t('What it catches')}</h4>
            <ul>
              <li>{t('Short circuits and earth faults (the breaker trips).')}</li>
              <li>{t('Live on the N terminal, missing neutral, outputs wired to neutral or straight to live.')}</li>
              <li>{t('Dimmer Sx wired to live or neutral; switch inputs on neutral.')}</li>
              <li>{t('Motor driven both ways at once, missing earth.')}</li>
              <li>{t('More than two conductors on a terminal, two on one connector port, a mains conductor feeding several wires in a real box.')}</li>
              <li>{t('Wire colours that don’t match what the wire carries.')}</li>
            </ul>
          </section>

          <section>
            <h4>{t('Where the data comes from')}</h4>
            <p>{t('Diagrams, terminals and limits are converted from the manufacturers’ installation manuals (Z-Wave Alliance product catalogue). The manuals open from each device’s panel.')}</p>
            <div className="wr-info-devs">
              {DEVICES.map((d) => (
                <a key={d.id} className="lan-port" href={`/api/manuals/${d.manual}/pdf`} target="_blank" rel="noopener noreferrer">
                  📄 {d.manufacturer} {d.model} · {t('{n} diagrams', { n: d.scenarios.length })}
                </a>
              ))}
            </div>
            <p className="stg-hint">{t('Connectors: {list} — or equivalent lever / push-in connectors of the same size.', { list: CONNECTORS.map((c) => c.model.replace('WAGO ', '')).join(', ') })}</p>
          </section>

          <section className="wr-info-warn">
            <b>⚠ {t('Practice tool only')}</b>
            <p>{t('The simulation is simplified (no currents, cable lengths or load limits). Always follow the device manual and local regulations, isolate and prove dead before touching anything, and leave mains work to a qualified electrician.')}</p>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  )
}
