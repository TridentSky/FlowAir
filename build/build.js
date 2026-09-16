const { execFileSync, spawn } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const path = require('path')

const rootDir = path.resolve(__dirname, '..')
const frontendDir = path.join(rootDir, 'frontend')
const backendDir = path.join(rootDir, 'backend')
const stagingDir = path.join(rootDir, '.build')
const installerDir = path.join(rootDir, 'Installer')
const ffprobePath = path.join(rootDir, 'ffmpeg', 'bin', 'ffprobe.exe')
const ffmpegPath = path.join(rootDir, 'ffmpeg', 'bin', 'ffmpeg.exe')
const iconPath = path.join(__dirname, 'icon.ico')
const venvPython = path.join(backendDir, 'venv', 'Scripts', 'python.exe')
const taskkillPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe')
const pyinstallerVersion = '6.22.3'
const minimumPython = [3, 11]
const artifactName = 'FlowAir-Setup.exe'
const installerResources = ['icon.ico', 'installer.nsh', 'installerHeader.bmp', 'installerSidebar.bmp']
const packagedAppEntries = [
  'FlowAir.exe',
  path.join('resources', 'backend', 'flowair-backend.exe'),
  path.join('resources', 'ffmpeg', 'ffprobe.exe')
]
const packagedAppBundles = [path.join('resources', 'app.asar'), path.join('resources', 'app', 'package.json')]
const version = JSON.parse(fs.readFileSync(path.join(frontendDir, 'package.json'), 'utf-8')).version

const log = (message) => process.stdout.write(`\n[FlowAir build] ${message}\n`)
const warn = (message) => process.stderr.write(`\n[FlowAir build] ${'='.repeat(70)}\n[FlowAir build] WARNING: ${message}\n[FlowAir build] ${'='.repeat(70)}\n`)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const removeDir = (target) => fs.rmSync(target, { recursive: true, force: true })

function run(command, args, cwd, env = {}) {
  execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } })
}

function guardRequest(request, resolve, deadlineMs, onFailure) {
  let settled = false
  const timer = setTimeout(() => {
    request.destroy()
    complete(onFailure(new Error('The playout engine did not answer in time')))
  }, deadlineMs)
  timer.unref()

  function complete(value) {
    if (settled) {
      return
    }
    settled = true
    clearTimeout(timer)
    resolve(value)
  }

  function fail(error) {
    complete(onFailure(error))
  }

  request.on('timeout', () => request.destroy())
  request.on('error', fail)
  return { complete, fail, watch: response => { response.on('aborted', () => fail(new Error('The response was aborted'))); response.on('error', fail) } }
}

function probeEngine() {
  return new Promise(resolve => {
    const request = http.get({ host: '127.0.0.1', port: 8000, path: '/', timeout: 1000 })
    const gate = guardRequest(request, resolve, 5000, error => (error && error.code === 'ECONNREFUSED' ? null : {}))
    request.on('response', response => {
      gate.watch(response)
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { body += chunk })
      response.on('end', () => {
        try {
          gate.complete(JSON.parse(body))
        } catch (error) {
          gate.complete({})
        }
      })
    })
  })
}

function readResponse(request, deadlineMs = 25000) {
  return new Promise(resolve => {
    const gate = guardRequest(request, resolve, deadlineMs, error => ({ status: null, body: error.message }))
    request.on('response', response => {
      gate.watch(response)
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { body += chunk })
      response.on('end', () => gate.complete({ status: response.statusCode, body }))
    })
  })
}

function requestJson(method, route, payload) {
  const body = JSON.stringify(payload === undefined ? {} : payload)
  const request = http.request({
    host: '127.0.0.1',
    port: 8000,
    path: route,
    method,
    timeout: 20000,
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  })
  const result = readResponse(request)
  if (method !== 'GET') {
    request.write(body)
  }
  request.end()
  return result
}

function requestRange(route, range) {
  return new Promise(resolve => {
    const request = http.get({ host: '127.0.0.1', port: 8000, path: route, timeout: 20000, headers: { Range: range } })
    const gate = guardRequest(request, resolve, 25000, error => ({ status: null, contentRange: error.message, received: 0 }))
    request.on('response', response => {
      gate.watch(response)
      let received = 0
      response.on('data', chunk => { received += chunk.length })
      response.on('end', () => gate.complete({ status: response.statusCode, contentRange: response.headers['content-range'] || '', received }))
    })
  })
}

function requestUpgrade(route) {
  return new Promise(resolve => {
    const request = http.request({
      host: '127.0.0.1',
      port: 8000,
      path: route,
      timeout: 20000,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64')
      }
    })
    request.on('upgrade', (response, socket) => {
      socket.destroy()
      resolve({ status: response.statusCode, body: '' })
    })
    readResponse(request).then(resolve)
    request.end()
  })
}

