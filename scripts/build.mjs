#!/usr/bin/env node

import { execSync } from 'node:child_process'
import { renameSync, existsSync, unlinkSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const exePath = resolve(root, 'src-tauri', 'target', 'release', 'opencodeui.exe')
const exeBackupPath = resolve(root, 'src-tauri', 'target', 'release', 'opencodeui.exe.running')

function getRunningPID() {
  try {
    const output = execSync(
      'powershell -NoProfile -Command "Get-Process opencodeui -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"',
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim()
    return output ? parseInt(output, 10) : null
  } catch {
    return null
  }
}

function main() {
  const pid = getRunningPID()
  let renamed = false

  if (pid) {
    console.log(`  ○ Found running opencodeui.exe (PID: ${pid})`)
    console.log(`  ○ Renaming opencodeui.exe → opencodeui.exe.running...`)
    if (existsSync(exePath)) {
      renameSync(exePath, exeBackupPath)
      renamed = true
      console.log('  ✓ Renamed')
    }
  } else {
    console.log('  ○ No running opencodeui.exe found')
  }

  try {
    console.log('\n  ◆ Running tauri build...\n')
    execSync('npx tauri build', { cwd: root, stdio: 'inherit' })
    console.log('\n  ✓ tauri build succeeded')

    if (pid) {
      console.log(`  ○ Killing old process (PID: ${pid})...`)
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' })
        console.log('  ✓ Killed')
      } catch {
        console.log('  ○ Old process already exited')
      }

      if (existsSync(exeBackupPath)) {
        unlinkSync(exeBackupPath)
        console.log('  ✓ Removed opencodeui.exe.running')
      }
    }

    console.log('\n  ✓ Done. New opencodeui.exe is ready.')
  } catch {
    console.error('\n  ✗ tauri build failed')

    if (renamed && existsSync(exeBackupPath)) {
      console.log('  ○ Restoring opencodeui.exe.running → opencodeui.exe...')
      renameSync(exeBackupPath, exePath)
      console.log('  ✓ Restored')
    }

    process.exit(1)
  }
}

main()