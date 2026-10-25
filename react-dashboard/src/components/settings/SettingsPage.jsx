import { useEffect, useRef, useState } from 'react'
import { filterCategories, findSection, FIRST_SECTION_ID } from './sectionRegistry'
import { gt, tr, LANGUAGES, getLang, setLang, loadPhrases } from '../../i18n'
import '../../styles/settings.css'

import ConnectionSection from './sections/ConnectionSection'
import EnergySection from './sections/EnergySection'
import TariffSection from './sections/TariffSection'
import GoogleCalendarSection from './sections/GoogleCalendarSection'
import SmartHomeSection from './sections/SmartHomeSection'
import RoborockSection from './sections/RoborockSection'
import DreameSection from './sections/DreameSection'
import KarcherSection from './sections/KarcherSection'
import EcovacsSection from './sections/EcovacsSection'
import MobotixSection from './sections/MobotixSection'
import AxisSection from './sections/AxisSection'
import DahuaSection from './sections/DahuaSection'
import TuyaSection from './sections/TuyaSection'
import MqttBrokerSection from './sections/MqttBrokerSection'
import SonoffSection from './sections/SonoffSection'
import YaleSection from './sections/YaleSection'
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
import AirplaySection from './sections/AirplaySection'
import LoxoneSection from './sections/LoxoneSection'
import FibaroOutSection from './sections/FibaroOutSection'
import LoxoneXmlSection from './sections/LoxoneXmlSection'
import KnxSection from './sections/KnxSection'
import BoneioGrentonSection from './sections/BoneioGrentonSection'
import SmartBobSection from './sections/SmartBobSection'
import AquiloSection from './sections/AquiloSection'
import AirbnbSection, { BookingSection, VrboSection } from './sections/AirbnbSection'
import TenantSection from './sections/TenantSection'
import NukiSection from './sections/NukiSection'
import ZehnderSection from './sections/ZehnderSection'
import { AirConditionersSection, BatteriesSection } from './sections/IntegrationsSection'
import ArduinoSection from './sections/ArduinoSection'
import EsphomeSection from './sections/EsphomeSection'
import BroadlinkSection from './sections/BroadlinkSection'
import WaveshareSection from './sections/WaveshareSection'
import SatelSection from './sections/SatelSection'
import DscSection from './sections/DscSection'
import HomeAssistantSection from './sections/HomeAssistantSection'
import SpotifySection from './sections/SpotifySection'
import AppleMusicSection from './sections/AppleMusicSection'
import TidalSection from './sections/TidalSection'
import LgWebosSection from './sections/LgWebosSection'
import AnnounceSection from './sections/AnnounceSection'
import TedeeSection from './sections/TedeeSection'
import SipSection from './sections/SipSection'
import PagingSection from './sections/PagingSection'
import SystemMiscSection from './sections/SystemMiscSection'
import HomeKitSection from './sections/HomeKitSection'
import MatterSection from './sections/MatterSection'
import HomePlanSection from './sections/HomePlanSection'
import VirtualDevicesSection from './sections/VirtualDevicesSection'
import SmartThingsSection from './sections/SmartThingsSection'
import SecuritySection from './sections/SecuritySection'
import ReolinkSection from './sections/ReolinkSection'
import EzvizSection from './sections/EzvizSection'
import CamerasSection from './sections/CamerasSection'
import BackupRestoreSection from './sections/BackupRestoreSection'
import ModulesSection from './sections/ModulesSection'
import LshBleSection from './sections/LshBleSection'
import CanScanSection from './sections/CanScanSection'
import ModbusScanSection from './sections/ModbusScanSection'
import ModbusEmuSection from './sections/ModbusEmuSection'
import ManualsSection from './sections/ManualsSection'
import WiringSection from './sections/WiringSection'
import BleScanSection from './sections/BleScanSection'
import LanScanSection from './sections/LanScanSection'

