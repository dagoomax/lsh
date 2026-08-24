import { useState } from 'react'
import { SettingsCard, ListEditor, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { SpeakerIcon } from '../../Icons'
import { gt } from '../../../i18n'

const FIELDS = [
  { key: 'id', label: 'Room ID', placeholder: 'livingroom' },
  { key: 'label', label: 'Label', placeholder: 'Living Room' },
]

export default function PagingSection({ config, reload }) {
  const paging = config.paging || {}
  const [enabled, setEnabled] = useState(!!paging.enabled)
  const [rooms, setRooms] = useState(paging.rooms || [])
  const save = useSettingsSave('/api/settings/paging')

  return (
    <SettingsCard icon={SpeakerIcon} title={gt('s.paging_title', '📢 Room-to-Room Paging')} badge={{ label: gt('common.optional', 'Optional') }}
      desc={gt('sdesc.d41', 'Two-way intercom between browser tablets (e.g. Wall Dashboard kiosks) — no SIP or extra hardware needed. Define one room per device you want pageable, then page one room from another from the dashboard.')}>
      <Toggle label={gt('s.paging_enabled', 'Enable room-to-room paging')} checked={enabled} onChange={setEnabled}/>
      <ListEditor rows={rooms} onChange={setRooms} fields={FIELDS} addLabel="+ Add Room"/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({
            enabled,
            rooms: rooms.filter(r => r.id).map(r => ({ id: r.id, label: r.label || r.id })),
          }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
