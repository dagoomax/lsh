import { useEffect, useRef, useState } from 'react'
import { SettingsCard, ListEditor, Field, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { PlanIcon } from '../../Icons'
import { tr } from '../../../i18n'
import { postWithPin } from '../../../postWithPin'

const FLOORS = [['cellar', 'Cellar'], ['floor1', '1st Floor'], ['floor2', '2nd Floor']]
const ROOM_FIELDS = [
  { key: 'name', label: 'Room name' },
  { key: 'floor', label: 'Floor', type: 'select', default: 'floor1', options: FLOORS.map(([v, l]) => ({ value: v, label: l })) },
  { key: 'x', label: 'X', type: 'number', default: 0 },
  { key: 'y', label: 'Y', type: 'number', default: 0 },
  { key: 'w', label: 'W', type: 'number', default: 3 },
  { key: 'd', label: 'D', type: 'number', default: 3 },
]

const MODEL_EXT = ['glb', 'obj', 'png', 'jpg', 'jpeg', 'webp']
const MODEL_MAX = 50 * 1024 * 1024

// The imported model — a 3D file or a rendered picture — that the Plan shows in
// place of the drawn board. The same import as the Plan's own toolbar button,
// here because a wall tablet's Plan has no toolbar. It saves on its own, apart
// from "Save Plan" below.
function ImportedModel({ model, onChange }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const input = useRef(null)

  const upload = async (file) => {
    if (!file) return
    setResult(null)
    const ext = file.name.toLowerCase().split('.').pop()
    if (!MODEL_EXT.includes(ext)) return setResult({ ok: false, message: 'File must be .glb, .obj, .png, .jpg or .webp' })
    if (file.size > MODEL_MAX) return setResult({ ok: false, message: 'Model too large (max 50 MB)' })
    setBusy(true)
    try {
      const data = await new Promise((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(fr.result)
        fr.onerror = () => reject(fr.error)
        fr.readAsDataURL(file)
      })
      const d = await postWithPin('/api/plan-model/upload', { name: file.name, data })
      if (d === null) return
      if (!d.success) return setResult({ ok: false, message: d.error || 'Upload failed' })
      onChange(d.model)
      // a picture takes the board's place on the Plan in this browser straight away
      if (d.model.image) { try { localStorage.setItem('planHtmlModel', '1') } catch { /* private mode */ } }
      setResult({ ok: true, message: d.model.image ? tr('Imported — open the Plan and use "Place devices" to pin your devices on the picture') : tr('Imported — open the Plan to see it') })
    } catch {
      setResult({ ok: false, message: 'Could not read the file' })
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  const remove = async () => {
    if (!window.confirm(tr('Remove the imported floor-plan model?'))) return
    setResult(null)
    const d = await postWithPin('/api/plan-model/remove', {})
    if (d === null) return
    if (!d.success) return setResult({ ok: false, message: d.error || 'Failed' })
    onChange(null)
    setResult({ ok: true, message: 'Removed' })
  }

  const pinned = Object.keys(model?.pins || {}).length
  return (
    <>
      <h4 className="stg-subheading">{tr('Imported model')}</h4>
      <p className="stg-hint">
        {tr('A 3D model (.glb or .obj) or a rendered picture of the home (.png, .jpg, .webp), shown on the Plan in place of the drawn board. Only one is kept: importing another replaces it and the device positions made on it.')}
      </p>
      <p className="stg-hint">
        {model === undefined ? tr('Loading…')
          : !model ? tr('No model imported')
            : <><b>{model.name}</b> — {model.image ? tr('Picture') : tr('3D model')}{model.image ? ` · ${pinned} ${tr('devices pinned')}` : ''}</>}
      </p>
      <div className="stg-actions">
        <Button busy={busy} onClick={() => input.current?.click()}>{model ? tr('Replace model…') : tr('Import model…')}</Button>
        {model && <Button variant="danger" onClick={remove}>{tr('Remove model')}</Button>}
        <ResultBanner result={result}/>
        <input ref={input} type="file" style={{ display: 'none' }} aria-label={tr('Imported model')}
          accept=".glb,.obj,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
          onChange={(e) => upload(e.target.files?.[0])}/>
      </div>
    </>
  )
}

const LAYER_TOGGLES = [
  ['furniture', 'Furniture (auto-generated per-room icons, or the 3D furniture layer)'],
  ['appliances', 'Appliances (device chips)'],
  ['power', 'Power-flow overlay'],
  ['walls', '3D wall/window layer'],
  ['textures', 'Floor textures'],
  ['satellite', 'Satellite imagery around the building (loads from a public map server — reveals your approximate location to it)'],
  ['surroundings', '3D neighboring buildings/trees (stylized, not a surveyed reconstruction)'],
]

export default function HomePlanSection() {
  const [rooms, setRooms] = useState(null)
  const [singleFloor, setSingleFloor] = useState(false)
  const [floors, setFloors] = useState({ cellar: { image: '', w: 12, h: 9 }, floor1: { image: '', w: 12, h: 9 }, floor2: { image: '', w: 12, h: 9 } })
  const [defaultLayers, setDefaultLayers] = useState({})
  const [model, setModel] = useState(undefined) // undefined = loading, null = none imported
  const save = useSettingsSave('/api/settings/home-plan')

  useEffect(() => {
    fetch('/api/home-plan', { credentials: 'include' }).then(r => r.json()).then(d => {
      setRooms(d.plan?.rooms || [])
      setSingleFloor(!!d.plan?.singleFloor)
      if (d.plan?.floors) setFloors(prev => ({ ...prev, ...d.plan.floors }))
      setDefaultLayers(d.plan?.defaultLayers || {})
      setModel(d.plan?.model?.url ? d.plan.model : null)
    }).catch(() => { setRooms([]); setModel(null) })
  }, [])

  const setFloor = (key, patch) => setFloors(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  const setLayer = (key, val) => setDefaultLayers(prev => ({ ...prev, [key]: val }))

  const doSave = () => save.save({
    singleFloor, rooms: rooms || [],
    floors: Object.fromEntries(FLOORS.map(([k]) => [k, floors[k]])),
    defaultLayers,
  })

  return (
    <SettingsCard icon={PlanIcon} title="Home Plan" badge={{ label: 'Optional' }}
      desc="Arrange your rooms on a grid for the dashboard's isometric Plan view. Room names must match the rooms assigned to devices. Coordinates are grid cells: X/Y position, W/D size.">
      <Toggle label="Single floor plan — one picture, hide the floor switcher in the dashboard" checked={singleFloor} onChange={setSingleFloor}/>

      {FLOORS.map(([key, label]) => (
        <div className="stg-list-row" key={key}>
          <div className="stg-list-row-fields">
            <Field label={label} value={floors[key]?.image || ''} onChange={v => setFloor(key, { image: v })} placeholder="Background image URL (optional)"/>
            <Field label="W" type="number" value={floors[key]?.w ?? 12} onChange={v => setFloor(key, { w: v })}/>
            <Field label="D" type="number" value={floors[key]?.h ?? 9} onChange={v => setFloor(key, { h: v })}/>
            <Field label="Refresh (s)" type="number" value={floors[key]?.refreshSec ?? ''} placeholder="off"
              onChange={v => setFloor(key, { refreshSec: v === '' ? undefined : Number(v) })}/>
          </div>
        </div>
      ))}

      <ImportedModel model={model} onChange={setModel}/>

      <h4 className="stg-subheading">{tr('Rooms')}</h4>
      {rooms == null
        ? <p className="stg-hint">{tr('Loading…')}</p>
        : <ListEditor rows={rooms} onChange={setRooms} fields={ROOM_FIELDS} addLabel="+ Add Room"/>}

      <h4 className="stg-subheading">{tr('Default layer visibility')}</h4>
      <p className="stg-hint">
        {tr("Starting state of each Plan-view toggle pill, for browsers that haven't set one themselves yet — an explicit tap on a pill always overrides this.")}
      </p>
      {LAYER_TOGGLES.map(([key, label]) => (
        <Toggle key={key} label={label} checked={defaultLayers[key] !== false} onChange={v => setLayer(key, v)}/>
      ))}

      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={doSave}>{tr('Save Plan')}</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
