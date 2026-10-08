import { SettingsCard } from '../primitives'
import BleScanner from '../BleScanner'

// Settings → System → Bluetooth scan — what this LSH host can hear over BLE.
export default function BleScanSection() {
  return (
    <SettingsCard title="Bluetooth scan"
      desc="Lists the Bluetooth LE devices this LSH host can hear right now, strongest signal first, with manufacturer and signal strength. Needs Linux + BlueZ (e.g. the Arduino UNO Q). Victron devices found here can be added under Energy → LSH BLE.">
      <BleScanner/>
    </SettingsCard>
  )
}