function writeVersionFile(target) {
  const [major, minor, patch] = version.split('.').map(part => parseInt(part, 10) || 0)
  const content = `VSVersionInfo(
  ffi=FixedFileInfo(filevers=(${major}, ${minor}, ${patch}, 0), prodvers=(${major}, ${minor}, ${patch}, 0), mask=0x3f, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[
    StringFileInfo([StringTable('040904B0', [
      StringStruct('CompanyName', 'TridentSky'),
      StringStruct('FileDescription', 'FlowAir Playout Engine'),
      StringStruct('FileVersion', '${version}'),
      StringStruct('InternalName', 'flowair-backend'),
      StringStruct('LegalCopyright', 'Copyright (c) 2026 TridentSky'),
      StringStruct('OriginalFilename', 'flowair-backend.exe'),
      StringStruct('ProductName', 'FlowAir'),
      StringStruct('ProductVersion', '${version}')])]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
`
  fs.writeFileSync(target, content, 'utf-8')
}

function warnOnOldPython() {
  let config = ''
  try {
    config = fs.readFileSync(path.join(backendDir, 'venv', 'pyvenv.cfg'), 'utf-8')
  } catch (error) {
    return
  }
  const found = /^\s*version(?:_info)?\s*=\s*(\d+)\.(\d+)/m.exec(config)
  if (found === null) {
    return
  }
  const major = parseInt(found[1], 10)
  const minor = parseInt(found[2], 10)
  if (major < minimumPython[0] || (major === minimumPython[0] && minor < minimumPython[1])) {
    warn(`The playout engine is being packaged with Python ${major}.${minor}. FlowAir is released with Python ${minimumPython.join('.')} or newer, so this installer may not match the published one. Delete backend/venv and build again with a newer Python.`)
  }
}

function ensureBackendEnvironment() {
  if (!fs.existsSync(venvPython)) {
    log('Creating Python virtual environment')
    run('python', ['-m', 'venv', 'venv'], backendDir)
  }
  warnOnOldPython()
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
    '--noupx',
    '--disable-windowed-traceback',
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
  verifyRuntimeLibraries(path.dirname(executable))
  return executable
}

function verifyRuntimeLibraries(engineDir) {
  const internalDir = path.join(engineDir, '_internal')
  if (!fs.existsSync(internalDir)) {
    throw new Error('The packaged playout engine has no _internal folder')
  }
  const files = fs.readdirSync(internalDir).map(name => name.toLowerCase())
  if (!files.some(name => /^python3\d+\.dll$/.test(name))) {
    throw new Error('The packaged playout engine is missing the Python runtime library (python3XX.dll)')
  }
  if (!files.includes('vcruntime140.dll')) {
    throw new Error('The packaged playout engine is missing the C runtime library (vcruntime140.dll)')
  }
}

const probeClipEncoders = [
  ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'],
  ['-c:v', 'libopenh264', '-pix_fmt', 'yuv420p'],
  ['-c:v', 'mpeg4', '-pix_fmt', 'yuv420p']
]

