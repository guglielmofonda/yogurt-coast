import { createContext, useContext, useRef } from 'react'
import { Menu } from '@base-ui/react/menu'
import { Check, ChevronDown, Plus } from './Icons'
import { toasts } from './TrashToast'
import { t } from '../../../shared/i18n'
import type { AskModelResult, SetupState } from '../../../shared/types'

export const AskModelSetup = createContext<SetupState | undefined>(undefined)

export function AskModelLabel({ disabled = false }: { disabled?: boolean }) {
  const setup = useContext(AskModelSetup)
  const trigger = useRef<HTMLButtonElement>(null)
  if (!setup) return null
  const model = setup.askModel
  const state = model?.loaded ? t('Loaded on this device') : t('Ready on this device')
  const wait = setup.notesError ? t("The notes model couldn't download.") : t('Waiting for Yogurt AI to download')
  const title = model ? `${state}\n${model.fileName}` : setup.notesError || wait
  const choose = async (request: Promise<AskModelResult>) => {
    const result = await request.catch(() => 'failed')
    if (result === 'failed' || result === 'recording' || result === 'busy') {
      toasts.add({ title: result === 'failed' ? t('Couldn’t load this model. Choose a GGUF model for text generation.')
        : result === 'recording' ? t('Available after recording') : t('Loading…') })
    }
  }
  return <Menu.Root modal={false}>
    <Menu.Trigger ref={trigger} type="button" className="ask-model-label" data-testid="ask-model" title={title}
      disabled={disabled || setup.askModelChanging} aria-busy={setup.askModelChanging}
      aria-label={`${t('Choose an Ask model')} · ${model ? `${model.name} ${model.quant}` : wait}`}>
      {setup.askModelChanging ? <span role="status">{t('Loading…')}</span> : model
        ? <><bdi>{model.name}</bdi>{' '}<bdi className="ask-model-quant">{model.quant}</bdi></> : <span>{wait}</span>}
      <ChevronDown size={12} aria-hidden="true" />
    </Menu.Trigger>
    <Menu.Portal container={trigger.current?.closest('dialog') ?? undefined}>
      <Menu.Positioner side="top" align="end" sideOffset={7} className="ask-menu-positioner">
        <Menu.Popup className="menu-entry ask-actions-menu ask-model-menu" aria-label={t('Choose an Ask model')}
          onKeyDown={e => { if (e.key === 'Escape') e.stopPropagation() }}>
          <Menu.RadioGroup value={setup.askModelChoice ?? 'auto'} onValueChange={id => void choose(window.yogurt.setup.chooseAskModel(id === 'auto' ? null : id))}>
            <Menu.RadioItem value="auto" disabled={!setup.notesModelReady}><span>{t('Auto')}</span><Menu.RadioItemIndicator><Check size={14} /></Menu.RadioItemIndicator></Menu.RadioItem>
            {setup.askModels?.map(m => <Menu.RadioItem key={m.id} value={m.id} title={m.fileName}>
              <span><bdi>{m.name}</bdi> <small>{m.quant}</small></span><Menu.RadioItemIndicator><Check size={14} /></Menu.RadioItemIndicator>
            </Menu.RadioItem>)}
          </Menu.RadioGroup>
          <Menu.Separator className="recording-menu-separator" />
          <Menu.Item onClick={() => void choose(window.yogurt.setup.addAskModel())}><Plus size={14} />{t('Add local GGUF…')}</Menu.Item>
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  </Menu.Root>
}
