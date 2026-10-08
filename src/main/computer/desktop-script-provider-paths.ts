import { existsSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

function applicationResourcesPath(entryPath: string | undefined): string | null {
  if (!entryPath) {
    return null
  }

  let current = resolve(entryPath)
  while (true) {
    if (
      current.split(sep).at(-1) === 'resources' &&
      (existsSync(join(current, 'app.asar')) || existsSync(join(current, 'app.asar.unpacked')))
    ) {
      return current
    }

    const parent = dirname(current)
    if (parent === current) {
      return null
    }
    current = parent
  }
}

export type DesktopScriptPlatform = 'linux' | 'windows'

export function desktopScriptPlatform(): DesktopScriptPlatform | null {
  if (process.platform === 'linux') {
    return 'linux'
  }
  if (process.platform === 'win32') {
    return 'windows'
  }
  return null
}

export function resolveDesktopScriptProviderPath(
  platform = desktopScriptPlatform()
): string | null {
  const override = process.env.ORCA_COMPUTER_DESKTOP_SCRIPT_PROVIDER_PATH
  if (override && existsSync(override)) {
    return override
  }
  if (!platform) {
    return null
  }

  const filename = platform === 'windows' ? 'runtime.ps1' : 'runtime.py'
  const directory = platform === 'windows' ? 'computer-use-windows' : 'computer-use-linux'
  const sourceDirectory =
    platform === 'windows' ? 'native/computer-use-windows' : 'native/computer-use-linux'
  const appResources = applicationResourcesPath(process.argv[1])
  const packaged = [process.resourcesPath, appResources]
    .filter((path): path is string => Boolean(path))
    .map((path) => join(path, directory, filename))
  const dev = [
    join(process.cwd(), sourceDirectory, filename),
    resolve(__dirname, '../../', sourceDirectory, filename)
  ]
  const candidates = packaged.length > 0 ? [...packaged, ...dev] : dev

  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null
}