// Section id → component (sectionRegistry has the sidebar grouping)
const SECTION_COMPONENTS = {
  connection: ConnectionSection,
  'energy-extra': EnergySection,
  tariff: TariffSection,
  'google-calendar': GoogleCalendarSection,
  'smarthome-extra': SmartHomeSection,
  roborock: RoborockSection,
  dreame: DreameSection,
  karcher: KarcherSection,
  ecovacs: EcovacsSection,
  mobotix: MobotixSection,
  axis: AxisSection,
  dahua: DahuaSection,
  tuya: TuyaSection,
  'mqtt-broker': MqttBrokerSection,
  sonoff: SonoffSection,
  yale: YaleSection,
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
  airplay: AirplaySection,
  loxone: LoxoneSection,
  fibaroout: FibaroOutSection,
  loxonexml: LoxoneXmlSection,
  knx: KnxSection,
  'boneio-grenton': BoneioGrentonSection,
  smartbob: SmartBobSection,
  aquilo: AquiloSection,
  airbnb: AirbnbSection,
  booking: BookingSection,
  vrbo: VrboSection,
  tenant: TenantSection,
  nuki: NukiSection,
  zehnder: ZehnderSection,
  'air-conditioners': AirConditionersSection,
  'home-batteries': BatteriesSection,
  arduino: ArduinoSection,
  esphome: EsphomeSection,
  broadlink: BroadlinkSection,
  waveshare: WaveshareSection,
  satel: SatelSection,
  dsc: DscSection,
  homeassistant: HomeAssistantSection,
  spotify: SpotifySection,
  applemusic: AppleMusicSection,
  tidal: TidalSection,
  lgwebos: LgWebosSection,
  announce: AnnounceSection,
  tedee: TedeeSection,
  sip: SipSection,
  paging: PagingSection,
  'system-misc': SystemMiscSection,
  homekit: HomeKitSection,
  matter: MatterSection,
  homeplan: HomePlanSection,
  virtual: VirtualDevicesSection,
  smartthings: SmartThingsSection,
  'security-auth': SecuritySection,
  reolink: ReolinkSection,
  ezviz: EzvizSection,
  manualcams: CamerasSection,
  backup: BackupRestoreSection,
  modules: ModulesSection,
  'lsh-ble': LshBleSection,
  'ble-scan': BleScanSection,
  'lan-scan': LanScanSection,
  'can-scan': CanScanSection,
  'modbus-scan': ModbusScanSection,
  'modbus-emu': ModbusEmuSection,
  manuals: ManualsSection,
  wiring: WiringSection,
}

// The open section lives in the URL — /react/settings/<section> — so a reload,
// a bookmark or the back button lands on it again
const sectionFromPath = () => {
  const id = window.location.pathname.replace(/^\/react\/settings\/?/, '').split('/')[0]
  return findSection(id) ? id : null
}

export default function SettingsPage({ onClose, onOpenCssEditor }) {
  const [activeId, setActiveIdState] = useState(() => sectionFromPath() || FIRST_SECTION_ID)
  const setActiveId = (id) => {
    setActiveIdState(id)
    const path = `/react/settings/${id}`
    if (window.location.pathname !== path) window.history.pushState({}, '', path)
  }
  useEffect(() => {
    const onPop = () => setActiveIdState(sectionFromPath() || FIRST_SECTION_ID)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  // Settings text comes from the phrase book — fetched for the selected
  // language, again whenever the language changes (picker below or Header)
  const lang = getLang()
  useEffect(() => { loadPhrases() }, [lang])
  const activeRef = useRef(null)
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest' }) }, [activeId])
  const [query, setQuery] = useState('')
  const [config, setConfig] = useState(null)
  const [loadError, setLoadError] = useState(null)
  // Header (the dashboard's only theme toggle) isn't rendered while this
  // page is showing, so there'd otherwise be no way to check/flip theme
  // without leaving Settings first.
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('lsh-theme') || 'dark' } catch { return 'dark' }
  })
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    try { localStorage.setItem('lsh-theme', next) } catch { /* ignore */ }
    setTheme(next)
  }

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

  // not memoized: cheap, and the translated titles change when the phrase book arrives
  const filtered = filterCategories(query, tr)

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
        <select className="stg-lang" value={lang} onChange={e => setLang(e.target.value)}
          title={tr('Language')} aria-label={tr('Language')}>
          {LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select>
        <button className="stg-back" onClick={toggleTheme} title={theme === 'dark' ? tr('Light theme') : tr('Dark theme')}>
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </div>

      <div className="stg-shell">
        <nav className="stg-sidebar">
          <div className="stg-search-wrap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" className="stg-search-icon">
              <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>
            </svg>
            <input className="stg-search" placeholder={gt('stg_search', 'Search settings…')}
              value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && filtered[0]) setActiveId(filtered[0].sections[0].id)
                if (e.key === 'Escape') setQuery('')
              }}/>
          </div>
          {filtered.map(cat => (
            <div className="stg-nav-group" key={cat.id}>
              <div className="stg-nav-group-title">{tr(cat.label)}</div>
              {cat.sections.map(s => (
                <button key={s.id} ref={s.id === activeId ? activeRef : null}
                  className={`stg-nav-item${s.id === activeId ? ' active' : ''}`}
                  onClick={() => setActiveId(s.id)}>
                  <span>{tr(s.title)}</span>
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
              ? <ActiveComponent config={config} reload={load} onOpenCssEditor={onOpenCssEditor}/>
              : <MissingSection section={active}/>
          )}
        </div>
      </div>
    </div>
  )
}

function MissingSection({ section }) {
  return (
    <div className="stg-stub">
      <h2>{tr(section?.title)}</h2>
      <p>{gt('stg_stub_desc_v2', "This section isn't available in this version.")}</p>
    </div>
  )
}
