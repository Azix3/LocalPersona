import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { ProgressInfo, UpdateInfo } from 'electron-updater';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AppStore,
  CharacterProfile,
  ChatMessage,
  ChatPayload,
  ChatSession,
  LibraryModel,
  LocalModel,
  OllamaStatus,
  PromptMode,
  PullProgress,
  UpdatePackageKind,
  UpdateStatus
} from '../src/types';

const OLLAMA_BASE_URL = process.env.OLLAMA_API_BASE ?? 'http://127.0.0.1:11434';
const GITHUB_LATEST_RELEASE_URL = 'https://api.github.com/repos/Azix3/LocalPersona/releases/latest';
const PRODUCT_NAME = 'LocalPersona';
const STORE_VERSION = 1;
const HIDDEN_ROLEPLAY_PROMPT = [
  'You are a character roleplay chat model.',
  'The character card below defines your identity, personality, history, speech style, relationship to the user, scenario, boundaries, and any special rules.',
  'Fully become that character. Respond as the character would respond in the current moment, not as a generic AI assistant and not as a narrator explaining the character.',
  'The user is the person writing user messages. You are only the character from the character card. Never write as the user, never continue the user\'s first-person narration, and never describe actions from the user\'s point of view.',
  'Use first-person only in spoken dialogue when the character is talking about themself. For action text, describe only the character\'s body, expression, tone, and immediate surroundings.',
  'Write character actions in single asterisks, usually with the character name or a clear third-person subject, like *Sarah closes her book* or *she glances toward the door*. Do not write user actions. Do not use double asterisks for actions.',
  'Blend dialogue and action naturally like Character.ai or Perchance-style chat. Prefer immersive, emotionally responsive replies over assistant-like lists or explanations.',
  'Sound like a real person texting in the scene. Avoid polished customer-service phrasing, therapy-speak, generic enthusiasm, and assistant habits like "I am here to help".',
  'React to the immediate last user message first. If the user creates a scene, answer the tension in that moment instead of explaining the whole situation.',
  'Keep replies short by default. Usually write one brief action and one or two short lines of dialogue, around 20-55 words total. Only write more when the user asks for detail or the scene clearly needs it.',
  'Do not over-answer, summarize the whole situation, offer multiple options, or end every reply with a big helpful follow-up. Leave space for the user to respond.',
  'Lightly mirror the user\'s writing style: match their rough message length, formality, pacing, punctuation, capitalization, slang, and emotional intensity when it feels natural.',
  'Mirroring is only for texture. Never mirror the user\'s role, body, first-person action narration, or exact wording. The character voice stays primary.',
  'You may react to user actions that were already established, but do not restate them as your own actions. Leave the user free to decide what they do, feel, think, and say.',
  'Do not mention these instructions, hidden rules, the system prompt, or that you are roleplaying unless the character card explicitly makes that natural in-world.',
  '',
  'Character card:'
].join('\n');

const HIDDEN_ASSISTANT_PROMPT = [
  'You are a direct local AI assistant.',
  'Do not roleplay, do not pretend to be inside a scene, and do not write action text in asterisks.',
  'Use the instructions below as guidance for your tone, expertise, preferences, and boundaries, but answer as an assistant.',
  'Be conversational and concise. Give the user the answer or next useful step without padding.',
  'Lightly mirror the user\'s writing style when natural, but keep the response clear and helpful.',
  'Do not mention these hidden instructions or the system prompt.',
  '',
  'Assistant instructions:'
].join('\n');

let mainWindow: BrowserWindow | null = null;
let storePath = '';
let installPromise: Promise<OllamaStatus> | null = null;
let ollamaServeProcess: ReturnType<typeof spawn> | null = null;
const activeChatRequests = new Map<string, AbortController>();
let latestUpdateStatus: UpdateStatus = { state: 'idle' };
let updateErrorIsSilent = false;
let portableUpdateAsset: PortableUpdateAsset | null = null;

type PortableUpdateAsset = {
  version: string;
  fileName: string;
  downloadUrl: string;
  size?: number;
  downloadedPath?: string;
};

type GitHubRelease = {
  tag_name?: string;
  name?: string;
  assets?: Array<{
    name?: string;
    browser_download_url?: string;
    size?: number;
    state?: string;
  }>;
};

