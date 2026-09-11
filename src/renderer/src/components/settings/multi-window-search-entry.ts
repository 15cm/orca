import type { SettingsSearchEntry } from './settings-search'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'

export const MULTI_WINDOW_SEARCH_TITLE_KEY =
  'auto.components.settings.experimental.search.818dac284f'

export function getMultiWindowSearchEntry(): SettingsSearchEntry {
  return {
    title: translate(MULTI_WINDOW_SEARCH_TITLE_KEY, 'Multi-window'),
    description: translate(
      'auto.components.settings.experimental.search.7b91eb5445',
      'Enable File > New Window for multiple monitor workflows. Requires restart.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.0d24759f14',
        'experimental'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.80f98894e2',
        'window'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.453f52ca4f',
        'windows'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.0769e2ac8b',
        'multi-window'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.a546df85b7',
        'multiple windows'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.065be2a752',
        'new window'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.f45e79f16d',
        'monitor'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.d7c9a0880c',
        'monitors'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.e6798b719e',
        'display'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.991fc15475',
        'displays'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.834ea7f3aa',
        'restart'
      )
    ]
  }
}
