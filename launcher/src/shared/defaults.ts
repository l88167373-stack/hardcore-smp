import { recommendedMemory } from './memory'
import type { Settings } from './schemas'

/** Paramètres d'un launcher fraîchement installé. */
export function defaultSettings(totalMemoryMb: number): Settings {
  return {
    memoryMb: recommendedMemory(totalMemoryMb),
    resolution: { width: 1280, height: 720, fullscreen: false },
    closeOnLaunch: false,
    jvmArgs: '',
    discordRichPresence: true,
    onboardingCompleted: false,
    acceptedRulesVersion: 0
  }
}
