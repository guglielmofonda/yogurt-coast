import { createContext, useContext } from 'react'
import { t } from '../../../shared/i18n'
import type { SetupState } from '../../../shared/types'

export const AskModelSetup = createContext<SetupState | undefined>(undefined)

export function AskModelLabel() {
  const setup = useContext(AskModelSetup)
  if (!setup) return null
  const model = setup.askModel
  if (!model) {
    const wait = setup.notesError ? t("The notes model couldn't download.") : t('Waiting for Yogurt AI to download')
    return <span className="ask-model-label" data-testid="ask-model" title={setup.notesError || wait}><span>{wait}</span></span>
  }
  const state = model.loaded ? t('Loaded on this device') : t('Ready on this device')
  return <span className="ask-model-label" data-testid="ask-model" title={`${state}\n${model.fileName}`}>
    <bdi>{model.name}</bdi>{' '}<bdi className="ask-model-quant">{model.quant}</bdi>
    <span className="sr-only">{` · ${state} · ${model.fileName}`}</span>
  </span>
}
