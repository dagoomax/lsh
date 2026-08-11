import { useEffect, useState } from 'react'
import { SettingsCard, ListEditor, Field, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { PlanIcon } from '../../Icons'

const FLOORS = [['cellar', 'Cellar'], ['floor1', '1st Floor'], ['floor2', '2nd Floor']]
const ROOM_FIELDS = [
  { key: 'name', label: 'Room name' },
  { key: 'floor', label: 'Floor', type: 'select', default: 'floor1', options: FLOORS.map(([v, l]) => ({ value: v, label: l })) },
  { key: 'x', label: 'X', type: 'number', default: 0 },
  { key: 'y', label: 'Y', type: 'number', default: 0 },
  { key: 'w', label: 'W', type: 'number', default: 3 },
  { key: 'd', label: 'D', type: 'number', default: 3 },
]

export default function HomePlanSection() {
  const [rooms, setRooms] = useState(null)
  const [singleFloor, setSingleFloor] = useState(false)
  const [floors, setFloors] = useState({ cellar: { image: '', w: 12, h: 9 }, floor1: { image: '', w: 12, h: 9 }, floor2: { image: '', w: 12, h: 9 } })
  const save = useSettingsSave('/api/settings/home-plan')

  useEffect(() => {
    fetch('/api/home-plan', { credentials: 'include' }).then(r => r.json()).then(d => {
      setRooms(d.plan?.rooms || [])
      setSingleFloor(!!d.plan?.singleFloor)
      if (d.plan?.floors) setFloors(prev => ({ ...prev, ...d.plan.floors }))
    }).catch(() => setRooms([]))
  }, [])

  const setFloor = (key, patch) => setFloors(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }))

  const doSave = () => save.save({
    singleFloor, rooms: rooms || [],
    floors: Object.fromEntries(FLOORS.map(([k]) => [k, floors[k]])),
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
          </div>
        </div>
      ))}

      <h4 className="stg-subheading">Rooms</h4>
      {rooms == null
        ? <p className="stg-hint">Loading…</p>
        : <ListEditor rows={rooms} onChange={setRooms} fields={ROOM_FIELDS} addLabel="+ Add Room"/>}

      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={doSave}>Save Plan</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