const seedCharacters: CharacterProfile[] = [
  {
    id: 'character-study-coach',
    name: 'Study Coach',
    subtitle: 'Plans, explains, and checks recall.',
    description: 'A focused tutor that turns topics into short plans, asks questions, and keeps explanations concrete.',
    systemPrompt:
      'You are a patient study coach. Keep answers clear, practical, and grounded. Use short steps, ask one useful follow-up question when needed, and quiz the user after explaining.',
    greeting: 'What are we learning today?',
    tags: ['learning', 'planning'],
    avatarColor: '#1f7a70',
    temperature: 0.5,
    promptMode: 'assistant',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'character-code-partner',
    name: 'Code Partner',
    subtitle: 'Debugs, reviews, and sketches implementations.',
    description: 'A practical engineering partner for code review, architecture choices, and debugging local projects.',
    systemPrompt:
      'You are a senior software engineer. Be direct, test assumptions, prefer small working changes, and explain tradeoffs in concrete terms.',
    greeting: 'Send me the bug, file, or feature you want to work through.',
    tags: ['coding', 'review'],
    avatarColor: '#5750c9',
    temperature: 0.35,
    promptMode: 'assistant',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'character-writing-room',
    name: 'Writing Room',
    subtitle: 'Drafts, edits, and keeps voice consistent.',
    description: 'A concise writing collaborator that helps with outlines, rewrites, tone, and structure.',
    systemPrompt:
      'You are an exacting writing editor. Preserve the user voice, remove filler, improve structure, and give options only when they clarify a real choice.',
    greeting: 'Paste a draft or tell me what we are writing.',
    tags: ['writing', 'editing'],
    avatarColor: '#c15a32',
    temperature: 0.7,
    promptMode: 'assistant',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

const fallbackLibraryModels: LibraryModel[] = [
  {
    name: 'llama3.2',
    description: "Meta's small general-purpose chat models.",
    tags: ['chat', 'tools'],
    variants: ['1b', '3b'],
    pulls: 'Popular'
  },
  {
    name: 'gemma3',
    description: 'A capable general model family with small and larger local sizes.',
    tags: ['chat', 'vision'],
    variants: ['1b', '4b', '12b', '27b'],
    pulls: 'Popular'
  },
  {
    name: 'qwen3',
    description: 'A multilingual reasoning-oriented model family with many local sizes.',
    tags: ['chat', 'thinking', 'tools'],
    variants: ['0.6b', '1.7b', '4b', '8b', '14b', '32b'],
    pulls: 'Popular'
  },
  {
    name: 'qwen3.5',
    description: 'A newer Qwen model family for multimodal and agentic workflows.',
    tags: ['chat', 'thinking', 'tools', 'vision'],
    variants: ['0.8b', '2b', '4b', '9b', '27b'],
    pulls: 'Popular'
  },
  {
    name: 'mistral',
    description: 'A fast 7B general-purpose model from Mistral AI.',
    tags: ['chat', 'tools'],
    variants: ['7b'],
    pulls: 'Popular'
  },
  {
    name: 'phi4',
    description: 'A compact Microsoft model for reasoning and general chat.',
    tags: ['chat'],
    variants: ['14b'],
    pulls: 'Popular'
  },
  {
    name: 'deepseek-r1',
    description: 'Open reasoning models for math, planning, and multi-step answers.',
    tags: ['thinking'],
    variants: ['1.5b', '7b', '8b', '14b', '32b'],
    pulls: 'Popular'
  },
  {
    name: 'qwen2.5-coder',
    description: 'Coding-focused Qwen models for local development tasks.',
    tags: ['coding', 'tools'],
    variants: ['0.5b', '1.5b', '3b', '7b', '14b', '32b'],
    pulls: 'Popular'
  },
  {
    name: 'llava',
    description: 'A local vision-language model for image understanding.',
    tags: ['vision'],
    variants: ['7b', '13b', '34b'],
    pulls: 'Popular'
  },
  {
    name: 'nomic-embed-text',
    description: 'A local text embedding model.',
    tags: ['embedding'],
    variants: [],
    pulls: 'Popular'
  }
];

function createWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#f6f7f9',
    title: 'LocalPersona',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.removeMenu();

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  storePath = path.join(app.getPath('userData'), 'library.json');
  configureAutoUpdater();
  registerIpc();
  createWindow();
  setTimeout(() => {
    void checkForUpdates(false);
  }, 4500);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

async function readStore(): Promise<AppStore> {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  let raw = '';
  try {
    raw = await fs.readFile(storePath, 'utf8');
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      throw error;
    }
    const store = normalizeStore({});
    await writeStore(store);
    return store;
  }

  try {
    return normalizeStore(JSON.parse(raw));
  } catch {
    const backupPath = `${storePath}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
    await fs.writeFile(backupPath, raw, 'utf8');
    const store = normalizeStore({});
    await writeStore(store);
    return store;
  }
}

async function writeStore(store: AppStore) {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, JSON.stringify(store, null, 2), 'utf8');
}

function normalizeStore(value: unknown): AppStore {
  const input = (value && typeof value === 'object' ? value : {}) as Partial<AppStore>;
  const legacyPromptMode = normalizePromptMode((input as { promptMode?: unknown }).promptMode);
  const sourceCharacters = Array.isArray(input.characters) && input.characters.length > 0 ? input.characters : seedCharacters;
  const characters = sourceCharacters.map((character) => normalizeCharacter(character, legacyPromptMode));
  const sessions = Array.isArray(input.sessions) ? input.sessions : [];
  const selectedCharacterId =
    input.selectedCharacterId && characters.some((character) => character.id === input.selectedCharacterId)
      ? input.selectedCharacterId
      : characters[0]?.id;

  return {
    version: STORE_VERSION,
    characters,
    sessions,
    selectedCharacterId,
    selectedModel: typeof input.selectedModel === 'string' ? input.selectedModel : undefined
  };
}

function sendToRenderer(channel: string, payload: unknown) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function registerIpc() {
  ipcMain.handle('store:load', async () => readStore());

  ipcMain.handle('characters:save', async (_event, input: Partial<CharacterProfile>) => {
    const store = await readStore();
    const now = new Date().toISOString();
    const cleanTags = Array.isArray(input.tags) ? input.tags.map(String).map((tag) => tag.trim()).filter(Boolean) : [];
    const character: CharacterProfile = {
      id: input.id || randomUUID(),
      name: String(input.name || 'New Character').trim(),
      subtitle: String(input.subtitle || '').trim(),
      description: String(input.description || '').trim(),
      systemPrompt: String(input.systemPrompt || '').trim(),
      greeting: String(input.greeting || '').trim(),
      tags: cleanTags,
      avatarColor: String(input.avatarColor || '#1f7a70'),
      temperature: clampNumber(input.temperature, 0, 2, 0.7),
      promptMode: normalizePromptMode(input.promptMode),
      createdAt: input.createdAt || now,
      updatedAt: now
    };

    const existingIndex = store.characters.findIndex((item) => item.id === character.id);
    if (existingIndex >= 0) {
      store.characters[existingIndex] = character;
    } else {
      store.characters.unshift(character);
      store.selectedCharacterId = character.id;
    }

    await writeStore(store);
    return store;
  });

  ipcMain.handle('characters:delete', async (_event, characterId: string) => {
    const store = await readStore();
    store.characters = store.characters.filter((character) => character.id !== characterId);
    store.sessions = store.sessions.filter((session) => session.characterId !== characterId);
    if (store.selectedCharacterId === characterId) {
      store.selectedCharacterId = store.characters[0]?.id;
    }
    await writeStore(store);
    return store;
  });

  ipcMain.handle('sessions:save', async (_event, session: ChatSession) => {
    const store = await readStore();
    const cleanSession: ChatSession = {
      ...session,
      id: session.id || randomUUID(),
      updatedAt: new Date().toISOString(),
      messages: Array.isArray(session.messages) ? session.messages : []
    };
    const existingIndex = store.sessions.findIndex((item) => item.id === cleanSession.id);
    if (existingIndex >= 0) {
      store.sessions[existingIndex] = cleanSession;
    } else {
      store.sessions.unshift(cleanSession);
    }
    store.selectedCharacterId = cleanSession.characterId;
    store.selectedModel = cleanSession.model || store.selectedModel;
    await writeStore(store);
    return store;
  });

  ipcMain.handle('sessions:delete', async (_event, sessionId: string) => {
    const store = await readStore();
    store.sessions = store.sessions.filter((session) => session.id !== sessionId);
    await writeStore(store);
    return store;
  });

  ipcMain.handle('settings:update', async (_event, settings: Partial<AppStore>) => {
    const store = await readStore();
    if (typeof settings.selectedCharacterId === 'string') {
      store.selectedCharacterId = settings.selectedCharacterId;
    }
    if (typeof settings.selectedModel === 'string') {
      store.selectedModel = settings.selectedModel;
    }
    await writeStore(store);
    return store;
  });

  ipcMain.handle('store:export', async () => {
    const store = await readStore();
    const result = await dialog.showSaveDialog({
      title: 'Export character workspace',
      defaultPath: `localpersona-workspace-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      app: 'LocalPersona',
      version: STORE_VERSION,
      characters: store.characters,
      sessions: store.sessions,
      selectedCharacterId: store.selectedCharacterId,
      selectedModel: store.selectedModel
    };
    await fs.writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { canceled: false, path: result.filePath };
  });

  ipcMain.handle('store:import', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import character workspace',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { skipped: true, importedCharacters: 0, importedSessions: 0 };
    }

    const raw = await fs.readFile(result.filePaths[0], 'utf8');
    const imported = JSON.parse(raw) as Partial<AppStore> & { promptMode?: PromptMode; autoScroll?: boolean };
    const characters = Array.isArray(imported.characters) ? imported.characters : [];
    const sessions = Array.isArray(imported.sessions) ? imported.sessions : [];
    const legacyPromptMode = normalizePromptMode(imported.promptMode);
    const store = await readStore();

    const characterMap = new Map(store.characters.map((character) => [character.id, character]));
    for (const character of characters) {
      if (character && character.id && character.name) {
        characterMap.set(character.id, normalizeCharacter(character, legacyPromptMode));
      }
    }

    const sessionMap = new Map(store.sessions.map((session) => [session.id, session]));
    for (const session of sessions) {
      if (session && session.id && session.characterId) {
        sessionMap.set(session.id, normalizeSession(session));
      }
    }

    store.characters = Array.from(characterMap.values());
    store.sessions = Array.from(sessionMap.values());
    if (typeof imported.selectedCharacterId === 'string') {
      store.selectedCharacterId = imported.selectedCharacterId;
    }
    if (typeof imported.selectedModel === 'string') {
      store.selectedModel = imported.selectedModel;
    }
    await writeStore(store);

    return {
      skipped: false,
      importedCharacters: characters.length,
      importedSessions: sessions.length,
      store
    };
  });

  ipcMain.handle('ollama:status', async () => getOllamaStatus());
  ipcMain.handle('ollama:ensure', async () => ensureOllama());
  ipcMain.handle('ollama:install', async () => installOllama());
  ipcMain.handle('models:local', async () => listLocalModels());
  ipcMain.handle('models:library', async () => getLibraryModels());
  ipcMain.handle('models:pull', async (_event, model: string) => pullModel(model));
  ipcMain.handle('chat:send', async (_event, payload: ChatPayload) => sendChat(payload));
  ipcMain.handle('chat:cancel', async (_event, requestId: string) => cancelChat(requestId));
  ipcMain.handle('updates:check', async () => checkForUpdates(true));
  ipcMain.handle('updates:download', async () => downloadUpdate());
  ipcMain.handle('updates:install', async () => installDownloadedUpdate());
  ipcMain.handle('updates:status', async () => latestUpdateStatus);
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (url.startsWith('https://ollama.com/') || url.startsWith('https://docs.ollama.com/')) {
      await shell.openExternal(url);
    }
  });
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  if (getUpdatePackageKind() !== 'installer') {
    publishUpdateStatus({ state: 'idle' });
    return;
  }

  autoUpdater.on('checking-for-update', () => {
    publishUpdateStatus({ state: 'checking', message: 'Checking for installer updates.' });
  });
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    updateErrorIsSilent = false;
    publishUpdateStatus({ state: 'available', version: info.version, message: `LocalPersona ${info.version} installer update is available.` });
  });
  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    updateErrorIsSilent = false;
    publishUpdateStatus({ state: 'not-available', version: info.version, message: 'LocalPersona installer is up to date.' });
  });
  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    publishUpdateStatus({
      state: 'downloading',
      percent: Math.round(progress.percent),
      message: `Downloading installer update ${Math.round(progress.percent)}%.`
    });
  });
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    updateErrorIsSilent = false;
    publishUpdateStatus({ state: 'downloaded', version: info.version, message: `LocalPersona ${info.version} installer update is ready to install.` });
  });
  autoUpdater.on('error', (error) => {
    if (updateErrorIsSilent) {
      updateErrorIsSilent = false;
      publishUpdateStatus({ state: 'idle' });
      return;
    }
    publishUpdateStatus({ state: 'error', message: stringifyError(error) });
  });

  publishUpdateStatus({ state: 'idle' });
}

