import { browserManager } from '../browser/browser-manager'

// Why: with several main windows alive, every browser-page command must prove the
// sending renderer is the one that registered that page, not just a trusted window.
export function ownsBrowserPage(sender: Electron.WebContents, browserPageId: string): boolean {
  return browserManager.getRendererWebContentsId(browserPageId) === sender.id
}
