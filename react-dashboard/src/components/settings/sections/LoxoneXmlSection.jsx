import { useEffect, useState } from 'react'
import { SettingsCard, Field, Toggle, Button } from '../primitives'
import { LoxoneIcon } from '../../Icons'

export default function LoxoneXmlSection() {
  const [devices, setDevices] = useState([])
  const [tokens, setTokens] = useState([])
  const [selectedTypes, setSelectedTypes] = useState(new Set())
  const [namedOnly, setNamedOnly] = useState(false)
  const [tokenId, setTokenId] = useState('')
  const [host, setHost] = useState('')
  const [polling, setPolling] = useState(5000)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/devices', { credentials: 'include' }).then(r => r.json()),
      fetch('/api/auth/tokens', { credentials: 'include' }).then(r => r.json()),
    ]).then(([devRes, tokRes]) => {
      setDevices(devRes.data || [])
      const toks = tokRes.data || []
      setTokens(toks)
      if (toks.length) setTokenId(toks[0].id)
      if (!host) setHost(window.location.host)
    }).catch(err => setError(err.message))
  }, [])

  // Mirrors src/loxone-xml.js (text / label readings are never numeric)
  const isMomentary = s => s.controllable && s.type === 'toggle' && s.writeOn && s.writeOn === s.writeOff
  const isInput = s => !s.hidden && !['color', 'trigger', 'text', 'label'].includes(s.type) && !isMomentary(s)
  const isOutput = s => !s.hidden && s.controllable && s.type !== 'text'
  const music = devices.find(d => d.key === 'music/player')

  const byType = {}
  for (const d of devices) byType[d.type] = (byType[d.type] || 0) + 1
  const types = Object.keys(byType).sort()

  const active = devices.filter(d =>
    (!selectedTypes.size || selectedTypes.has(d.type)) && (!namedOnly || d.named !== false))
  let inputCount = 0, outputCount = 0
  for (const d of active) {
    inputCount += (d.sensors || []).filter(isInput).length
    outputCount += (d.sensors || []).filter(isOutput).length
  }

  const toggleType = (t) => {
    const next = new Set(selectedTypes)
    next.has(t) ? next.delete(t) : next.add(t)
    setSelectedTypes(next)
  }

  const download = (kind, file = `${kind}.xml`, filtered = true) => {
    if (!tokenId) { setError('Create an API token first (Security → API Tokens)'); return }
    const params = new URLSearchParams()
    params.set('tokenId', tokenId)
    if (filtered && selectedTypes.size) params.set('type', [...selectedTypes].join(','))
    if (filtered && namedOnly) params.set('named', '1')
    if (host.trim()) params.set('host', host.trim())
    if (kind === 'inputs' && polling) params.set('polling', String(polling))
    setError('')
    window.location.href = `/api/loxone/${file}?${params}`
  }

  return (
    <SettingsCard icon={LoxoneIcon} title="Loxone XML Templates"
      desc="Generates ready-to-import Virtual Output (commands) and Virtual HTTP Input (feedback) templates for Loxone Config 17.1. Filter by brand, pick the API token to embed, and download — then import via Virtual Outputs/Virtual HTTP Inputs → template import.">
      <div className="stg-field">
        <label>Brands / Integrations <span className="stg-hint">(none checked = all)</span></label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
          {types.length === 0 && <span className="stg-hint">Loading devices…</span>}
          {types.map(t => (
            <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, cursor: 'pointer' }}>
              <input type="checkbox" className="stg-checkbox" checked={selectedTypes.has(t)} onChange={() => toggleType(t)}/>
              {t} <span className="stg-hint">({byType[t]})</span>
            </label>
          ))}
        </div>
      </div>
      <Toggle label="Named devices only" hint='(skip unnamed Satel zones/outputs like "Zone 33")' checked={namedOnly} onChange={setNamedOnly}/>
      <Field label="API Token" hint="(embedded into the generated URLs)" type="select" value={tokenId} onChange={setTokenId}
        options={tokens.length ? tokens.map(t => ({ value: t.id, label: t.name })) : [{ value: '', label: '— no API tokens; create one in Security → API Tokens —' }]}/>
      <Field label="LSH address as seen by the Miniserver" hint="(host:port)" value={host} onChange={setHost} placeholder="lsh.local:3000"/>
      <Field label="Input polling" hint="(ms, inputs.xml only)" type="number" value={polling} onChange={setPolling} placeholder="5000"/>
      <div className="stg-actions">
        <Button variant="primary" onClick={() => download('outputs')}>⬇ outputs.xml ({outputCount})</Button>
        <Button variant="primary" onClick={() => download('inputs')}>⬇ inputs.xml ({inputCount})</Button>
      </div>
      {music && (
        <div className="stg-field">
          <label>Music player <span className="stg-hint">(Spotify / Apple Music source selector — wire a Radio Buttons block to “Music Source”: 0 stop, 1 Spotify, 2 Apple Music)</span></label>
          <div className="stg-actions">
            <Button onClick={() => download('outputs', 'musicout.xml', false)}>⬇ Music outputs.xml ({(music.sensors || []).filter(isOutput).length})</Button>
            <Button onClick={() => download('inputs', 'musicin.xml', false)}>⬇ Music inputs.xml ({(music.sensors || []).filter(isInput).length})</Button>
          </div>
        </div>
      )}
      {error && <span className="stg-banner err">✗ {error}</span>}
    </SettingsCard>
  )
}