async function checkForUpdates(showErrors: boolean): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    return publishUpdateStatus({ state: 'not-available', message: 'Updates are checked in the packaged app.' });
  }

  if (getUpdatePackageKind() === 'portable') {
    return checkForPortableUpdates(showErrors);
  }

  updateErrorIsSilent = !showErrors;
  try {
    await autoUpdater.checkForUpdates();
    updateErrorIsSilent = false;
  } catch (error) {
    updateErrorIsSilent = false;
    if (showErrors) {
      return publishUpdateStatus({ state: 'error', message: stringifyError(error) });
    }
    return publishUpdateStatus({ state: 'idle' });
  }
  return latestUpdateStatus;
}

async function downloadUpdate(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    return publishUpdateStatus({ state: 'not-available', message: 'Updates are downloaded in the packaged app.' });
  }

  if (getUpdatePackageKind() === 'portable') {
    return downloadPortableUpdate();
  }

  try {
    publishUpdateStatus({ state: 'downloading', percent: 0, message: 'Starting installer update download.' });
    await autoUpdater.downloadUpdate();
  } catch (error) {
    return publishUpdateStatus({ state: 'error', message: stringifyError(error) });
  }
  return latestUpdateStatus;
}

async function installDownloadedUpdate(): Promise<UpdateStatus> {
  if (getUpdatePackageKind() === 'portable') {
    return installPortableUpdate();
  }

  autoUpdater.quitAndInstall(false, true);
  return latestUpdateStatus;
}

