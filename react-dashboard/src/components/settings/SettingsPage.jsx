import { useEffect, useMemo, useState } from 'react'
import { CATEGORIES, findSection, FIRST_PORTED_ID } from './sectionRegistry'
import { gt } from '../../i18n'
import '../../styles/settings.css'

import ConnectionSection from './sections/ConnectionSection'
import EnergySection from './sections/EnergySection'
import SmartHomeSection from './sections/SmartHomeSection'
import RoborockSection from './sections/RoborockSection'
import DreameSection from './sections/DreameSection'
import MobotixSection from './sections/MobotixSection'
import AxisSection from './sections/AxisSection'
import AeotecSection from './sections/AeotecSection'
import AiDetectionSection from './sections/AiDetectionSection'
import CamerasExtraSection from './sections/CamerasExtraSection'
import ClimateSection from './sections/ClimateSection'
import LgThinqSection from './sections/LgThinqSection'
import ApplianceCloudSection from './sections/ApplianceCloudSection'
import LightingSection from './sections/LightingSection'
import WledSection from './sections/WledSection'
import ShellySection from './sections/ShellySection'
import MediaSection from './sections/MediaSection'
import LoxoneSection from './sections/LoxoneSection'
import FibaroOutSection from './sections/FibaroOutSection'
import LoxoneXmlSection from './sections/LoxoneXmlSection'
import KnxSection from './sections/KnxSection'
import BoneioGrentonSection from './sections/BoneioGrentonSection'
import SmartBobSection from './sections/SmartBobSection'
import ArduinoSection from './sections/ArduinoSection'
import EsphomeSection from './sections/EsphomeSection'
import BroadlinkSection from './sections/BroadlinkSection'
import WaveshareSection from './sections/WaveshareSection'
import SatelSection from './sections/SatelSection'
import SipSection from './sections/SipSection'
import SystemMiscSection from './sections/SystemMiscSection'
import HomeKitSection from './sections/HomeKitSection'
import HomePlanSection from './sections/HomePlanSection'
import VirtualDevicesSection from './sections/VirtualDevicesSection'
import SmartThingsSection from './sections/SmartThingsSection'
import SecuritySection from './sections/SecuritySection'
import ReolinkSection from './sections/ReolinkSection'
import CamerasSection from './sections/CamerasSection'
import BackupRestoreSection from './sections/BackupRestoreSection'

// Section id → component, for the handful ported so far (see sectionRegistry
// for the full 57-section map). Anything not listed here renders a stub
// linking back to the classic page instead of pretending to exist.
const SECTION_COMPONENTS = {
  connection: ConnectionSection,
  'energy-extra': EnergySection,
  'smarthome-extra': SmartHomeSection,
  roborock: RoborockSection,
  dreame: DreameSection,
  mobotix: MobotixSection,
  axis: AxisSection,
  aeotec: AeotecSection,
  aidetect: AiDetectionSection,
  'cameras-extra': CamerasExtraSection,
  'climate-extra': ClimateSection,
  lgthinq: LgThinqSection,
  'appliance-cloud': ApplianceCloudSection,
  'lighting-extra': LightingSection,
  wled: WledSection,
  shelly: ShellySection,
  'media-all': MediaSection,
  loxone: LoxoneSection,
  fibaroout: FibaroOutSection,
  loxonexml: LoxoneXmlSection,
  knx: KnxSection,
  'boneio-grenton': BoneioGrentonSection,
  smartbob: SmartBobSection,
  arduino: ArduinoSection,
  esphome: EsphomeSection,
  broadlink: BroadlinkSection,
  waveshare: WaveshareSection,
  satel: SatelSection,
  sip: SipSection,
  'system-misc': SystemMiscSection,
  homekit: HomeKitSection,
  homeplan: HomePlanSection,
  virtual: VirtualDevicesSection,
  smartthings: SmartThingsSection,
  'security-auth': SecuritySection,
  reolink: ReolinkSection,
  manualcams: CamerasSection,
  backup: BackupRestoreSection,
}

export default function SettingsPage({ onClose }) {
  const [activeId, setActiveId] = useState(FIRST_PORTED_ID)
  const [query, setQuery] = useState('')
  const [config, setConfig] = useState(null)
  const [loadError, setLoadError] = useState(null)

  const load = async () => {
    try {
      const res = await fetch('/api/settings', { credentials: 'include' })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Failed to load settings')
      setConfig(data.data)
      setLoadError(null)
    } catch (err) { setLoadError(err.message) }
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return CATEGORIES
    return CATEGORIES
      .map(cat => ({ ...cat, sections: cat.sections.filter(s => s.title.toLowerCase().includes(q)) }))
      .filter(cat => cat.sections.length)
  }, [query])

  const active = findSection(activeId)
  const ActiveComponent = SECTION_COMPONENTS[activeId]

  return (
    <div className="stg-page">
      <div className="stg-topbar">
        <button className="stg-back" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          {gt('stg_back', 'Dashboard')}
        </button>
        <h1 className="stg-page-title">{gt('stg_title', 'Settings')}</h1>
        <span className="stg-page-title-spacer"/>
      </div>

      <div className="stg-shell">
        <nav className="stg-sidebar">
          <div className="stg-search-wrap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" className="stg-search-icon">
              <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>
            </svg>
            <input className="stg-search" placeholder={gt('stg_search', 'Search settings…')}
              value={query} onChange={e => setQuery(e.target.value)}/>
          </div>
          {filtered.map(cat => (
            <div className="stg-nav-group" key={cat.id}>
              <div className="stg-nav-group-title">{cat.label}</div>
              {cat.sections.map(s => (
                <button key={s.id}
                  className={`stg-nav-item${s.id === activeId ? ' active' : ''}${s.ported ? '' : ' stub'}`}
                  onClick={() => setActiveId(s.id)}>
                  <span>{s.title}</span>
                  {!s.ported && <span className="stg-nav-stub-dot" title="Not yet in the new Settings"/>}
                </button>
              ))}
            </div>
          ))}
          {filtered.length === 0 && <div className="stg-no-results">{gt('stg_no_results', 'No matching settings')}</div>}
        </nav>

        <div className="stg-content">
          {loadError && <div className="stg-banner err stg-load-error">✗ {loadError}</div>}
          {!config && !loadError && <div className="stg-loading">{gt('stg_loading', 'Loading…')}</div>}
          {config && (
            ActiveComponent
              ? <ActiveComponent config={config} reload={load}/>
              : <NotPortedNotice section={active}/>
          )}
        </div>
      </div>
    </div>
  )
}

function NotPortedNotice({ section }) {
  return (
    <div className="stg-stub">
      <h2>{section?.title}</h2>
      <p>{gt('stg_stub_desc', "This section hasn't been rebuilt in the new Settings yet — it still works exactly as before in the classic page.")}</p>
      <a className="stg-btn stg-btn-primary" href="/settings.html">{gt('stg_open_classic', 'Open classic Settings')} →</a>
    </div>
  )
}