function createProbeClip(targetDir) {
  if (!fs.existsSync(ffmpegPath)) {
    warn(`ffmpeg.exe was not found at ${ffmpegPath}, so the media pipeline of the packaged playout engine was NOT verified. Only ffprobe.exe is shipped, so the installer is still valid, but ffprobe and range streaming were not exercised.`)
    return null
  }

  fs.mkdirSync(targetDir, { recursive: true })
  const clip = path.join(targetDir, 'flowair-build-check.mp4')
  const failures = []

  for (const encoder of probeClipEncoders) {
    try {
      fs.rmSync(clip, { force: true })
      execFileSync(ffmpegPath, [
        '-hide_banner',
        '-loglevel', 'error',
        '-y',
        '-f', 'lavfi',
        '-i', 'color=c=black:s=320x240:r=25:d=1',
        ...encoder,
        clip
      ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    } catch (error) {
      failures.push(`${encoder[1]} - ${error.stderr ? error.stderr.toString().trim() : error.message}`)
      continue
    }
    if (fs.existsSync(clip) && fs.statSync(clip).size >= 2048) {
      return clip
    }
    failures.push(`${encoder[1]} - the clip was empty or too small to exercise a range request`)
  }

  warn(`No encoder in this ffmpeg build could create the build check clip, so the media pipeline of the packaged playout engine was NOT verified: ${failures.join(' | ')}`)
  return null
}

async function checkWorkerThreads() {
  const response = await requestJson('GET', '/obs/status')
  if (response.status !== 200) {
    throw new Error(`The packaged playout engine is incomplete (worker threads returned ${response.status}): ${response.body}`)
  }
}

async function checkWebSocketUpgrade() {
  const response = await requestUpgrade('/ws')
  if (response.status !== 101) {
    throw new Error(`The packaged playout engine cannot accept websocket connections (/ws returned ${response.status}): ${response.body}`)
  }
}

async function checkOBSDependencies() {
  const settings = await requestJson('POST', '/obs/settings', { enabled: true, host: '127.0.0.1', port: 45599, password: '' })
  if (settings.status !== 200) {
    throw new Error(`The packaged playout engine rejected the OBS settings (${settings.status}): ${settings.body}`)
  }
  const connect = await requestJson('POST', '/obs/connect')
  if (connect.status !== 200) {
    throw new Error(`The packaged playout engine failed the OBS connection check (${connect.status}): ${connect.body}`)
  }
  if (/no module named|modulenotfounderror|importerror|dll load failed/i.test(connect.body)) {
    throw new Error(`The packaged playout engine is missing its OBS dependencies: ${connect.body}`)
  }
}

async function checkMediaPipeline(clip) {
  const added = await requestJson('POST', '/playlist/add', { filepath: clip })
  if (added.status !== 200) {
    throw new Error(`The packaged playout engine refused the build check clip (${added.status}): ${added.body}`)
  }

  let itemId = null
  try {
    itemId = JSON.parse(added.body).item.id
  } catch (error) {
    throw new Error(`The packaged playout engine returned an unreadable playlist item: ${added.body}`)
  }

  let validated = null
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    const listed = await requestJson('GET', '/playlist')
    if (listed.status !== 200) {
      throw new Error(`The packaged playout engine could not return its playlist (${listed.status}): ${listed.body}`)
    }
    let item = null
    try {
      item = JSON.parse(listed.body).playlist.find(entry => entry.id === itemId)
    } catch (error) {
      throw new Error(`The packaged playout engine returned an unreadable playlist: ${listed.body}`)
    }
    if (item && item.status !== 'validating') {
      validated = item
      break
    }
    await delay(250)
  }

  if (validated === null) {
    throw new Error('The packaged playout engine never finished validating the build check clip')
  }
  if (validated.status !== 'normal' || !(validated.duration > 0)) {
    throw new Error(`ffprobe does not work inside the packaged playout engine (status ${validated.status}, duration ${validated.duration})`)
  }

  const ranged = await requestRange(`/stream/${itemId}`, 'bytes=0-1023')
  if (ranged.status !== 206 || ranged.received !== 1024 || !ranged.contentRange.startsWith('bytes 0-1023/')) {
    throw new Error(`The packaged playout engine failed the range request check (status ${ranged.status}, ${ranged.received} bytes, content-range "${ranged.contentRange}")`)
  }
}

async function verifyEngine(executable) {
  if (await probeEngine() !== null) {
    throw new Error('Port 8000 is in use. Close FlowAir and any program using port 8000 before building.')
  }

  log('Verifying packaged playout engine')
  const checkDir = path.join(stagingDir, 'check')
  removeDir(checkDir)
  const clip = createProbeClip(checkDir)
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
        await checkWorkerThreads()
        await checkWebSocketUpgrade()
        await checkOBSDependencies()
        if (clip !== null) {
          await checkMediaPipeline(clip)
        }
        return
      }
      if (child.exitCode !== null) break
      await delay(500)
    }
    throw new Error('The packaged playout engine did not start')
  } finally {
    try {
      execFileSync(taskkillPath, ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    } catch (error) {
    }
    const releaseDeadline = Date.now() + 10000
    while (Date.now() < releaseDeadline && await probeEngine() !== null) {
      await delay(300)
    }
    try {
      removeDir(checkDir)
    } catch (error) {
    }
  }
}

function buildInterface() {
  log('Building interface')
  removeDir(path.join(frontendDir, 'dist'))
  run(process.execPath, [path.join(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], frontendDir)
}

function verifyPackagedApp(outputDir) {
  const candidates = fs.readdirSync(outputDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.endsWith('unpacked'))
    .map(entry => path.join(outputDir, entry.name))
  if (candidates.length !== 1) {
    throw new Error('The packaged application folder was not produced')
  }
  const missing = packagedAppEntries.filter(entry => !fs.existsSync(path.join(candidates[0], entry)))
  if (missing.length !== 0) {
    throw new Error(`The installer would ship an incomplete application (missing ${missing.join(', ')})`)
  }
  if (!packagedAppBundles.some(entry => fs.existsSync(path.join(candidates[0], entry)))) {
    throw new Error('The installer would ship without the FlowAir application bundle')
  }
}

function packageInstaller() {
  log('Creating Windows installer')
  const outputDir = path.join(stagingDir, 'electron')
  removeDir(outputDir)
  run(process.execPath, [path.join(frontendDir, 'node_modules', 'electron-builder', 'cli.js'), '--win', 'nsis', '--x64', '--publish', 'never'], frontendDir)

  verifyPackagedApp(outputDir)

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
  const missingResources = installerResources.filter(name => !fs.existsSync(path.join(__dirname, name)))
  if (missingResources.length !== 0) {
    throw new Error(`These installer resources are missing from the build folder: ${missingResources.join(', ')}`)
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
    try {
      removeDir(path.join(frontendDir, 'dist'))
    } catch (error) {
    }
  }
}

main().catch(error => {
  process.stderr.write(`\n[FlowAir build] FAILED: ${error.message}\n`)
  process.exit(1)
})