function publishUpdateStatus(status: UpdateStatus) {
  latestUpdateStatus = withCurrentUpdateFields(status);
  sendToRenderer('updates:status', latestUpdateStatus);
  return latestUpdateStatus;
}

function withCurrentUpdateFields(status: UpdateStatus): UpdateStatus {
  return {
    ...status,
    packageKind: getUpdatePackageKind(),
    currentVersion: app.getVersion()
  };
}

async function checkForPortableUpdates(showErrors: boolean): Promise<UpdateStatus> {
  portableUpdateAsset = null;
  publishUpdateStatus({ state: 'checking', message: 'Checking for portable updates.' });

  try {
    const response = await fetchWithTimeout(
      GITHUB_LATEST_RELEASE_URL,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `${PRODUCT_NAME}/${app.getVersion()}`
        }
      },
      12000
    );
    if (!response.ok) {
      throw new Error(`GitHub update check failed: HTTP ${response.status}`);
    }

    const release = (await response.json()) as GitHubRelease;
    const asset = findPortableReleaseAsset(release);
    if (!asset?.browser_download_url || !asset.name) {
      return publishUpdateStatus({ state: 'not-available', message: 'No portable update asset was found in the latest release.' });
    }

    const latestVersion = normalizeVersion(versionFromPortableAssetName(asset.name) || release.tag_name || release.name);
    if (!latestVersion) {
      throw new Error('Could not read the latest portable update version.');
    }

    if (compareVersions(latestVersion, app.getVersion()) <= 0) {
      return publishUpdateStatus({ state: 'not-available', version: latestVersion, message: 'LocalPersona portable is up to date.' });
    }

    portableUpdateAsset = {
      version: latestVersion,
      fileName: asset.name,
      downloadUrl: asset.browser_download_url,
      size: asset.size
    };

    return publishUpdateStatus({
      state: 'available',
      version: latestVersion,
      message: `LocalPersona ${latestVersion} portable update is available.`
    });
  } catch (error) {
    if (showErrors) {
      return publishUpdateStatus({ state: 'error', message: stringifyError(error) });
    }
    return publishUpdateStatus({ state: 'idle' });
  }
}

async function downloadPortableUpdate(): Promise<UpdateStatus> {
  if (!portableUpdateAsset) {
    await checkForPortableUpdates(true);
  }

  if (!portableUpdateAsset) {
    return publishUpdateStatus({ state: 'not-available', message: 'No portable update is available.' });
  }

  const asset = portableUpdateAsset;
  const updateDir = path.join(app.getPath('userData'), 'updates');
  const targetPath = path.join(updateDir, asset.fileName);
  const tempPath = `${targetPath}.download`;

  try {
    await fs.mkdir(updateDir, { recursive: true });
    await fs.rm(tempPath, { force: true });
    await fs.rm(targetPath, { force: true });

    publishUpdateStatus({ state: 'downloading', version: asset.version, percent: 0, message: 'Starting portable update download.' });

    const response = await fetch(asset.downloadUrl, {
      headers: {
        Accept: 'application/octet-stream',
        'User-Agent': `${PRODUCT_NAME}/${app.getVersion()}`
      }
    });
    if (!response.ok || !response.body) {
      throw new Error(`Portable update download failed: HTTP ${response.status}`);
    }

    const total = Number(response.headers.get('content-length')) || asset.size || 0;
    const reader = response.body.getReader();
    const file = await fs.open(tempPath, 'w');
    let downloaded = 0;
    let lastPercent = -1;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        if (!value) {
          continue;
        }
        const chunk = Buffer.from(value);
        await file.write(chunk);
        downloaded += chunk.length;
        if (total > 0) {
          const percent = Math.min(100, Math.round((downloaded / total) * 100));
          if (percent !== lastPercent) {
            lastPercent = percent;
            publishUpdateStatus({
              state: 'downloading',
              version: asset.version,
              percent,
              message: `Downloading portable update ${percent}%.`
            });
          }
        }
      }
    } finally {
      await file.close();
    }

    await fs.rename(tempPath, targetPath);
    portableUpdateAsset = { ...asset, downloadedPath: targetPath };
    return publishUpdateStatus({
      state: 'downloaded',
      version: asset.version,
      message: `LocalPersona ${asset.version} portable update is ready to install.`
    });
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    return publishUpdateStatus({ state: 'error', message: stringifyError(error) });
  }
}

