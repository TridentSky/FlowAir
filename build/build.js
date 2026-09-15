const { execFileSync, spawn } = require('child_process')
const fs = require('fs')
const http = require('http')
const path = require('path')

const rootDir = path.resolve(__dirname, '..')
const frontendDir = path.join(rootDir, 'frontend')
const backendDir = path.join(rootDir, 'backend')
const stagingDir = path.join(rootDir, '.build')
const installerDir = path.join(rootDir, 'Installer')
const ffprobePath = path.join(rootDir, 'ffmpeg', 'bin', 'ffprobe.exe')
const iconPath = path.join(__dirname, 'icon.ico')
const venvPython = path.join(backendDir, 'venv', 'Scripts', 'python.exe')
const pyinstallerVersion = '6.22.3'
const artifactName = 'FlowAir-Setup.exe'
const version = JSON.parse(fs.readFileSync(path.join(frontendDir, 'package.json'), 'utf-8')).version

const log = (message) => process.stdout.write(`\n[FlowAir build] ${message}\n`)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const removeDir = (target) => fs.rmSync(target, { recursive: true, force: true })

function run(command, args, cwd, env = {}) {
  execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } })
}

function probeEngine() {
  return new Promise(resolve => {
    const request = http.get({ host: '127.0.0.1', port: 8000, path: '/', timeout: 1000 }, response => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { body += chunk })
      response.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (error) {
          resolve({})
        }
      })
    })
    request.on('timeout', () => request.destroy())
    request.on('error', error => resolve(error.code === 'ECONNREFUSED' ? null : {}))
  })
}

function requestStatus(route) {
  return new Promise(resolve => {
    const request = http.get({ host: '127.0.0.1', port: 8000, path: route, timeout: 5000 }, response => {
      response.resume()
      resolve(response.statusCode)
    })
    request.on('timeout', () => request.destroy())
    request.on('error', () => resolve(null))
  })
}

function writeVersionFile(target) {
  const [major, minor, patch] = version.split('.').map(part => parseInt(part, 10) || 0)
  const content = `VSVersionInfo(
  ffi=FixedFileInfo(filevers=(${major}, ${minor}, ${patch}, 0), prodvers=(${major}, ${minor}, ${patch}, 0), mask=0x3f, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[
    StringFileInfo([StringTable('040904B0', [
      StringStruct('CompanyName', 'Trident Sky'),
      StringStruct('FileDescription', 'FlowAir Playout Engine'),
      StringStruct('FileVersion', '${version}'),
      StringStruct('InternalName', 'flowair-backend'),
      StringStruct('LegalCopyright', 'Copyright (c) 2026 Trident Sky'),
      StringStruct('OriginalFilename', 'flowair-backend.exe'),
      StringStruct('ProductName', 'FlowAir'),
      StringStruct('ProductVersion', '${version}')])]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
`
  fs.writeFileSync(target, content, 'utf-8')
}

function ensureBackendEnvironment() {
  if (!fs.existsSync(venvPython)) {
    log('Creating Python virtual environment')
    run('python', ['-m', 'venv', 'venv'], backendDir)
  }
  log('Installing playout engine dependencies')
  run(venvPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '--quiet', '-r', 'requirements.txt', `pyinstaller==${pyinstallerVersion}`], backendDir)
}

function buildEngine() {
  const workDir = path.join(stagingDir, 'pyinstaller')
  const distDir = path.join(stagingDir, 'backend')
  removeDir(workDir)
  removeDir(distDir)
  fs.mkdirSync(workDir, { recursive: true })

  const versionFile = path.join(workDir, 'version-info.txt')
  writeVersionFile(versionFile)

  log('Packaging playout engine')
  run(venvPython, [
    '-m', 'PyInstaller', 'main.py',
    '--name', 'flowair-backend',
    '--onedir',
    '--windowed',
    '--noconfirm',
    '--clean',
    '--distpath', distDir,
    '--workpath', workDir,
    '--specpath', workDir,
    '--icon', iconPath,
    '--version-file', versionFile,
    '--collect-submodules', 'uvicorn',
    '--collect-submodules', 'websockets',
    '--collect-submodules', 'ctypes',
    '--collect-submodules', 'anyio',
    '--exclude-module', 'tkinter'
  ], backendDir)

  const executable = path.join(distDir, 'flowair-backend', 'flowair-backend.exe')
  if (!fs.existsSync(executable)) {
    throw new Error('The playout engine executable was not produced')
  }
  return executable
}

async function verifyEngine(executable) {
  if (await probeEngine() !== null) {
    throw new Error('Port 8000 is in use. Close FlowAir and any program using port 8000 before building.')
  }

  log('Verifying packaged playout engine')
  const child = spawn(executable, [], {
    cwd: path.dirname(executable),
    env: { ...process.env, FLOWAIR_FFMPEG_DIR: path.dirname(ffprobePath), FLOWAIR_INSTANCE: 'build-check', FLOWAIR_PARENT_PID: String(process.pid) },
    windowsHide: true,
    stdio: 'ignore'
  })

  try {
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) {
      const info = await probeEngine()
      if (info && info.instance === 'build-check') {
        const threadpoolStatus = await requestStatus('/obs/status')
        if (threadpoolStatus !== 200) {
          throw new Error(`The packaged playout engine is incomplete (worker threads returned ${threadpoolStatus})`)
        }
        return
      }
      if (child.exitCode !== null) break
      await delay(500)
    }
    throw new Error('The packaged playout engine did not start')
  } finally {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    } catch (error) {
    }
    const releaseDeadline = Date.now() + 10000
    while (Date.now() < releaseDeadline && await probeEngine() !== null) {
      await delay(300)
    }
  }
}

function buildInterface() {
  log('Building interface')
  removeDir(path.join(frontendDir, 'dist'))
  run(process.execPath, [path.join(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], frontendDir)
}

function packageInstaller() {
  log('Creating Windows installer')
  const outputDir = path.join(stagingDir, 'electron')
  removeDir(outputDir)
  run(process.execPath, [path.join(frontendDir, 'node_modules', 'electron-builder', 'cli.js'), '--win', 'nsis', '--x64', '--publish', 'never'], frontendDir)

  const artifact = path.join(outputDir, artifactName)
  if (!fs.existsSync(artifact)) {
    throw new Error('The installer was not produced')
  }

  removeDir(installerDir)
  fs.mkdirSync(installerDir, { recursive: true })
  const target = path.join(installerDir, artifactName)
  fs.copyFileSync(artifact, target)
  return target
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('The FlowAir installer must be built on Windows')
  }
  if (!fs.existsSync(ffprobePath)) {
    throw new Error(`ffprobe.exe was not found at ${ffprobePath}`)
  }
  if (!fs.existsSync(path.join(frontendDir, 'node_modules', 'electron-builder'))) {
    throw new Error('Run "npm install" inside the frontend folder first')
  }

  ensureBackendEnvironment()
  const engine = buildEngine()
  await verifyEngine(engine)
  buildInterface()

  try {
    const installer = packageInstaller()
    const sizeMb = (fs.statSync(installer).size / 1048576).toFixed(1)
    log(`Done: ${installer} (${sizeMb} MB) - FlowAir v${version}`)
  } finally {
    removeDir(path.join(frontendDir, 'dist'))
  }
}

main().catch(error => {
  process.stderr.write(`\n[FlowAir build] FAILED: ${error.message}\n`)
  process.exit(1)
})
