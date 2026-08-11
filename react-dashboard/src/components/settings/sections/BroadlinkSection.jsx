import { useEffect, useState } from 'react'
import { SettingsCard, ListEditor, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { RemoteIcon } from '../../Icons'
import { gt } from '../../../i18n'

const FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'host', label: 'Host / IP', placeholder: '192.168.1.x' },
  { key: 'mac', label: 'MAC', placeholder: 'printed on device label' },
]

export default function BroadlinkSection({ config, reload }) {
  const [devices, setDevices] = useState(config.broadlink?.devices || [])
  const [codes, setCodes] = useState({})
  const [learnName, setLearnName] = useState({}) // host -> pending name being learned
  const [learning, setLearning] = useState(null) // host currently learning
  const save = useSettingsSave('/api/settings/broadlink')
  const test = useSettingsSave('/api/settings/test-broadlink')
  const [testingIdx, setTestingIdx] = useState(null)

  const loadCodes = () => fetch('/api/broadlink/codes', { credentials: 'include' }).then(r => r.json()).then(setCodes).catch(() => {})
  useEffect(() => { if (devices.length) loadCodes() }, [])

  const learn = async (host, kind) => {
    const name = (learnName[host] || '').trim()
    if (!name) return
    setLearning(host)
    try {
      const res = await fetch(`/api/broadlink/learn/${kind}`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, name }),
      })
      const text = await res.text()
      const lastLine = text.trim().split('\n').pop()
      const result = JSON.parse(lastLine)
      if (!result.success) throw new Error(result.error || 'Learn failed')
      setLearnName(prev => ({ ...prev, [host]: '' }))
      loadCodes()
    } catch (err) {
      save.setResult({ ok: false, message: err.message })
    } finally { setLearning(null) }
  }

  const sendCode = (host, name) => fetch('/api/broadlink/send', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host, name }),
  }).catch(() => {})

  const deleteCode = (host, name) => fetch('/api/broadlink/codes', {
    method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host, name }),
  }).then(loadCodes).catch(() => {})

  return (
    <SettingsCard icon={RemoteIcon} title="BroadLink RM4 IR/RF" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Control BroadLink RM4 Pro/Mini IR blasters and RF transmitters. Learn IR and RF codes by name, store them locally, and trigger them from the dashboard or via API. MAC address is printed on the device label.">
      <ListEditor rows={devices} onChange={setDevices} fields={FIELDS} addLabel={gt('common.add_device', '+ Add Device')}
        renderExtra={(row, i) => (
          <Button variant="secondary" busy={test.busy && testingIdx === i}
            onClick={() => { setTestingIdx(i); test.save({ host: row.host }).finally(() => setTestingIdx(null)) }}>
            {gt('common.test', 'Test')}
          </Button>
        )}/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={() => save.save(devices).then(res => { reload?.(); loadCodes(); return res })}>{gt('common.save_devices', 'Save Devices')}</Button>
        <ResultBanner result={save.result || test.result}/>
      </div>

      {devices.filter(d => d.host).length > 0 && (
        <>
          <h4 className="stg-subheading">Code Library</h4>
          {devices.filter(d => d.host).map(d => (
            <div key={d.host} className="stg-subfields">
              <div className="stg-token-list">
                {(Object.entries(codes[d.host] || {})).length === 0 && <span className="stg-token-empty">No codes learned yet for {d.name || d.host}.</span>}
                {Object.entries(codes[d.host] || {}).map(([name, entry]) => (
                  <div className="stg-token-row" key={name}>
                    <span className="stg-token-name">{name}</span>
                    <span className="stg-token-role">{entry.type}</span>
                    <Button variant="secondary" onClick={() => sendCode(d.host, name)}>Send</Button>
                    <button className="stg-token-delete" onClick={() => deleteCode(d.host, name)}>✕</button>
                  </div>
                ))}
              </div>
              <div className="stg-actions">
                <Field label="" value={learnName[d.host] || ''} onChange={v => setLearnName(prev => ({ ...prev, [d.host]: v }))}
                  placeholder="Code name" style={{ flex: 1, marginBottom: 0 }}/>
                <Button variant="secondary" busy={learning === d.host} onClick={() => learn(d.host, 'ir')}>Learn IR</Button>
                <Button variant="secondary" busy={learning === d.host} onClick={() => learn(d.host, 'rf')}>Learn RF</Button>
              </div>
            </div>
          ))}
        </>
      )}
    </SettingsCard>
  )
}