async function installPortableUpdate(): Promise<UpdateStatus> {
  const asset = portableUpdateAsset;
  const sourcePath = asset?.downloadedPath;
  const portableExecutable = getPortableExecutablePath();
  if (!asset || !sourcePath || !portableExecutable) {
    return publishUpdateStatus({ state: 'error', message: 'Portable update is not ready to install.' });
  }

  const scriptPath = path.join(app.getPath('temp'), `localpersona-portable-update-${Date.now()}.ps1`);
  await fs.writeFile(scriptPath, buildPortableInstallScript(sourcePath, portableExecutable, process.pid, process.ppid), 'utf8');

  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();

  const status = publishUpdateStatus({
    state: 'downloaded',
    version: asset.version,
    message: 'Installing portable update.'
  });
  setTimeout(() => app.quit(), 250);
  return status;
}

function buildPortableInstallScript(sourcePath: string, targetPath: string, currentPid: number, launcherPid: number) {
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$source = ${powershellString(sourcePath)}`,
    `$target = ${powershellString(targetPath)}`,
    `$currentPid = ${currentPid}`,
    `$launcherPid = ${launcherPid}`,
    'Wait-Process -Id $currentPid -Timeout 30 -ErrorAction SilentlyContinue',
    'Wait-Process -Id $launcherPid -Timeout 30 -ErrorAction SilentlyContinue',
    "$ErrorActionPreference = 'Stop'",
    'for ($attempt = 0; $attempt -lt 90; $attempt++) {',
    '  try {',
    '    Copy-Item -LiteralPath $source -Destination $target -Force',
    '    Start-Process -FilePath $target',
    '    Remove-Item -LiteralPath $source -Force -ErrorAction SilentlyContinue',
    '    break',
    '  } catch {',
    '    Start-Sleep -Milliseconds 500',
    '  }',
    '}',
    'Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue'
  ].join('\r\n');
}

function findPortableReleaseAsset(release: GitHubRelease) {
  const artifactArch = getArtifactArch();
  const portableAssetPattern = new RegExp(`^${escapeRegex(PRODUCT_NAME)}-Portable-(.+)-(x64|arm64|ia32)\\.exe$`, 'i');
  const assets = (release.assets ?? []).filter(
    (asset) => asset.name && asset.browser_download_url && asset.state !== 'deleted' && portableAssetPattern.test(asset.name)
  );
  return assets.find((asset) => asset.name?.toLowerCase().endsWith(`-${artifactArch}.exe`)) ?? assets[0];
}

function versionFromPortableAssetName(fileName: string) {
  const pattern = new RegExp(`^${escapeRegex(PRODUCT_NAME)}-Portable-(.+)-(?:x64|arm64|ia32)\\.exe$`, 'i');
  return fileName.match(pattern)?.[1];
}

function normalizeVersion(value?: string) {
  return value?.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/)?.[0] ?? '';
}

function compareVersions(left: string, right: string) {
  const [leftCore, leftPre = ''] = left.split('+')[0].split('-', 2);
  const [rightCore, rightPre = ''] = right.split('+')[0].split('-', 2);
  const leftParts = leftCore.split('.').map((part) => Number(part) || 0);
  const rightParts = rightCore.split('.').map((part) => Number(part) || 0);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  if (leftPre && !rightPre) {
    return -1;
  }
  if (!leftPre && rightPre) {
    return 1;
  }
  return leftPre.localeCompare(rightPre);
}

function getArtifactArch() {
  if (process.arch === 'arm64') {
    return 'arm64';
  }
  if (process.arch === 'ia32') {
    return 'ia32';
  }
  return 'x64';
}

function getUpdatePackageKind(): UpdatePackageKind {
  if (!app.isPackaged) {
    return 'development';
  }
  if (process.platform === 'win32' && getPortableExecutablePath()) {
    return 'portable';
  }
  return 'installer';
}

function getPortableExecutablePath() {
  const portableExecutable = process.env.PORTABLE_EXECUTABLE_FILE;
  return portableExecutable && path.isAbsolute(portableExecutable) ? portableExecutable : undefined;
}

function powershellString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function normalizeCharacter(input: Partial<CharacterProfile>, fallbackPromptMode: PromptMode = 'roleplay'): CharacterProfile {
  const now = new Date().toISOString();
  return {
    id: String(input.id || randomUUID()),
    name: String(input.name || 'Imported Character'),
    subtitle: String(input.subtitle || ''),
    description: String(input.description || ''),
    systemPrompt: String(input.systemPrompt || ''),
    greeting: String(input.greeting || ''),
    tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
    avatarColor: String(input.avatarColor || '#1f7a70'),
    temperature: clampNumber(input.temperature, 0, 2, 0.7),
    promptMode: input.promptMode === 'assistant' || input.promptMode === 'roleplay' ? input.promptMode : fallbackPromptMode,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now
  };
}

function normalizeSession(input: Partial<ChatSession>): ChatSession {
  return {
    id: String(input.id || randomUUID()),
    characterId: String(input.characterId || ''),
    model: String(input.model || ''),
    title: String(input.title || 'Chat'),
    messages: Array.isArray(input.messages) ? input.messages : [],
    updatedAt: input.updatedAt || new Date().toISOString()
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numericValue));
}

function normalizePromptMode(value: unknown): PromptMode {
  return value === 'assistant' ? 'assistant' : 'roleplay';
}

async function getOllamaStatus(): Promise<OllamaStatus> {
  const [binaryPath, probe] = await Promise.all([findOllamaBinary(), probeOllama()]);
  return {
    installed: Boolean(binaryPath || probe.running),
    running: probe.running,
    version: probe.version,
    path: binaryPath,
    error: probe.error
  };
}

async function ensureOllama(): Promise<OllamaStatus> {
  let status = await getOllamaStatus();
  if (status.running) {
    return status;
  }
  if (!status.installed || !status.path) {
    return status;
  }

  try {
    ollamaServeProcess = spawn(status.path, ['serve'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    ollamaServeProcess.unref();
  } catch (error) {
    return { ...status, error: stringifyError(error) };
  }

  status = await waitForOllama(12000);
  return status;
}

async function installOllama(): Promise<OllamaStatus> {
  if (installPromise) {
    return installPromise;
  }

  installPromise = (async () => {
    const before = await getOllamaStatus();
    if (before.running || before.installed) {
      return ensureOllama();
    }

    const command =
      process.platform === 'win32'
        ? {
            file: 'powershell.exe',
            args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://ollama.com/install.ps1 | iex']
          }
        : {
            file: 'sh',
            args: ['-c', 'curl -fsSL https://ollama.com/install.sh | sh']
          };

    sendToRenderer('ollama:install-log', 'Installing Ollama from ollama.com...');

    await new Promise<void>((resolve, reject) => {
      const child = spawn(command.file, command.args, {
        windowsHide: true
      });

      child.stdout?.on('data', (chunk: Buffer) => sendToRenderer('ollama:install-log', chunk.toString()));
      child.stderr?.on('data', (chunk: Buffer) => sendToRenderer('ollama:install-log', chunk.toString()));
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Ollama installer exited with code ${code ?? 'unknown'}`));
        }
      });
    });

    const status = await ensureOllama();
    sendToRenderer('ollama:install-log', status.running ? 'Ollama is ready.' : 'Ollama installed, but the local API is not responding yet.');
    return status;
  })();

  try {
    return await installPromise;
  } finally {
    installPromise = null;
  }
}

