import { useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { LgAppliianceIcon } from '../../Icons'
import { gt } from '../../../i18n'

const COUNTRIES = [['US', 'US — United States'], ['EU', 'EU — Europe'], ['KR', 'KR — Korea'], ['AU', 'AU — Australia'], ['CA', 'CA — Canada'], ['JP', 'JP — Japan']]

export default function LgThinqSection({ config, reload }) {
  const [country, setCountry] = useState(config.lgthinq?.country || 'US')
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [refreshToken, setRefreshToken] = useState('')
  const [userNumber, setUserNumber] = useState(config.lgthinq?.userNumber || '')
  const [showManual, setShowManual] = useState(false)
  const fetchTokens = useSettingsSave('/api/settings/lgthinq-login')
  const save = useSettingsSave('/api/settings/lgthinq')

  const doFetch = () => {
    if (!loginEmail || !loginPass) { fetchTokens.setResult({ ok: false, message: 'Enter email and password first' }); return }
    fetchTokens.save({ username: loginEmail, password: loginPass, country }).then(res => {
      if (res.access_token) setAccessToken(res.access_token)
      if (res.refresh_token) setRefreshToken(res.refresh_token)
      if (res.user_number) setUserNumber(res.user_number)
      setShowManual(true)
      fetchTokens.setResult({ ok: true, message: res.message || 'Tokens fetched — review and save' })
    }).catch(() => {})
  }

  return (
    <SettingsCard icon={LgAppliianceIcon} title={gt('s.lgthinq_title', 'LG ThinQ')} badge={{ label: gt('common.optional', 'Optional') }}
      desc={gt('sdesc.d19', 'Connects to your LG ThinQ account via the v1 cloud API. Fetch tokens automatically or paste them manually. Password is never stored.')}>
      <Field label={gt('s.lgthinq_country', 'Country')} hint="(match your LG account region)" type="select" value={country} onChange={setCountry}
        options={COUNTRIES.map(([v, l]) => ({ value: v, label: l }))}/>
      <Field label="LG Account Email" hint="(used once to fetch tokens — never stored)" type="email" value={loginEmail} onChange={setLoginEmail}/>
      <Field label="LG Account Password" hint="(used once — never stored)" type="password" value={loginPass} onChange={setLoginPass}/>
      <div className="stg-actions">
        <Button variant="secondary" busy={fetchTokens.busy} onClick={doFetch}>Fetch Tokens &amp; User Number</Button>
        <ResultBanner result={fetchTokens.result}/>
      </div>

      <button className="stg-disclosure" onClick={() => setShowManual(v => !v)}>
        {showManual ? '▾' : '▸'} Or paste tokens manually
      </button>
      {showManual && (
        <div className="stg-subfields">
          <Field label="Access Token" type="password" value={accessToken} onChange={setAccessToken}/>
          <Field label="Refresh Token" type="password" value={refreshToken} onChange={setRefreshToken}/>
          <Field label="User Number" hint="(e.g. EU0123456789)" value={userNumber} onChange={setUserNumber} placeholder="EU0123456789"/>
        </div>
      )}

      <div className="stg-actions">
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({ access_token: accessToken, refresh_token: refreshToken, user_number: userNumber, country }).then(reload)}>
          {gt('common.save', 'Save')}
        </Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