async function probeOllama(): Promise<{ running: boolean; version?: string; error?: string }> {
  try {
    const response = await fetchWithTimeout(`${OLLAMA_BASE_URL}/api/version`, {}, 2500);
    if (!response.ok) {
      return { running: false, error: `HTTP ${response.status}` };
    }
    const data = (await response.json()) as { version?: string };
    return { running: true, version: data.version };
  } catch (error) {
    return { running: false, error: stringifyError(error) };
  }
}

async function waitForOllama(timeoutMs: number): Promise<OllamaStatus> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const status = await getOllamaStatus();
    if (status.running) {
      return status;
    }
    await delay(800);
  }
  return getOllamaStatus();
}

async function listLocalModels(): Promise<LocalModel[]> {
  const status = await ensureOllama();
  if (!status.running) {
    return [];
  }
  const response = await fetchWithTimeout(`${OLLAMA_BASE_URL}/api/tags`, {}, 8000);
  if (!response.ok) {
    throw new Error(`Could not load local models: HTTP ${response.status}`);
  }
  const data = (await response.json()) as {
    models?: Array<{
      name: string;
      modified_at?: string;
      size?: number;
      digest?: string;
      details?: LocalModel['details'];
    }>;
  };
  return (data.models ?? []).map((model) => ({
    name: model.name,
    modifiedAt: model.modified_at,
    size: model.size,
    digest: model.digest,
    details: model.details
  }));
}

async function getLibraryModels(): Promise<LibraryModel[]> {
  try {
    const response = await fetchWithTimeout('https://ollama.com/library', {}, 10000);
    if (!response.ok) {
      return fallbackLibraryModels;
    }
    const html = await response.text();
    const parsed = parseOllamaLibrary(html);
    return mergeLibraryModels(parsed);
  } catch {
    return fallbackLibraryModels;
  }
}

function parseOllamaLibrary(html: string): LibraryModel[] {
  const found = new Map<string, LibraryModel>();
  const anchorRegex = /<a[^>]+href=["']\/library\/([^"'/]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorRegex.exec(html))) {
    const name = decodeURIComponent(match[1]).trim();
    if (!name || found.has(name)) {
      continue;
    }

    const text = stripHtml(match[2]);
    const fallback = fallbackLibraryModels.find((model) => model.name === name);
    const description = fallback?.description || text.replace(new RegExp(`^${escapeRegex(name)}\\s*`, 'i'), '').slice(0, 160) || 'Model from the Ollama library.';
    const tags = fallback?.tags || inferModelTags(text);
    const variants = fallback?.variants || inferVariants(text);
    const pulls = text.match(/(\d+(?:\.\d+)?[KMB]?)\s+Pulls/i)?.[1];
    const updated = text.match(/Updated\s+([^<]+?)(?:\s{2,}|$)/i)?.[1];

    found.set(name, {
      name,
      description,
      tags,
      variants,
      pulls: pulls ? `${pulls} pulls` : fallback?.pulls,
      updated: updated || fallback?.updated
    });
  }

  return Array.from(found.values()).slice(0, 80);
}

function mergeLibraryModels(models: LibraryModel[]) {
  if (models.length === 0) {
    return fallbackLibraryModels;
  }
  const known = new Map(fallbackLibraryModels.map((model) => [model.name, model]));
  return models.map((model) => {
    const fallback = known.get(model.name);
    return fallback
      ? {
          ...model,
          description: fallback.description,
          tags: Array.from(new Set([...fallback.tags, ...model.tags])),
          variants: fallback.variants.length > 0 ? fallback.variants : model.variants
        }
      : model;
  });
}

function stripHtml(input: string) {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function inferModelTags(text: string) {
  const candidates = ['tools', 'vision', 'embedding', 'thinking', 'cloud', 'coding', 'chat'];
  const lower = text.toLowerCase();
  return candidates.filter((tag) => lower.includes(tag)).slice(0, 4);
}

function inferVariants(text: string) {
  const variants = text.match(/\b(?:\d+(?:\.\d+)?b|\d+x\d+b|e\d+b)\b/gi) ?? [];
  return Array.from(new Set(variants.map((variant) => variant.toLowerCase()))).slice(0, 8);
}

async function pullModel(model: string): Promise<LocalModel[]> {
  const cleanModel = model.trim();
  if (!cleanModel) {
    throw new Error('Model name is required.');
  }

  const status = await ensureOllama();
  if (!status.running) {
    throw new Error('Ollama is not running.');
  }

  const response = await fetch(`${OLLAMA_BASE_URL}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: cleanModel, stream: true })
  });

  if (!response.ok || !response.body) {
    throw new Error(`Could not pull ${cleanModel}: HTTP ${response.status}`);
  }

  await readNdjson(response, (event) => {
    const progress: PullProgress = {
      model: cleanModel,
      status: String(event.status || 'Downloading'),
      digest: typeof event.digest === 'string' ? event.digest : undefined,
      total: typeof event.total === 'number' ? event.total : undefined,
      completed: typeof event.completed === 'number' ? event.completed : undefined
    };
    sendToRenderer('models:pull-progress', progress);
  });

  sendToRenderer('models:pull-progress', { model: cleanModel, status: 'Ready' });
  return listLocalModels();
}

async function sendChat(payload: ChatPayload): Promise<{ content: string }> {
  const status = await ensureOllama();
  if (!status.running) {
    throw new Error('Ollama is not running.');
  }

  const controller = new AbortController();
  activeChatRequests.set(payload.requestId, controller);
  const promptMode = normalizePromptMode(payload.promptMode);
  const systemPrompt =
    promptMode === 'assistant'
      ? buildAssistantSystemPrompt(payload.systemPrompt, payload.messages)
      : buildRoleplaySystemPrompt(payload.systemPrompt, payload.messages);
  const messages = [
    { role: 'system', content: systemPrompt },
    ...payload.messages.map((message) => ({ role: message.role, content: message.content }))
  ];

  let content = '';
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: payload.model,
        messages,
        stream: true,
        options: {
          temperature: payload.temperature,
          top_p: 0.9,
          repeat_penalty: 1.08,
          num_predict: -1
        }
      })
    });

    if (!response.ok || !response.body) {
      throw new Error(`Chat failed: HTTP ${response.status}`);
    }

    await readNdjson(response, (event) => {
      const message = event.message && typeof event.message === 'object' ? (event.message as { content?: unknown }) : undefined;
      const token = typeof message?.content === 'string' ? message.content : '';
      if (token) {
        content += token;
        sendToRenderer('chat:token', { requestId: payload.requestId, token });
      }
    });

    return { content };
  } catch (error) {
    if (isAbortError(error)) {
      return { content };
    }
    throw error;
  } finally {
    activeChatRequests.delete(payload.requestId);
  }
}

function cancelChat(requestId: string) {
  const controller = activeChatRequests.get(requestId);
  if (!controller) {
    return false;
  }
  controller.abort();
  return true;
}

function buildRoleplaySystemPrompt(characterPrompt: string, messages: ChatMessage[]) {
  const prompt = characterPrompt.trim();
  const userStyle = buildUserStyleGuide(messages);
  const roleBoundary = buildLatestTurnRoleBoundary(messages);
  const sections = [HIDDEN_ROLEPLAY_PROMPT, prompt || 'No character card was provided. Infer a consistent roleplay character from the conversation.'];
  if (userStyle) {
    sections.push(userStyle);
  }
  if (roleBoundary) {
    sections.push(roleBoundary);
  }
  return sections.join('\n\n');
}

function buildAssistantSystemPrompt(characterPrompt: string, messages: ChatMessage[]) {
  const prompt = characterPrompt.trim();
  const userStyle = buildAssistantStyleGuide(messages);
  const sections = [HIDDEN_ASSISTANT_PROMPT, prompt || 'No extra assistant instructions were provided.'];
  if (userStyle) {
    sections.push(userStyle);
  }
  return sections.join('\n\n');
}

function buildUserStyleGuide(messages: ChatMessage[]) {
  const userMessages = messages
    .filter((message) => message.role === 'user')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .slice(-6);

  if (userMessages.length === 0) {
    return '';
  }

  const combined = userMessages.join('\n');
  const wordCounts = userMessages.map(countWords).filter((count) => count > 0);
  const averageWords = wordCounts.length > 0 ? Math.round(wordCounts.reduce((sum, count) => sum + count, 0) / wordCounts.length) : 0;
  const notes: string[] = [];

  if (averageWords > 0) {
    if (averageWords <= 10) {
      notes.push('User writes very short turns; answer with compact, punchy replies.');
    } else if (averageWords <= 35) {
      notes.push('User writes short-to-medium turns; keep replies tight and conversational.');
    } else {
      notes.push('User writes longer scene setup; still answer naturally, but do not exceed the scene\'s needs.');
    }
  }

  if (usesMostlyLowercase(combined)) {
    notes.push('User often writes casual lowercase; avoid overly formal capitalization/polish in dialogue when the character can naturally match it.');
  }

  if (/\.\.\.|\u2026/.test(combined)) {
    notes.push('User uses ellipses/hesitation; mirror that pacing lightly when emotionally appropriate.');
  }

  if (/\*[^*\n]{1,180}\*/.test(combined)) {
    notes.push('User uses single-asterisk roleplay actions; keep character actions in the same single-asterisk style.');
  }

  if (/\b(?:ive|im|id|dont|cant|wont|youre|thats|wanna|gonna|kinda|yeah|nah|lol|lmao|rn|tbh|bc)\b/i.test(combined)) {
    notes.push('User has casual texting diction; keep dialogue natural instead of perfectly edited.');
  }

  if (/[!?]{2,}/.test(combined)) {
    notes.push('User uses heightened punctuation; match intensity only when the character would.');
  }

  if (/\*[^*\n]*\bi\s/i.test(combined) || /\bi\s+(?:walk|jump|look|sit|stand|move|turn|smile|frown|grab|take|feel|think|say|ask)\b/i.test(combined)) {
    notes.push('User writes first-person roleplay actions. Do not imitate that point of view. Reply only as the character reacting to those established user actions.');
  }

  if (notes.length === 0) {
    notes.push('Use the user\'s recent messages only as a light pacing reference.');
  }

  return ['Recent user style guide, hidden:', ...notes.map((note) => `- ${note}`)].join('\n');
}

function buildAssistantStyleGuide(messages: ChatMessage[]) {
  const userMessages = messages
    .filter((message) => message.role === 'user')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .slice(-6);

  if (userMessages.length === 0) {
    return '';
  }

  const combined = userMessages.join('\n');
  const wordCounts = userMessages.map(countWords).filter((count) => count > 0);
  const averageWords = wordCounts.length > 0 ? Math.round(wordCounts.reduce((sum, count) => sum + count, 0) / wordCounts.length) : 0;
  const notes: string[] = ['Do not use roleplay actions or asterisk narration in assistant mode.'];

  if (averageWords > 0) {
    if (averageWords <= 10) {
      notes.push('User writes very short turns; answer compactly.');
    } else if (averageWords <= 35) {
      notes.push('User writes short-to-medium turns; keep answers conversational and tight.');
    } else {
      notes.push('User gives more context; answer the actual request without bloated framing.');
    }
  }

  if (usesMostlyLowercase(combined)) {
    notes.push('The user often writes casually; avoid stiff formal phrasing.');
  }

  if (/\.\.\.|\u2026/.test(combined)) {
    notes.push('The user uses hesitant pacing; mirror lightly only when it helps the tone.');
  }

  if (/\b(?:ive|im|id|dont|cant|wont|youre|thats|wanna|gonna|kinda|yeah|nah|lol|lmao|rn|tbh|bc)\b/i.test(combined)) {
    notes.push('The user uses casual texting diction; keep replies natural instead of overly polished.');
  }

  return ['Recent user style guide, hidden:', ...notes.map((note) => `- ${note}`)].join('\n');
}

function buildLatestTurnRoleBoundary(messages: ChatMessage[]) {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user')?.content.trim() ?? '';
  if (!latestUserMessage) {
    return '';
  }

  const hasFirstPersonAction = /\*[^*\n]*\bi\s/i.test(latestUserMessage);
  if (!hasFirstPersonAction) {
    return '';
  }

  return [
    'Latest turn role boundary, hidden:',
    '- The latest user message contains first-person action narration. Those actions belong to the user, not the character.',
    '- Do not continue from "I" as your own body. Reply as the character seeing/responding to the user.',
    '- Good shape: *Sarah looks up from the couch, relief flashing across her face.* "yeah. i was worried. where were you?"'
  ].join('\n');
}

function countWords(value: string) {
  return value.match(/[A-Za-z0-9']+/g)?.length ?? 0;
}

function usesMostlyLowercase(value: string) {
  const letters = value.match(/[A-Za-z]/g) ?? [];
  if (letters.length < 12) {
    return false;
  }
  const uppercase = letters.filter((letter) => letter >= 'A' && letter <= 'Z').length;
  return uppercase / letters.length < 0.08;
}

async function readNdjson(response: Response, onObject: (value: Record<string, unknown>) => void) {
  const reader = response.body?.getReader();
  if (!reader) {
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      onObject(JSON.parse(trimmed));
    }
  }

  const trimmed = buffer.trim();
  if (trimmed) {
    onObject(JSON.parse(trimmed));
  }
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function findOllamaBinary(): Promise<string | undefined> {
  const candidates = getOllamaCandidates();
  for (const candidate of candidates) {
    if (candidate !== 'ollama' && existsSync(candidate)) {
      return candidate;
    }
  }

  const lookup = process.platform === 'win32' ? { file: 'where.exe', args: ['ollama'] } : { file: 'which', args: ['ollama'] };
  try {
    const output = await runCapture(lookup.file, lookup.args, 3000);
    const firstLine = output.split(/\r?\n/).find(Boolean);
    return firstLine;
  } catch {
    return undefined;
  }
}

function getOllamaCandidates() {
  const candidates = ['ollama'];
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    const programFiles = process.env.ProgramFiles;
    const programFilesX86 = process.env['ProgramFiles(x86)'];
    if (localAppData) {
      candidates.unshift(path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe'));
    }
    if (programFiles) {
      candidates.unshift(path.join(programFiles, 'Ollama', 'ollama.exe'));
    }
    if (programFilesX86) {
      candidates.unshift(path.join(programFilesX86, 'Ollama', 'ollama.exe'));
    }
  }
  return candidates;
}

function runCapture(file: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true });
    let output = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`${file} timed out`));
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0 && output.trim()) {
        resolve(output.trim());
      } else {
        reject(new Error(`${file} exited with ${code ?? 'unknown'}`));
      }
    });
  });
}

function stringifyError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
