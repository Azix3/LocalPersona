import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron';
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
  HuggingFaceTtsDtype,
  HuggingFaceTtsModel,
  HuggingFaceTtsPayload,
  HuggingFaceTtsResult,
  HuggingFaceTtsSpeaker,
  LibraryModel,
  LocalSpeechRecognitionEvent,
  LocalModel,
  OllamaStatus,
  PromptMode,
  PullProgress,
  SpeechRecognitionEngine,
  UpdatePackageKind,
  UpdateStatus,
  VoiceCleanupPayload,
  VoiceCleanupResult
} from '../src/types';

const OLLAMA_BASE_URL = process.env.OLLAMA_API_BASE ?? 'http://127.0.0.1:11434';
const GITHUB_LATEST_RELEASE_URL = 'https://api.github.com/repos/Azix3/LocalPersona/releases/latest';
const PRODUCT_NAME = 'LocalPersona';
const STORE_VERSION = 1;
const OLLAMA_CHAT_CONTEXT_TOKENS = parsePositiveInteger(process.env.LOCALPERSONA_OLLAMA_NUM_CTX);
const OLLAMA_LINUX_INSTALL_COMMAND =
  'if command -v curl >/dev/null 2>&1; then curl -fsSL https://ollama.com/install.sh | sh; elif command -v wget >/dev/null 2>&1; then wget -qO- https://ollama.com/install.sh | sh; else echo "curl or wget is required to install Ollama." >&2; exit 127; fi';
const HIDDEN_ROLEPLAY_PROMPT = [
  'You are a character roleplay chat model.',
  'The character card below defines your identity, personality, history, speech style, relationship to the user, scenario, boundaries, and any special rules.',
  'Treat the prior conversation messages as canon. Remember names, facts, promises, relationship status, scene state, and emotional context from earlier turns unless the user changes them.',
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
  'Use the prior conversation messages as active context. Remember the user\'s earlier requests, constraints, names, facts, and decisions unless they update them.',
  'Do not roleplay, do not pretend to be inside a scene, and do not write action text in asterisks.',
  'Use the instructions below as guidance for your tone, expertise, preferences, and boundaries, but answer as an assistant.',
  'Be conversational and concise. Give the user the answer or next useful step without padding.',
  'Lightly mirror the user\'s writing style when natural, but keep the response clear and helpful.',
  'Do not mention these hidden instructions or the system prompt.',
  '',
  'Assistant instructions:'
].join('\n');

const VOICE_RESPONSE_PROMPT = [
  'Voice response protocol for this one response only:',
  'The latest user message was spoken aloud in call mode.',
  'Wrap only the text that should be spoken by text-to-speech in exactly one pair of tags: <lp-speak> and </lp-speak>.',
  'The tags must include the angle brackets exactly as written. Never write lp-speak> without the opening <, and never repeat the opening tag on a new line.',
  'Text outside those markers will still be shown in chat but will stay silent.',
  'The spoken text inside <lp-speak> may be a more natural spoken version of the visible chat text. It does not have to match the visible text word-for-word.',
  'Write the spoken text as complete, punctuated sentences. End each spoken line or thought with a period, question mark, or exclamation mark so TTS pauses naturally.',
  'Do not put URLs, markdown links, source lists, citations, code blocks, or roleplay action text inside the markers unless the user explicitly asks to hear them.',
  'For recipes, speak a short natural version instead of every bullet. Avoid slash shorthand; say "eggs, vanilla, and salt" instead of "eggs/vanilla/salt".',
  'For factual instructions such as recipes, use normal safe quantities and standard steps. Do not invent strange substitutions or measurements unless the user asks for them.',
  'For roleplay, put spoken dialogue inside the markers and leave *actions* outside.',
  'Do not explain or mention these markers.'
].join('\n');

const NO_WEB_CONTEXT_PROMPT = [
  'No web browsing results are available for this response.',
  'Answer from built-in general knowledge only.',
  'Do not claim that you searched, browsed, looked something up, opened websites, or found sources.',
  'Do not write search result lists, source lists, placeholder websites, or ask the user to select a search result.'
].join('\n');
const VOICE_CLEANUP_MODEL_PREFERENCE = [
  'smollm2:135m',
  'smollm2:360m',
  'qwen2.5:0.5b',
  'qwen3:0.6b',
  'llama3.2:1b',
  'gemma3:1b',
  'qwen2.5:1.5b',
  'smollm2:1.7b',
  'tinyllama'
];
const VOICE_CLEANUP_CONFIDENCE_THRESHOLD = 0.68;
const DEFAULT_HF_TTS_SPEECHT5_SPEAKER =
  'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/speaker_embeddings.bin';
const DEFAULT_HF_TTS_KOKORO_VOICE = 'af_heart';
const fallbackHuggingFaceTtsModels: HuggingFaceTtsModel[] = [
  {
    id: 'Xenova/speecht5_tts',
    name: 'SpeechT5',
    description: 'Stable English TTS model from the Transformers.js examples. Uses a speaker embedding.',
    tags: ['english', 'speecht5', 'transformers.js'],
    defaultDtype: 'q8',
    requiresSpeakerEmbeddings: true,
    defaultSpeakerEmbedding: DEFAULT_HF_TTS_SPEECHT5_SPEAKER,
    speakers: [{ id: 'default', name: 'Default speaker', embedding: DEFAULT_HF_TTS_SPEECHT5_SPEAKER }]
  },
  {
    id: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    name: 'Kokoro 82M v1.0',
    description: 'High-quality multi-voice Kokoro ONNX model. Uses the Kokoro runtime for local speech.',
    tags: ['english', 'kokoro', 'styletts2', 'onnx', 'transformers.js'],
    defaultDtype: 'q8',
    defaultSpeakerEmbedding: DEFAULT_HF_TTS_KOKORO_VOICE,
    speakers: getKokoroTtsSpeakers()
  },
  {
    id: 'onnx-community/Kokoro-82M-v1.0-ONNX-timestamped',
    name: 'Kokoro 82M v1.0 Timestamped',
    description: 'Kokoro ONNX timestamped build with the same local Kokoro voice presets.',
    tags: ['english', 'kokoro', 'styletts2', 'onnx', 'transformers.js', 'timestamps'],
    defaultDtype: 'q8',
    defaultSpeakerEmbedding: DEFAULT_HF_TTS_KOKORO_VOICE,
    speakers: getKokoroTtsSpeakers()
  },
  {
    id: 'Xenova/mms-tts-eng',
    name: 'MMS English',
    description: 'Small English VITS model. Usually faster than larger multi-voice models.',
    tags: ['english', 'fast', 'vits', 'transformers.js'],
    defaultDtype: 'q8'
  },
  {
    id: 'Xenova/mms-tts-spa',
    name: 'MMS Spanish',
    description: 'Small Spanish VITS model for local text-to-speech.',
    tags: ['spanish', 'vits', 'transformers.js'],
    defaultDtype: 'q8'
  },
  {
    id: 'Xenova/mms-tts-fra',
    name: 'MMS French',
    description: 'Small French VITS model for local text-to-speech.',
    tags: ['french', 'vits', 'transformers.js'],
    defaultDtype: 'q8'
  },
  {
    id: 'Xenova/mms-tts-deu',
    name: 'MMS German',
    description: 'Small German VITS model for local text-to-speech.',
    tags: ['german', 'vits', 'transformers.js'],
    defaultDtype: 'q8'
  }
];

let mainWindow: BrowserWindow | null = null;
let storePath = '';
let installPromise: Promise<OllamaStatus> | null = null;
let ollamaServeProcess: ReturnType<typeof spawn> | null = null;
let speechRecognitionProcess: ReturnType<typeof spawn> | null = null;
let speechRecognitionBuffer = '';
const activeChatRequests = new Map<string, AbortController>();
let latestUpdateStatus: UpdateStatus = { state: 'idle' };
let updateErrorIsSilent = false;
let portableUpdateAsset: PortableUpdateAsset | null = null;
const hfTtsPipelineCache = new Map<string, Promise<unknown>>();
const kokoroTtsCache = new Map<string, Promise<KokoroTtsEngine>>();

type PortableUpdateAsset = {
  version: string;
  fileName: string;
  downloadUrl: string;
  size?: number;
  downloadedPath?: string;
};

type KokoroTtsEngine = {
  voices?: Record<string, unknown>;
  generate: (text: string, options?: { voice?: string; speed?: number }) => Promise<unknown>;
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
  configureMediaPermissions();
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

function configureMediaPermissions() {
  const allowedPermissions = new Set(['media', 'microphone', 'audioCapture']);
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(Boolean(mainWindow && webContents.id === mainWindow.webContents.id && allowedPermissions.has(permission)));
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return Boolean(mainWindow && webContents && webContents.id === mainWindow.webContents.id && allowedPermissions.has(permission));
  });
}

app.on('window-all-closed', () => {
  void stopLocalSpeechRecognition();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  void stopLocalSpeechRecognition();
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
  const sessions = Array.isArray(input.sessions) ? input.sessions.map((session) => normalizeSession(session)) : [];
  const selectedCharacterId =
    input.selectedCharacterId && characters.some((character) => character.id === input.selectedCharacterId)
      ? input.selectedCharacterId
      : characters[0]?.id;
  const selectedSessionId =
    typeof input.selectedSessionId === 'string' &&
    sessions.some((session) => session.id === input.selectedSessionId && session.characterId === selectedCharacterId)
      ? input.selectedSessionId
      : getLatestSessionForCharacter(sessions, selectedCharacterId)?.id;

  return {
    version: STORE_VERSION,
    characters,
    sessions,
    userName: cleanUserName(input.userName),
    selectedInputDeviceId: typeof input.selectedInputDeviceId === 'string' ? input.selectedInputDeviceId : undefined,
    selectedOutputDeviceId: typeof input.selectedOutputDeviceId === 'string' ? input.selectedOutputDeviceId : undefined,
    microphoneSensitivity: clampNumber(input.microphoneSensitivity, 0.01, 1, 0.08),
    speechRecognitionEngine: normalizeSpeechRecognitionEngine(input.speechRecognitionEngine),
    experimentalVoiceFeatures: Boolean(input.experimentalVoiceFeatures),
    experimentalContinuousVoiceConversation: Boolean(input.experimentalContinuousVoiceConversation),
    experimentalVoiceCleanup: Boolean(input.experimentalVoiceCleanup),
    hfTtsModels: normalizeHuggingFaceTtsModels(input.hfTtsModels),
    selectedCharacterId,
    selectedSessionId,
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
      userName: cleanUserName(input.userName),
      aboutUser: String(input.aboutUser || '').trim(),
      subtitle: String(input.subtitle || '').trim(),
      description: String(input.description || '').trim(),
      systemPrompt: String(input.systemPrompt || '').trim(),
      greeting: String(input.greeting || '').trim(),
      tags: cleanTags,
      avatarColor: String(input.avatarColor || '#1f7a70'),
      avatarImage: normalizeAvatarImage(input.avatarImage),
      temperature: clampNumber(input.temperature, 0, 2, 0.7),
      promptMode: normalizePromptMode(input.promptMode),
      webSearchEnabled: Boolean(input.webSearchEnabled),
      callEnabled: Boolean(input.callEnabled),
      activationPhrase: String(input.activationPhrase || `hey ${String(input.name || 'there').trim() || 'there'}`).trim(),
      activationResponse: String(input.activationResponse || 'yes?').trim(),
      voiceName: String(input.voiceName || '').trim(),
      ttsProvider: normalizeTtsProvider(input.ttsProvider),
      hfTtsModel: getCompatibleHuggingFaceTtsModelId(String(input.hfTtsModel || '').trim()),
      hfTtsSpeaker: String(input.hfTtsSpeaker || '').trim(),
      hfTtsDtype: normalizeHfTtsDtype(input.hfTtsDtype),
      createdAt: input.createdAt || now,
      updatedAt: now
    };

    const existingIndex = store.characters.findIndex((item) => item.id === character.id);
    if (existingIndex >= 0) {
      store.characters[existingIndex] = character;
    } else {
      store.characters.unshift(character);
      store.selectedCharacterId = character.id;
      delete store.selectedSessionId;
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
      store.selectedSessionId = getLatestSessionForCharacter(store.sessions, store.selectedCharacterId)?.id;
    } else if (store.selectedSessionId && !store.sessions.some((session) => session.id === store.selectedSessionId)) {
      delete store.selectedSessionId;
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
    store.selectedSessionId = cleanSession.id;
    store.selectedModel = cleanSession.model || store.selectedModel;
    await writeStore(store);
    return store;
  });

  ipcMain.handle('sessions:delete', async (_event, sessionId: string) => {
    const store = await readStore();
    store.sessions = store.sessions.filter((session) => session.id !== sessionId);
    if (store.selectedSessionId === sessionId) {
      store.selectedSessionId = getLatestSessionForCharacter(store.sessions, store.selectedCharacterId)?.id;
    }
    await writeStore(store);
    return store;
  });

  ipcMain.handle('settings:update', async (_event, settings: Partial<AppStore>) => {
    const store = await readStore();
    if (typeof settings.selectedCharacterId === 'string') {
      store.selectedCharacterId = settings.selectedCharacterId;
      const selectedSession = store.selectedSessionId ? store.sessions.find((session) => session.id === store.selectedSessionId) : undefined;
      if (selectedSession?.characterId !== store.selectedCharacterId) {
        store.selectedSessionId = getLatestSessionForCharacter(store.sessions, store.selectedCharacterId)?.id;
      }
    }
    if ('selectedSessionId' in settings) {
      const selectedSession =
        typeof settings.selectedSessionId === 'string'
          ? store.sessions.find((session) => session.id === settings.selectedSessionId)
          : undefined;
      if (selectedSession) {
        store.selectedSessionId = selectedSession.id;
        store.selectedCharacterId = selectedSession.characterId;
        store.selectedModel = selectedSession.model || store.selectedModel;
      } else {
        delete store.selectedSessionId;
      }
    }
    if (typeof settings.selectedModel === 'string') {
      store.selectedModel = settings.selectedModel;
    }
    if ('userName' in settings) {
      store.userName = cleanUserName(settings.userName);
    }
    if ('selectedInputDeviceId' in settings) {
      store.selectedInputDeviceId =
        typeof settings.selectedInputDeviceId === 'string' && settings.selectedInputDeviceId.trim()
          ? settings.selectedInputDeviceId
          : undefined;
    }
    if ('selectedOutputDeviceId' in settings) {
      store.selectedOutputDeviceId =
        typeof settings.selectedOutputDeviceId === 'string' && settings.selectedOutputDeviceId.trim()
          ? settings.selectedOutputDeviceId
          : undefined;
    }
    if ('microphoneSensitivity' in settings) {
      store.microphoneSensitivity = clampNumber(settings.microphoneSensitivity, 0.01, 1, 0.08);
    }
    if ('speechRecognitionEngine' in settings) {
      store.speechRecognitionEngine = normalizeSpeechRecognitionEngine(settings.speechRecognitionEngine);
    }
    if ('experimentalVoiceFeatures' in settings) {
      store.experimentalVoiceFeatures = Boolean(settings.experimentalVoiceFeatures);
    }
    if ('experimentalContinuousVoiceConversation' in settings) {
      store.experimentalContinuousVoiceConversation = Boolean(settings.experimentalContinuousVoiceConversation);
    }
    if ('experimentalVoiceCleanup' in settings) {
      store.experimentalVoiceCleanup = Boolean(settings.experimentalVoiceCleanup);
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
      userName: store.userName,
      selectedInputDeviceId: store.selectedInputDeviceId,
      selectedOutputDeviceId: store.selectedOutputDeviceId,
      microphoneSensitivity: store.microphoneSensitivity,
      speechRecognitionEngine: store.speechRecognitionEngine,
      experimentalVoiceFeatures: store.experimentalVoiceFeatures,
      experimentalContinuousVoiceConversation: store.experimentalContinuousVoiceConversation,
      experimentalVoiceCleanup: store.experimentalVoiceCleanup,
      hfTtsModels: store.hfTtsModels,
      selectedCharacterId: store.selectedCharacterId,
      selectedSessionId: store.selectedSessionId,
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
    if ('userName' in imported) {
      store.userName = cleanUserName(imported.userName);
    }
    if ('selectedInputDeviceId' in imported) {
      store.selectedInputDeviceId =
        typeof imported.selectedInputDeviceId === 'string' && imported.selectedInputDeviceId.trim()
          ? imported.selectedInputDeviceId
          : undefined;
    }
    if ('selectedOutputDeviceId' in imported) {
      store.selectedOutputDeviceId =
        typeof imported.selectedOutputDeviceId === 'string' && imported.selectedOutputDeviceId.trim()
          ? imported.selectedOutputDeviceId
          : undefined;
    }
    if ('microphoneSensitivity' in imported) {
      store.microphoneSensitivity = clampNumber(imported.microphoneSensitivity, 0.01, 1, 0.08);
    }
    if ('speechRecognitionEngine' in imported) {
      store.speechRecognitionEngine = normalizeSpeechRecognitionEngine(imported.speechRecognitionEngine);
    }
    if ('experimentalVoiceFeatures' in imported) {
      store.experimentalVoiceFeatures = Boolean(imported.experimentalVoiceFeatures);
    }
    if ('experimentalContinuousVoiceConversation' in imported) {
      store.experimentalContinuousVoiceConversation = Boolean(imported.experimentalContinuousVoiceConversation);
    }
    if ('experimentalVoiceCleanup' in imported) {
      store.experimentalVoiceCleanup = Boolean(imported.experimentalVoiceCleanup);
    }
    if ('hfTtsModels' in imported) {
      store.hfTtsModels = mergeHuggingFaceTtsModels(store.hfTtsModels, normalizeHuggingFaceTtsModels(imported.hfTtsModels));
    }
    if (typeof imported.selectedCharacterId === 'string') {
      store.selectedCharacterId = imported.selectedCharacterId;
    }
    const importedSelectedSession =
      typeof imported.selectedSessionId === 'string'
        ? store.sessions.find((session) => session.id === imported.selectedSessionId)
        : undefined;
    if (importedSelectedSession) {
      store.selectedSessionId = importedSelectedSession.id;
      store.selectedCharacterId = importedSelectedSession.characterId;
    } else {
      store.selectedSessionId = getLatestSessionForCharacter(store.sessions, store.selectedCharacterId)?.id;
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
  ipcMain.handle('voice:cleanup', async (_event, payload: VoiceCleanupPayload) => cleanupVoiceTranscript(payload));
  ipcMain.handle('tts:hf-library', async () => getHuggingFaceTtsModels());
  ipcMain.handle('tts:hf-import', async (_event, modelId: string) => importHuggingFaceTtsModel(modelId));
  ipcMain.handle('tts:hf-import-local', async () => importLocalHuggingFaceTtsModel());
  ipcMain.handle('tts:hf-synthesize', async (_event, payload: HuggingFaceTtsPayload) => synthesizeHuggingFaceTts(payload));
  ipcMain.handle('speech:start', async (_event, options?: { phrases?: unknown }) => startLocalSpeechRecognition(options));
  ipcMain.handle('speech:stop', async () => stopLocalSpeechRecognition());
  ipcMain.handle('updates:check', async () => checkForUpdates(true));
  ipcMain.handle('updates:download', async () => downloadUpdate());
  ipcMain.handle('updates:install', async () => installDownloadedUpdate());
  ipcMain.handle('updates:status', async () => latestUpdateStatus);
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (isSafeExternalUrl(url)) {
      return shell.openExternal(url);
    }
    return false;
  });
}

function isSafeExternalUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
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
  const portableExecutable = getPortableExecutablePath();
  if (!portableExecutable) {
    return publishUpdateStatus({ state: 'error', message: 'Portable update path could not be found.' });
  }

  const updateDir = path.dirname(portableExecutable);
  const targetPath = path.join(updateDir, path.basename(asset.fileName));
  const tempPath = `${targetPath}.download`;

  try {
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
      message: `Downloaded portable update to ${targetPath}.`
    });
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    return publishUpdateStatus({ state: 'error', message: stringifyError(error) });
  }
}

async function installPortableUpdate(): Promise<UpdateStatus> {
  const asset = portableUpdateAsset;
  const updatePath = asset?.downloadedPath;
  if (!asset || !updatePath) {
    return publishUpdateStatus({ state: 'error', message: 'Portable update is not ready to open.' });
  }

  if (process.platform === 'linux') {
    return installLinuxPortableUpdate(asset, updatePath);
  }

  const scriptPath = path.join(app.getPath('temp'), `localpersona-portable-update-${Date.now()}.ps1`);
  await fs.writeFile(scriptPath, buildPortableLaunchScript(updatePath, process.pid, process.ppid), 'utf8');

  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();

  const status = publishUpdateStatus({
    state: 'downloaded',
    version: asset.version,
    message: `Opening portable update from ${updatePath}.`
  });
  setTimeout(() => app.quit(), 250);
  return status;
}

async function installLinuxPortableUpdate(asset: PortableUpdateAsset, updatePath: string): Promise<UpdateStatus> {
  const portableExecutable = getPortableExecutablePath();
  if (!portableExecutable) {
    return publishUpdateStatus({ state: 'error', message: 'Portable update path could not be found.' });
  }

  const scriptPath = path.join(app.getPath('temp'), `localpersona-portable-update-${Date.now()}.sh`);
  await fs.writeFile(scriptPath, buildLinuxPortableLaunchScript(updatePath, process.pid, path.dirname(portableExecutable)), 'utf8');
  await fs.chmod(scriptPath, 0o700);

  const child = spawn('sh', [scriptPath], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();

  const status = publishUpdateStatus({
    state: 'downloaded',
    version: asset.version,
    message: `Opening portable update from ${updatePath}.`
  });
  setTimeout(() => app.quit(), 250);
  return status;
}

function buildPortableLaunchScript(updatePath: string, currentPid: number, launcherPid: number) {
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$update = ${powershellString(updatePath)}`,
    `$currentPid = ${currentPid}`,
    `$launcherPid = ${launcherPid}`,
    'Wait-Process -Id $currentPid -Timeout 30 -ErrorAction SilentlyContinue',
    'Wait-Process -Id $launcherPid -Timeout 30 -ErrorAction SilentlyContinue',
    "$ErrorActionPreference = 'Stop'",
    'for ($attempt = 0; $attempt -lt 60; $attempt++) {',
    '  try {',
    '    Start-Process -FilePath $update',
    '    break',
    '  } catch {',
    '    Start-Sleep -Milliseconds 500',
    '  }',
    '}',
    'Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue'
  ].join('\r\n');
}

function buildLinuxPortableLaunchScript(updatePath: string, currentPid: number, currentDir: string) {
  return [
    '#!/bin/sh',
    'set +e',
    `update=${shellString(updatePath)}`,
    `current_pid=${currentPid}`,
    `parent_dir=${shellString(path.dirname(currentDir))}`,
    'archive_name=$(basename "$update")',
    'target_name=${archive_name%.tar.gz}',
    'target_dir="$parent_dir/$target_name"',
    'while kill -0 "$current_pid" 2>/dev/null; do',
    '  sleep 0.5',
    'done',
    'rm -rf "$target_dir"',
    'tar -xzf "$update" -C "$parent_dir"',
    'chmod +x "$target_dir/localpersona" 2>/dev/null',
    'chmod +x "$target_dir/localpersona-bin" 2>/dev/null',
    '"$target_dir/localpersona" >/dev/null 2>&1 &',
    'rm -f "$0"'
  ].join('\n');
}

function findPortableReleaseAsset(release: GitHubRelease) {
  const artifactArch = getArtifactArch();
  const portableAssetPattern = getPortableAssetPattern();
  const expectedSuffix = process.platform === 'linux' ? `-${artifactArch}.tar.gz` : `-${artifactArch}.exe`;
  const assets = (release.assets ?? []).filter(
    (asset) => asset.name && asset.browser_download_url && asset.state !== 'deleted' && portableAssetPattern.test(asset.name)
  );
  return assets.find((asset) => asset.name?.toLowerCase().endsWith(expectedSuffix)) ?? assets[0];
}

function versionFromPortableAssetName(fileName: string) {
  return fileName.match(getPortableAssetPattern())?.[1];
}

function getPortableAssetPattern() {
  if (process.platform === 'linux') {
    return new RegExp(`^${escapeRegex(PRODUCT_NAME)}-(.+)-(?:x64|arm64|armv7l)\\.tar\\.gz$`, 'i');
  }
  return new RegExp(`^${escapeRegex(PRODUCT_NAME)}-Portable-(.+)-(?:x64|arm64|ia32)\\.exe$`, 'i');
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
  if (getPortableExecutablePath()) {
    return 'portable';
  }
  return 'installer';
}

function getPortableExecutablePath() {
  const portableExecutable = process.env.PORTABLE_EXECUTABLE_FILE;
  if (process.platform === 'win32') {
    return portableExecutable && path.isAbsolute(portableExecutable) ? portableExecutable : undefined;
  }
  if (process.platform === 'linux' && app.isPackaged && !process.env.APPIMAGE) {
    if (process.execPath === '/opt/LocalPersona/localpersona' || process.execPath === '/opt/LocalPersona/localpersona-bin') {
      return undefined;
    }
    return process.execPath;
  }
  return undefined;
}

function powershellString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function shellString(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function normalizeCharacter(input: Partial<CharacterProfile>, fallbackPromptMode: PromptMode = 'roleplay'): CharacterProfile {
  const now = new Date().toISOString();
  return {
    id: String(input.id || randomUUID()),
    name: String(input.name || 'Imported Character'),
    userName: cleanUserName(input.userName),
    aboutUser: String(input.aboutUser || ''),
    subtitle: String(input.subtitle || ''),
    description: String(input.description || ''),
    systemPrompt: String(input.systemPrompt || ''),
    greeting: String(input.greeting || ''),
    tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
    avatarColor: String(input.avatarColor || '#1f7a70'),
    avatarImage: normalizeAvatarImage(input.avatarImage),
    temperature: clampNumber(input.temperature, 0, 2, 0.7),
    promptMode: input.promptMode === 'assistant' || input.promptMode === 'roleplay' ? input.promptMode : fallbackPromptMode,
    webSearchEnabled: Boolean(input.webSearchEnabled),
    callEnabled: Boolean(input.callEnabled),
    activationPhrase: String(input.activationPhrase || `hey ${String(input.name || 'there').trim() || 'there'}`),
    activationResponse: String(input.activationResponse || 'yes?'),
    voiceName: String(input.voiceName || ''),
    ttsProvider: normalizeTtsProvider(input.ttsProvider),
    hfTtsModel: getCompatibleHuggingFaceTtsModelId(String(input.hfTtsModel || '')),
    hfTtsSpeaker: String(input.hfTtsSpeaker || ''),
    hfTtsDtype: normalizeHfTtsDtype(input.hfTtsDtype),
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now
  };
}

function getLatestSessionForCharacter(sessions: ChatSession[], characterId?: string) {
  if (!characterId) {
    return undefined;
  }
  return sessions
    .filter((session) => session.characterId === characterId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
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

function normalizeSpeechRecognitionEngine(value: unknown): SpeechRecognitionEngine {
  return value === 'vosk' || value === 'windows' || value === 'auto' ? value : 'browser';
}

function normalizeTtsProvider(value: unknown) {
  return value === 'huggingface' ? 'huggingface' : 'system';
}

function normalizeHfTtsDtype(value: unknown): HuggingFaceTtsDtype {
  return value === 'fp32' || value === 'fp16' || value === 'q4' || value === 'q4f16' ? value : 'q8';
}

function cleanUserName(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function normalizeAvatarImage(value: unknown) {
  const image = typeof value === 'string' ? value.trim() : '';
  if (!image || !image.startsWith('data:image/')) {
    return undefined;
  }
  return image;
}

function normalizeHuggingFaceTtsModels(value: unknown): HuggingFaceTtsModel[] {
  const source = Array.isArray(value) ? value : [];
  return mergeHuggingFaceTtsModels(
    fallbackHuggingFaceTtsModels,
    source
      .map((model) => normalizeHuggingFaceTtsModel(model))
      .filter((model): model is HuggingFaceTtsModel => Boolean(model))
  );
}

function normalizeHuggingFaceTtsModel(value: unknown): HuggingFaceTtsModel | undefined {
  const input = value && typeof value === 'object' ? (value as Partial<HuggingFaceTtsModel>) : undefined;
  const rawId = String(input?.id || '').trim();
  const id = getCompatibleHuggingFaceTtsModelId(rawId);
  if (!id) {
    return undefined;
  }
  const inferred = rawId ? inferHuggingFaceTtsModelMetadata(id) : {};
  const speakers = Array.isArray(input?.speakers)
    ? input.speakers.map((speaker) => normalizeHuggingFaceTtsSpeaker(speaker)).filter((speaker): speaker is HuggingFaceTtsSpeaker => Boolean(speaker))
    : inferred.speakers;
  return {
    id,
    name: String(inferred.name || input?.name || id.split('/').pop() || id).trim(),
    description: String(inferred.description || input?.description || 'Imported Hugging Face text-to-speech model.').trim(),
    tags: Array.isArray(input?.tags) ? input.tags.map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 8) : inferred.tags ?? ['text-to-speech'],
    speakers,
    defaultSpeakerEmbedding:
      typeof inferred.defaultSpeakerEmbedding === 'string'
        ? inferred.defaultSpeakerEmbedding
        : typeof input?.defaultSpeakerEmbedding === 'string'
          ? input.defaultSpeakerEmbedding.trim()
          : undefined,
    defaultDtype: normalizeHfTtsDtype(input?.defaultDtype || inferred.defaultDtype),
    requiresSpeakerEmbeddings: Boolean(input?.requiresSpeakerEmbeddings || inferred.requiresSpeakerEmbeddings),
    downloads: typeof input?.downloads === 'number' ? input.downloads : undefined,
    likes: typeof input?.likes === 'number' ? input.likes : undefined,
    imported: Boolean(input?.imported),
    localPath: typeof input?.localPath === 'string' && input.localPath.trim() ? input.localPath.trim() : undefined
  };
}

function normalizeHuggingFaceTtsSpeaker(value: unknown): HuggingFaceTtsSpeaker | undefined {
  const input = value && typeof value === 'object' ? (value as Partial<HuggingFaceTtsSpeaker>) : undefined;
  const id = String(input?.id || input?.name || '').trim();
  if (!id) {
    return undefined;
  }
  return {
    id,
    name: String(input?.name || id).trim(),
    embedding: typeof input?.embedding === 'string' && input.embedding.trim() ? input.embedding.trim() : undefined
  };
}

function mergeHuggingFaceTtsModels(...groups: Array<HuggingFaceTtsModel[] | undefined>) {
  const merged = new Map<string, HuggingFaceTtsModel>();
  for (const group of groups) {
    for (const model of group ?? []) {
      const existing = merged.get(model.id);
      merged.set(
        model.id,
        existing
          ? {
              ...existing,
              ...model,
              tags: Array.from(new Set([...existing.tags, ...model.tags])),
              speakers: model.speakers ?? existing.speakers,
              defaultSpeakerEmbedding: model.defaultSpeakerEmbedding ?? existing.defaultSpeakerEmbedding,
              localPath: model.localPath ?? existing.localPath
            }
          : model
      );
    }
  }
  return Array.from(merged.values());
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

    const command = getOllamaInstallCommand();

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

function getOllamaInstallCommand() {
  if (process.platform === 'win32') {
    return {
      file: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://ollama.com/install.ps1 | iex']
    };
  }

  if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() !== 0 && existsSync('/usr/bin/pkexec')) {
    return {
      file: 'pkexec',
      args: ['sh', '-c', OLLAMA_LINUX_INSTALL_COMMAND]
    };
  }

  return {
    file: 'sh',
    args: ['-c', OLLAMA_LINUX_INSTALL_COMMAND]
  };
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
    throw await buildResponseError(`Could not pull ${cleanModel}`, response);
  }

  await readNdjson(response, (event) => {
    if (typeof event.error === 'string' && event.error.trim()) {
      throw new Error(`Could not pull ${cleanModel}: ${event.error.trim()}`);
    }
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
  const cleanModel = payload.model.trim();
  if (!cleanModel) {
    throw new Error('Choose or download a model before chatting.');
  }

  const status = await ensureOllama();
  if (!status.running) {
    throw new Error('Ollama is not running.');
  }

  const controller = new AbortController();
  activeChatRequests.set(payload.requestId, controller);
  const promptMode = normalizePromptMode(payload.promptMode);
  const chatMessages = prepareChatMessages(payload.messages);
  const webSearch = promptMode === 'assistant' && payload.webSearchEnabled ? await buildWebSearchContext(chatMessages) : emptyWebSearchContext();
  const webContext = webSearch.prompt || NO_WEB_CONTEXT_PROMPT;
  const systemPrompt =
    promptMode === 'assistant'
      ? buildAssistantSystemPrompt(payload.systemPrompt, chatMessages, payload.userName, payload.aboutUser, webContext, Boolean(payload.voiceResponse))
      : buildRoleplaySystemPrompt(payload.systemPrompt, chatMessages, payload.userName, payload.aboutUser, Boolean(payload.voiceResponse));
  const messages = [
    { role: 'system', content: systemPrompt },
    ...chatMessages.map((message) => ({ role: message.role, content: message.content }))
  ];

  let content = '';
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: cleanModel,
        messages,
        stream: true,
        options: buildChatOptions(payload.temperature)
      })
    });

    if (!response.ok || !response.body) {
      throw await buildResponseError('Chat failed', response);
    }

    await readNdjson(response, (event) => {
      if (typeof event.error === 'string' && event.error.trim()) {
        throw new Error(`Chat failed: ${event.error.trim()}`);
      }
      const message = event.message && typeof event.message === 'object' ? (event.message as { content?: unknown }) : undefined;
      const token = typeof message?.content === 'string' ? message.content : '';
      if (token) {
        content += token;
        sendToRenderer('chat:token', { requestId: payload.requestId, token });
      }
    });

    if (webSearch.sources.length === 0) {
      content = cleanUnsupportedWebSearchResponse(content);
    }

    const sourceBlock = buildWebSourceBlock(webSearch.sources);
    if (sourceBlock) {
      content += sourceBlock;
      sendToRenderer('chat:token', { requestId: payload.requestId, token: sourceBlock });
    }

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

async function getHuggingFaceTtsModels(): Promise<HuggingFaceTtsModel[]> {
  const store = await readStore();
  const remoteModels = await fetchHuggingFaceTtsModels();
  return mergeHuggingFaceTtsModels(fallbackHuggingFaceTtsModels, remoteModels, store.hfTtsModels);
}

async function fetchHuggingFaceTtsModels(): Promise<HuggingFaceTtsModel[]> {
  try {
    const response = await fetchWithTimeout(
      'https://huggingface.co/api/models?pipeline_tag=text-to-speech&library=transformers.js&sort=downloads&direction=-1&limit=30',
      { headers: { 'User-Agent': 'LocalPersona/0.1.23' } },
      10000
    );
    if (!response.ok) {
      return [];
    }
    const models = (await response.json()) as Array<{
      id?: unknown;
      modelId?: unknown;
      downloads?: unknown;
      likes?: unknown;
      tags?: unknown;
      library_name?: unknown;
    }>;
    return models
      .map((model) => {
        const rawId = String(model.id || model.modelId || '').trim();
        const id = getCompatibleHuggingFaceTtsModelId(rawId);
        if (!id || !isKnownWorkingHuggingFaceTtsModelId(id)) {
          return undefined;
        }
        const inferred = inferHuggingFaceTtsModelMetadata(id);
        return normalizeHuggingFaceTtsModel({
          id,
          name: id.split('/').pop() || id,
          description: inferred.description || 'Hugging Face text-to-speech model compatible with Transformers.js.',
          tags: Array.isArray(model.tags) ? model.tags.map(String).filter((tag) => !tag.startsWith('license:')).slice(0, 6) : ['text-to-speech'],
          downloads: typeof model.downloads === 'number' ? model.downloads : undefined,
          likes: typeof model.likes === 'number' ? model.likes : undefined,
          ...inferred
        });
      })
      .filter((model): model is HuggingFaceTtsModel => Boolean(model));
  } catch {
    return [];
  }
}

async function importHuggingFaceTtsModel(modelId: string): Promise<AppStore> {
  const requestedId = normalizeHuggingFaceModelIdInput(modelId);
  if (!isSafeHuggingFaceModelId(requestedId)) {
    throw new Error('Enter a Hugging Face model id like Xenova/mms-tts-eng or onnx-community/Kokoro-82M-v1.0-ONNX.');
  }

  const id = getCompatibleHuggingFaceTtsModelId(requestedId);
  const modelInfo = await fetchHuggingFaceModelInfo(id);
  const validationError = getHuggingFaceTtsValidationError(id, modelInfo);
  if (validationError) {
    throw new Error(validationError);
  }

  const store = await readStore();
  const inferred = inferHuggingFaceTtsModelMetadata(id);
  const model = normalizeHuggingFaceTtsModel({
    id,
    name: id.split('/').pop() || id,
    description: inferred.description || 'Imported Hugging Face text-to-speech model.',
    tags: Array.from(new Set(['imported', 'text-to-speech', ...getHuggingFaceInfoTags(modelInfo).slice(0, 6)])),
    imported: true,
    downloads: typeof modelInfo?.downloads === 'number' ? modelInfo.downloads : undefined,
    likes: typeof modelInfo?.likes === 'number' ? modelInfo.likes : undefined,
    ...inferred
  });
  if (!model) {
    throw new Error('Could not import that Hugging Face model.');
  }
  store.hfTtsModels = mergeHuggingFaceTtsModels(store.hfTtsModels, [model]);
  await writeStore(store);
  return store;
}

async function importLocalHuggingFaceTtsModel(): Promise<{ canceled: boolean; store?: AppStore }> {
  const result = await dialog.showOpenDialog({
    title: 'Import local Hugging Face TTS model folder',
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const folder = result.filePaths[0];
  const configPath = path.join(folder, 'config.json');
  if (!existsSync(configPath)) {
    throw new Error('That folder does not look like a Hugging Face model folder because config.json was not found.');
  }

  const store = await readStore();
  const name = path.basename(folder);
  const id = `local:${name}:${randomUUID().slice(0, 8)}`;
  const model = normalizeHuggingFaceTtsModel({
    id,
    name,
    description: `Local Hugging Face TTS model from ${folder}`,
    tags: ['local', 'imported', 'text-to-speech'],
    imported: true,
    localPath: folder,
    defaultDtype: 'q8'
  });
  if (!model) {
    throw new Error('Could not import that local model folder.');
  }
  store.hfTtsModels = mergeHuggingFaceTtsModels(store.hfTtsModels, [model]);
  await writeStore(store);
  return { canceled: false, store };
}

async function synthesizeHuggingFaceTts(payload: HuggingFaceTtsPayload): Promise<HuggingFaceTtsResult> {
  const input = payload && typeof payload === 'object' ? (payload as Partial<HuggingFaceTtsPayload>) : {};
  const text = String(input.text || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
  if (!text) {
    throw new Error('No text was provided for Hugging Face TTS.');
  }
  const requestedModel = String(input.model || '').trim();
  if (!requestedModel) {
    throw new Error('Choose a Hugging Face TTS model first.');
  }

  const model = await resolveHuggingFaceTtsModel(requestedModel);
  const modelPath = model.localPath || getCompatibleHuggingFaceTtsModelId(model.id);
  try {
    const dtype = normalizeHfTtsDtype(input.dtype || model.defaultDtype);
    if (isKokoroHuggingFaceTtsModel(model)) {
      return await synthesizeKokoroTts(text, modelPath, dtype, String(input.speakerEmbedding || model.defaultSpeakerEmbedding || '').trim(), model.id);
    }

    const pipelineInstance = (await getHuggingFaceTtsPipeline(modelPath, dtype)) as (
      text: string,
      options?: Record<string, unknown>
    ) => Promise<unknown>;
    const speakerEmbedding = String(input.speakerEmbedding || model.defaultSpeakerEmbedding || '').trim();
    const options = speakerEmbedding ? { speaker_embeddings: speakerEmbedding } : undefined;
    const output = await pipelineInstance(text, options);
    const rawAudio = Array.isArray(output) ? output[0] : output;
    const audioObject = rawAudio && typeof rawAudio === 'object' ? (rawAudio as { data?: unknown; audio?: unknown; sampling_rate?: unknown }) : {};
    const audio = coerceFloatAudio(audioObject.data ?? audioObject.audio);
    const samplingRate = Number(audioObject.sampling_rate || 16000);
    if (!audio || audio.length === 0 || !Number.isFinite(samplingRate)) {
      throw new Error('The Hugging Face TTS model did not return playable audio.');
    }

    const wav = encodePcm16Wav(audio, samplingRate);
    return {
      audioDataUrl: `data:audio/wav;base64,${wav.toString('base64')}`,
      samplingRate,
      model: model.id
    };
  } catch (error) {
    throw new Error(buildHuggingFaceTtsErrorMessage(error, modelPath));
  }
}

async function synthesizeKokoroTts(
  text: string,
  modelPath: string,
  dtype: HuggingFaceTtsDtype,
  requestedVoice: string,
  displayModelId: string
): Promise<HuggingFaceTtsResult> {
  const engine = await getKokoroTtsEngine(modelPath, dtype);
  const voice = normalizeKokoroVoiceId(requestedVoice, engine);
  const output = await engine.generate(text, { voice, speed: 1 });
  const audioObject = output && typeof output === 'object' ? (output as { data?: unknown; audio?: unknown; sampling_rate?: unknown }) : {};
  const audio = coerceFloatAudio(audioObject.data ?? audioObject.audio);
  const samplingRate = Number(audioObject.sampling_rate || 24000);
  if (!audio || audio.length === 0 || !Number.isFinite(samplingRate)) {
    throw new Error('The Kokoro TTS model did not return playable audio.');
  }

  const wav = encodePcm16Wav(audio, samplingRate);
  return {
    audioDataUrl: `data:audio/wav;base64,${wav.toString('base64')}`,
    samplingRate,
    model: displayModelId
  };
}

async function getKokoroTtsEngine(model: string, dtype: HuggingFaceTtsDtype) {
  const cacheKey = `${model}|${dtype}`;
  const existing = kokoroTtsCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    const transformers = require('@huggingface/transformers') as {
      env: {
        allowLocalModels: boolean;
        allowRemoteModels: boolean;
        cacheDir: string;
      };
    };
    transformers.env.allowLocalModels = true;
    transformers.env.allowRemoteModels = true;
    transformers.env.cacheDir = path.join(app.getPath('userData'), 'huggingface-cache');
    await fs.mkdir(transformers.env.cacheDir, { recursive: true });
    const kokoro = require('kokoro-js') as {
      KokoroTTS: {
        from_pretrained: (
          modelId: string,
          options?: { dtype?: HuggingFaceTtsDtype; device?: 'cpu' | 'wasm' | 'webgpu' | null }
        ) => Promise<KokoroTtsEngine>;
      };
    };
    return kokoro.KokoroTTS.from_pretrained(model, { dtype, device: 'cpu' });
  })();

  kokoroTtsCache.set(cacheKey, promise);
  try {
    return await promise;
  } catch (error) {
    kokoroTtsCache.delete(cacheKey);
    throw error;
  }
}

async function resolveHuggingFaceTtsModel(modelId: string) {
  const store = await readStore();
  const compatibleId = getCompatibleHuggingFaceTtsModelId(modelId);
  const models = mergeHuggingFaceTtsModels(fallbackHuggingFaceTtsModels, store.hfTtsModels);
  return (
    models.find((model) => model.id === modelId || model.id === compatibleId) ??
    normalizeHuggingFaceTtsModel({
      id: compatibleId,
      name: compatibleId,
      description: 'Custom Hugging Face text-to-speech model.',
      tags: ['text-to-speech'],
      defaultDtype: 'q8'
    })!
  );
}

async function getHuggingFaceTtsPipeline(model: string, dtype: HuggingFaceTtsDtype) {
  const cacheKey = `${model}|${dtype}`;
  const existing = hfTtsPipelineCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    const transformers = await import('@huggingface/transformers');
    transformers.env.allowLocalModels = true;
    transformers.env.allowRemoteModels = true;
    transformers.env.cacheDir = path.join(app.getPath('userData'), 'huggingface-cache');
    await fs.mkdir(transformers.env.cacheDir, { recursive: true });
    return transformers.pipeline('text-to-speech', model, {
      dtype,
      cache_dir: transformers.env.cacheDir
    });
  })();
  hfTtsPipelineCache.set(cacheKey, promise);
  try {
    return await promise;
  } catch (error) {
    hfTtsPipelineCache.delete(cacheKey);
    throw error;
  }
}

function inferHuggingFaceTtsModelMetadata(id: string): Partial<HuggingFaceTtsModel> {
  const lower = id.toLowerCase();
  if (lower.includes('speecht5')) {
    const { id: _id, name: _name, ...metadata } = fallbackHuggingFaceTtsModels[0];
    return metadata;
  }
  if (lower.includes('mms-tts')) {
    return {
      description: 'Small MMS/VITS text-to-speech model. Often a good fast local choice.',
      tags: ['mms', 'vits', 'transformers.js'],
      defaultDtype: 'q8'
    };
  }
  if (isKokoroHuggingFaceTtsModelId(id)) {
    return {
      description: 'High-quality multi-voice Kokoro ONNX model. Uses the Kokoro runtime for local speech.',
      tags: ['kokoro', 'styletts2', 'onnx', 'transformers.js'],
      defaultDtype: 'q8',
      defaultSpeakerEmbedding: DEFAULT_HF_TTS_KOKORO_VOICE,
      speakers: getKokoroTtsSpeakers()
    };
  }
  return { defaultDtype: 'q8' };
}

function getCompatibleHuggingFaceTtsModelId(value: string) {
  const id = normalizeHuggingFaceModelIdInput(value);
  const lower = id.toLowerCase();
  if (lower === 'microsoft/speecht5_tts' || lower === 'onnx-community/supertonic-tts-onnx') {
    return 'Xenova/speecht5_tts';
  }
  if (/^(?:facebook|matthijs|sanchit-gandhi)\/mms-tts-(?:eng|spa|fra|deu)$/i.test(id)) {
    return `Xenova/${id.split('/')[1]}`;
  }
  return id;
}

function normalizeHuggingFaceModelIdInput(value: unknown) {
  const input = String(value || '').trim();
  try {
    const url = new URL(input);
    if (url.hostname === 'huggingface.co') {
      const [owner, model] = url.pathname.split('/').filter(Boolean);
      if (owner && model) {
        return `${owner}/${model}`;
      }
    }
  } catch {
    undefined;
  }
  return input;
}

function isKnownWorkingHuggingFaceTtsModelId(value: string) {
  return /^Xenova\/(?:speecht5_tts|mms-tts-[a-z0-9_-]+)$/i.test(value) || isKokoroHuggingFaceTtsModelId(value);
}

function isKokoroHuggingFaceTtsModel(model: HuggingFaceTtsModel) {
  return (
    isKokoroHuggingFaceTtsModelId(model.id) ||
    isKokoroHuggingFaceTtsModelId(model.localPath || '') ||
    model.tags.some((tag) => /kokoro/i.test(tag))
  );
}

function isKokoroHuggingFaceTtsModelId(value: string) {
  return /(?:^|[/\\])kokoro-[\w.-]*onnx|onnx-community\/kokoro-82m/i.test(String(value || ''));
}

function getKokoroTtsSpeakers(): HuggingFaceTtsSpeaker[] {
  const voices: Array<[string, string]> = [
    ['af_heart', 'Heart (American female)'],
    ['af_alloy', 'Alloy (American female)'],
    ['af_aoede', 'Aoede (American female)'],
    ['af_bella', 'Bella (American female)'],
    ['af_jessica', 'Jessica (American female)'],
    ['af_kore', 'Kore (American female)'],
    ['af_nicole', 'Nicole (American female)'],
    ['af_nova', 'Nova (American female)'],
    ['af_river', 'River (American female)'],
    ['af_sarah', 'Sarah (American female)'],
    ['af_sky', 'Sky (American female)'],
    ['am_adam', 'Adam (American male)'],
    ['am_echo', 'Echo (American male)'],
    ['am_eric', 'Eric (American male)'],
    ['am_fenrir', 'Fenrir (American male)'],
    ['am_liam', 'Liam (American male)'],
    ['am_michael', 'Michael (American male)'],
    ['am_onyx', 'Onyx (American male)'],
    ['am_puck', 'Puck (American male)'],
    ['am_santa', 'Santa (American male)'],
    ['bf_alice', 'Alice (British female)'],
    ['bf_emma', 'Emma (British female)'],
    ['bf_isabella', 'Isabella (British female)'],
    ['bf_lily', 'Lily (British female)'],
    ['bm_daniel', 'Daniel (British male)'],
    ['bm_fable', 'Fable (British male)'],
    ['bm_george', 'George (British male)'],
    ['bm_lewis', 'Lewis (British male)']
  ];
  return voices.map(([id, name]) => ({ id, name }));
}

function normalizeKokoroVoiceId(value: string, engine: KokoroTtsEngine) {
  const voice = String(value || '').trim() || DEFAULT_HF_TTS_KOKORO_VOICE;
  const availableVoices = engine.voices && typeof engine.voices === 'object' ? engine.voices : undefined;
  if (!availableVoices || Object.prototype.hasOwnProperty.call(availableVoices, voice)) {
    return voice;
  }
  return DEFAULT_HF_TTS_KOKORO_VOICE;
}

function isSafeHuggingFaceModelId(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

async function fetchHuggingFaceModelInfo(modelId: string): Promise<Record<string, unknown> | undefined> {
  try {
    const response = await fetchWithTimeout(
      `https://huggingface.co/api/models/${modelId.split('/').map(encodeURIComponent).join('/')}`,
      { headers: { 'User-Agent': 'LocalPersona/0.1.23' } },
      10000
    );
    if (response.status === 401 || response.status === 403) {
      throw new Error(`${modelId} is private, gated, or requires Hugging Face authentication.`);
    }
    if (!response.ok) {
      return undefined;
    }
    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    if (/private|gated|authentication/i.test(stringifyError(error))) {
      throw error;
    }
    return undefined;
  }
}

function getHuggingFaceTtsValidationError(modelId: string, info?: Record<string, unknown>) {
  const pipeline = typeof info?.pipeline_tag === 'string' ? info.pipeline_tag : '';
  const tags = getHuggingFaceInfoTags(info);
  const config = info?.config && typeof info.config === 'object' ? (info.config as Record<string, unknown>) : {};
  const modelType = typeof config.model_type === 'string' ? config.model_type : '';
  const architectures = Array.isArray(config.architectures) ? config.architectures.map(String) : [];
  const detail = [
    pipeline ? `pipeline: ${pipeline}` : '',
    modelType ? `model type: ${modelType}` : '',
    architectures.length ? `architecture: ${architectures.slice(0, 2).join(', ')}` : ''
  ]
    .filter(Boolean)
    .join(', ');

  const isTextToSpeech =
    pipeline === 'text-to-speech' ||
    tags.includes('text-to-speech') ||
    ['vits', 'speecht5'].includes(modelType.toLowerCase()) ||
    architectures.some((architecture) => /(?:vits|speecht5|texttospeech|text-to-speech)/i.test(architecture));

  if (isTextToSpeech && !isSupportedTransformersJsTtsModelType(modelType, architectures, modelId, tags)) {
    return `${modelId} is a text-to-speech model, but it uses an unsupported custom runtime${detail ? ` (${detail})` : ''}. LocalPersona's Hugging Face voice mode currently supports Transformers.js/ONNX TTS models such as VITS/MMS, SpeechT5, and Kokoro ONNX. This model needs its own Python/Docker server, so use "Import local TTS folder" only after converting it to a compatible local runtime or run it through a separate service integration.`;
  }

  if (isTextToSpeech) {
    return '';
  }

  if (/llama|mistral|gemma|qwen|phi|gpt|bert|t5|falcon|mixtral/i.test(modelType) || /generation|chat|conversational/i.test(pipeline)) {
    return `${modelId} is not a text-to-speech model${detail ? ` (${detail})` : ''}. Add a Hugging Face repo with pipeline tag "text-to-speech", not a chat/LLM model.`;
  }

  if (info) {
    return `${modelId} does not look like a text-to-speech model${detail ? ` (${detail})` : ''}. Add a Hugging Face repo with pipeline tag "text-to-speech".`;
  }

  return '';
}

function getHuggingFaceInfoTags(info?: Record<string, unknown>) {
  return Array.isArray(info?.tags) ? info.tags.map(String).map((tag) => tag.trim()).filter(Boolean) : [];
}

function buildHuggingFaceTtsErrorMessage(error: unknown, modelId: string) {
  const message = stringifyError(error);
  if (/Unauthorized access|Invalid username or password|401/i.test(message)) {
    return `${modelId} is private, gated, or not publicly accessible. Download it from Hugging Face and use "Import local TTS folder", or choose a public Transformers.js/ONNX TTS model.`;
  }
  const unsupportedModelType = message.match(/Unsupported model type:\s*["']?([A-Za-z0-9_-]+)/i)?.[1];
  if (unsupportedModelType) {
    if (/llama/i.test(unsupportedModelType)) {
      return `${modelId} uses a Llama/custom TTS runtime that Transformers.js cannot execute as local TTS. Use a Transformers.js/ONNX TTS model, or run this model through its Python/Docker server and connect LocalPersona to that service in a future custom TTS backend.`;
    }
    if (/style_text_to_speech_2/i.test(unsupportedModelType)) {
      return `${modelId} is a Kokoro/StyleTTS2 ONNX model. LocalPersona should run Kokoro models through kokoro-js; update or re-import the model if this still appears.`;
    }
    return `${modelId} uses unsupported model type "${unsupportedModelType}" for LocalPersona's Hugging Face voice mode. Choose a Transformers.js/ONNX text-to-speech model.`;
  }
  if (/Could not locate file/i.test(message)) {
    return `${modelId} is not packaged in the format Transformers.js needs for local TTS. Use a model with ONNX/Transformers.js files, or download/convert the model and import the local folder. Missing file detail: ${message}`;
  }
  return message;
}

function isSupportedTransformersJsTtsModelType(modelType: string, architectures: string[], modelId: string, tags: string[]) {
  if (isKnownWorkingHuggingFaceTtsModelId(modelId)) {
    return true;
  }
  const normalizedType = modelType.toLowerCase();
  if (['vits', 'speecht5'].includes(normalizedType)) {
    return true;
  }
  if (normalizedType === 'style_text_to_speech_2' && isKokoroHuggingFaceTtsModelId(modelId)) {
    return tags.some((tag) => /(?:onnx|transformers\.js|text-to-speech)/i.test(tag));
  }
  return architectures.some((architecture) => /(?:vits|speecht5)/i.test(architecture));
}

function coerceFloatAudio(value: unknown): Float32Array | undefined {
  if (value instanceof Float32Array) {
    return value;
  }
  if (Array.isArray(value) && value.every((chunk) => chunk instanceof Float32Array)) {
    const totalLength = value.reduce((sum, chunk) => sum + chunk.length, 0);
    const joined = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of value) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    return joined;
  }
  if (ArrayBuffer.isView(value)) {
    return new Float32Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  return undefined;
}

function encodePcm16Wav(samples: Float32Array, sampleRate: number) {
  const bytesPerSample = 2;
  const channelCount = 1;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28);
  buffer.writeUInt16LE(channelCount * bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] || 0));
    buffer.writeInt16LE(Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), 44 + index * 2);
  }

  return buffer;
}

async function cleanupVoiceTranscript(payload: VoiceCleanupPayload): Promise<VoiceCleanupResult> {
  const input = (payload && typeof payload === 'object' ? payload : {}) as Partial<VoiceCleanupPayload>;
  const original = cleanVoiceCleanupText(input.transcript);
  if (!original) {
    return { original: '', corrected: '', changed: false, confidence: 0 };
  }

  const phraseCorrection = applyCommonVoicePhraseCorrections(original);
  if (phraseCorrection !== original && isSafeVoiceCorrection(original, phraseCorrection)) {
    return { original, corrected: phraseCorrection, changed: true, confidence: 0.82 };
  }

  let cleanupModel = '';
  try {
    const status = await ensureOllama();
    if (!status.running) {
      return { original, corrected: original, changed: false, confidence: 0 };
    }

    cleanupModel = await chooseVoiceCleanupModel(String(input.model || ''));
    if (!cleanupModel) {
      return { original, corrected: original, changed: false, confidence: 0 };
    }

    const recentMessages = prepareChatMessages(Array.isArray(input.messages) ? input.messages : [])
      .slice(-8)
      .map((message) => `${message.role}: ${message.content.replace(/\s+/g, ' ').slice(0, 320)}`)
      .join('\n');
    const response = await fetchWithTimeout(
      `${OLLAMA_BASE_URL}/api/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: cleanupModel,
          messages: [
            {
              role: 'system',
              content: [
                'You correct speech recognition transcripts for a voice chat app.',
                'Use conversation context to fix likely ASR mistakes, missing small words, homophones, punctuation, and wrong-word substitutions.',
                'Fix short phrase errors where the heard words form an unnatural phrase but a common phrase fits the request.',
                'Examples: "dog supervision" -> "adult supervision"; "backing soda" -> "baking soda"; "flower" -> "flour" in a recipe; "source pan" -> "saucepan".',
                'Keep corrections local. Usually change only one to three words.',
                'Do not answer the user. Do not add new facts, new requests, or new meaning.',
                'Preserve the user\'s casual style and wording as much as possible.',
                'Return only JSON with this exact shape: {"corrected":"...","confidence":0.0}'
              ].join('\n')
            },
            {
              role: 'user',
              content: [
                `Character name: ${cleanVoiceCleanupText(input.characterName || '') || 'unknown'}`,
                `User name: ${cleanVoiceCleanupText(input.userName || '') || 'unknown'}`,
                'Recent conversation:',
                recentMessages || '(none)',
                '',
                `Raw transcript: ${original}`,
                '',
                'Correct the raw transcript only if you are confident it is a speech recognition mistake. If unsure, return it unchanged with low confidence.'
              ].join('\n')
            }
          ],
          stream: false,
          options: {
            temperature: 0,
            top_p: 0.4,
            repeat_penalty: 1,
            num_predict: 120
          }
        })
      },
      18000
    );

    if (!response.ok) {
      return { original, corrected: original, changed: false, confidence: 0, model: cleanupModel };
    }

    const data = (await response.json()) as { message?: { content?: unknown }; response?: unknown };
    const content = typeof data.message?.content === 'string' ? data.message.content : typeof data.response === 'string' ? data.response : '';
    const parsed = parseVoiceCleanupJson(content, original);
    const corrected = applyCommonVoicePhraseCorrections(cleanVoiceCleanupText(parsed.corrected));
    const confidence = clampNumber(parsed.confidence, 0, 1, 0);
    const changed = normalizeComparableSpeech(corrected) !== normalizeComparableSpeech(original);
    if (!changed) {
      return { original, corrected: original, changed: false, confidence, model: cleanupModel };
    }
    if (confidence < VOICE_CLEANUP_CONFIDENCE_THRESHOLD || !isSafeVoiceCorrection(original, corrected)) {
      return { original, corrected: original, changed: false, confidence, model: cleanupModel };
    }

    return { original, corrected, changed: true, confidence, model: cleanupModel };
  } catch {
    return { original, corrected: original, changed: false, confidence: 0, model: cleanupModel || undefined };
  }
}

async function chooseVoiceCleanupModel(requestedModel: string) {
  const cleanRequestedModel = requestedModel.trim();
  const models = await listLocalModels();
  const modelNames = models.map((model) => model.name);
  const normalizedByName = new Map(modelNames.map((name) => [normalizeModelName(name), name]));
  for (const preferredModel of VOICE_CLEANUP_MODEL_PREFERENCE) {
    const exactMatch = normalizedByName.get(normalizeModelName(preferredModel));
    if (exactMatch) {
      return exactMatch;
    }

    const baseMatch = modelNames.find((name) => normalizeModelName(name).startsWith(`${normalizeModelName(preferredModel)}:`));
    if (baseMatch) {
      return baseMatch;
    }
  }

  return cleanRequestedModel;
}

function parseVoiceCleanupJson(content: string, original: string): { corrected: string; confidence: number } {
  const cleanContent = content
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const candidates = [cleanContent];
  const objectMatch = cleanContent.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    candidates.push(objectMatch[0]);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { corrected?: unknown; confidence?: unknown };
      if (typeof parsed.corrected === 'string') {
        return {
          corrected: parsed.corrected,
          confidence: clampNumber(parsed.confidence, 0, 1, 0)
        };
      }
    } catch {
      undefined;
    }
  }

  const plainCorrection = cleanContent.replace(/^\s*(?:corrected|transcript)\s*:\s*/i, '').trim();
  if (plainCorrection && plainCorrection !== cleanContent && isSafeVoiceCorrection(original, plainCorrection)) {
    return { corrected: plainCorrection, confidence: VOICE_CLEANUP_CONFIDENCE_THRESHOLD };
  }

  return { corrected: original, confidence: 0 };
}

function applyCommonVoicePhraseCorrections(value: string) {
  const replacements: Array<[RegExp, string]> = [
    [/\bdog supervision\b/gi, 'adult supervision'],
    [/\bbacking soda\b/gi, 'baking soda'],
    [/\bbacking powder\b/gi, 'baking powder'],
    [/\bganulated sugar\b/gi, 'granulated sugar'],
    [/\bsource pan\b/gi, 'saucepan'],
    [/\bflower\b/gi, 'flour']
  ];
  let corrected = cleanVoiceCleanupText(value);
  const recipeContext = /\b(?:recipe|bake|baking|cookies?|brownies?|cakes?|bread|dough|batter|oven|sugar|butter|eggs?)\b/i.test(corrected);

  for (const [pattern, replacement] of replacements) {
    if (replacement === 'flour' && !recipeContext) {
      continue;
    }
    corrected = corrected.replace(pattern, replacement);
  }
  return cleanVoiceCleanupText(corrected);
}

function isSafeVoiceCorrection(original: string, corrected: string) {
  const cleanOriginal = cleanVoiceCleanupText(original);
  const cleanCorrected = cleanVoiceCleanupText(corrected);
  if (!cleanOriginal || !cleanCorrected) {
    return false;
  }
  if (/[<>{}\[\]]/.test(cleanCorrected)) {
    return false;
  }
  if (/\b(?:as an ai|i cannot|i can't|sorry,? but|here(?:'s| is) the answer)\b/i.test(cleanCorrected)) {
    return false;
  }
  if (cleanCorrected.length > Math.max(cleanOriginal.length * 1.9, cleanOriginal.length + 80)) {
    return false;
  }

  const originalWords = getSpeechWords(cleanOriginal);
  const correctedWords = getSpeechWords(cleanCorrected);
  if (correctedWords.length > Math.max(originalWords.length + 8, Math.ceil(originalWords.length * 1.8))) {
    return false;
  }
  if (originalWords.length <= 2) {
    return cleanCorrected.length <= Math.max(cleanOriginal.length + 20, 40);
  }

  const overlap = getWordOverlapRatio(originalWords, correctedWords);
  const lengthRatio = Math.min(cleanOriginal.length, cleanCorrected.length) / Math.max(cleanOriginal.length, cleanCorrected.length);
  return overlap >= 0.35 || lengthRatio >= 0.55;
}

function cleanVoiceCleanupText(value: unknown) {
  return String(value || '')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'](.+)["']$/s, '$1')
    .trim();
}

function normalizeComparableSpeech(value: string) {
  return getSpeechWords(value).join(' ');
}

function getSpeechWords(value: string) {
  return value.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

function getWordOverlapRatio(firstWords: string[], secondWords: string[]) {
  const first = new Set(firstWords);
  const second = new Set(secondWords);
  if (first.size === 0 || second.size === 0) {
    return 0;
  }
  let overlap = 0;
  for (const word of first) {
    if (second.has(word)) {
      overlap += 1;
    }
  }
  return overlap / Math.min(first.size, second.size);
}

function normalizeModelName(value: string) {
  return value.trim().toLowerCase();
}

function prepareChatMessages(messages: ChatMessage[]) {
  return messages
    .map((message) => ({ ...message, content: cleanMessageContentForPrompt(message) }))
    .filter((message) => (message.role === 'user' || message.role === 'assistant') && message.content.length > 0);
}

function cleanMessageContentForPrompt(message: ChatMessage) {
  const content = String(message.content || '').trim();
  if (message.role !== 'assistant') {
    return content;
  }

  return stripFakeSearchBoilerplate(stripSourceSections(content)).trim();
}

function cleanUnsupportedWebSearchResponse(content: string) {
  const cleaned = stripFakeSearchBoilerplate(stripSourceSections(content)).trim();
  if (cleaned) {
    return cleaned;
  }
  if (looksLikeFakeSearchResponse(content)) {
    return 'I can answer from general knowledge without searching. Tell me what kind you want, and I can give you a full recipe.';
  }
  return content;
}

function stripSourceSections(value: string) {
  return value.replace(/(?:^|\n)\s*(?:Sources?|References?|Citations?|Further reading|Links?):\s*[\s\S]*$/i, '').trim();
}

function stripFakeSearchBoilerplate(value: string) {
  if (!looksLikeFakeSearchResponse(value)) {
    return value;
  }

  const lines = value.split(/\r?\n/);
  const kept = lines.filter((line, index) => {
    if (index === 0 && /^\s*(?:searching|search results(?: for)?|found online)\b/i.test(line)) {
      return false;
    }
    if (/^\s*\d+\.\s+/i.test(line)) {
      return false;
    }
    if (/^\s*(?:select|choose|pick)\b/i.test(line)) {
      return false;
    }
    return true;
  });
  return kept.join('\n').trim();
}

function looksLikeFakeSearchResponse(value: string) {
  return /^\s*(?:searching|search results(?: for)?|found online)\b/i.test(value.trim());
}

function buildChatOptions(temperature: number) {
  const options: Record<string, number> = {
    temperature,
    top_p: 0.9,
    repeat_penalty: 1.08,
    num_predict: -1
  };

  if (OLLAMA_CHAT_CONTEXT_TOKENS) {
    options.num_ctx = OLLAMA_CHAT_CONTEXT_TOKENS;
  }

  return options;
}

function cancelChat(requestId: string) {
  const controller = activeChatRequests.get(requestId);
  if (!controller) {
    return false;
  }
  controller.abort();
  return true;
}

async function startLocalSpeechRecognition(options?: { phrases?: unknown }): Promise<{ started: boolean; error?: string }> {
  if (process.platform !== 'win32') {
    return { started: false, error: 'Local speech recognition fallback is only available on Windows.' };
  }

  await stopLocalSpeechRecognition();
  speechRecognitionBuffer = '';
  const phrases = Array.isArray(options?.phrases)
    ? options.phrases.map(String).map((phrase) => phrase.trim()).filter(Boolean).slice(0, 12)
    : [];

  try {
    speechRecognitionProcess = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    speechRecognitionProcess.stdin?.end(buildWindowsSpeechRecognitionScript(phrases));
    speechRecognitionProcess.stdout?.on('data', (chunk: Buffer) => handleSpeechRecognitionStdout(chunk.toString()));
    speechRecognitionProcess.stderr?.on('data', (chunk: Buffer) => {
      const message = chunk.toString().trim();
      if (message) {
        sendSpeechRecognitionEvent({ type: 'error', engine: 'windows', message });
      }
    });
    speechRecognitionProcess.on('error', (error) => {
      sendSpeechRecognitionEvent({ type: 'error', engine: 'windows', message: stringifyError(error) });
    });
    speechRecognitionProcess.on('close', () => {
      speechRecognitionProcess = null;
      sendSpeechRecognitionEvent({ type: 'end', engine: 'windows' });
    });
    return { started: true };
  } catch (error) {
    speechRecognitionProcess = null;
    return { started: false, error: stringifyError(error) };
  }
}

async function stopLocalSpeechRecognition() {
  const processToStop = speechRecognitionProcess;
  speechRecognitionProcess = null;
  speechRecognitionBuffer = '';
  if (!processToStop) {
    return false;
  }

  processToStop.kill();
  return true;
}

function handleSpeechRecognitionStdout(text: string) {
  speechRecognitionBuffer += text;
  const lines = speechRecognitionBuffer.split(/\r?\n/);
  speechRecognitionBuffer = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const payload = JSON.parse(trimmed) as LocalSpeechRecognitionEvent;
      sendSpeechRecognitionEvent(payload);
    } catch {
      sendSpeechRecognitionEvent({ type: 'error', engine: 'windows', message: trimmed });
    }
  }
}

function sendSpeechRecognitionEvent(event: LocalSpeechRecognitionEvent) {
  sendToRenderer('speech:event', event);
}

function buildWindowsSpeechRecognitionScript(phrases: string[] = []) {
  return String.raw`
$ErrorActionPreference = 'Stop'
${`$phraseJson = ${powershellString(JSON.stringify(phrases))}`}
function Send-SpeechEvent([string]$Type, [string]$Text = '', [double]$Confidence = 0, [int]$Level = -1, [string]$AudioState = '', [string]$Message = '') {
  $payload = [pscustomobject]@{
    type = $Type
    engine = 'windows'
    transcript = $Text
    alternatives = @($Text)
    confidence = $Confidence
    audioLevel = $Level
    audioState = $AudioState
    isFinal = $Type -eq 'transcript'
    message = $Message
  } | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($payload)
  [Console]::Out.Flush()
}

try {
  Add-Type -AssemblyName System.Speech
  $recognizers = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  if (-not $recognizers -or $recognizers.Count -eq 0) {
    Send-SpeechEvent -Type 'error' -Message 'No Windows speech recognizer is installed.'
    exit 2
  }

  $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine($recognizers[0])
  $recognizer.SetInputToDefaultAudioDevice()
  $phrases = @()
  try {
    $parsedPhrases = $phraseJson | ConvertFrom-Json
    if ($parsedPhrases) {
      $phrases = @($parsedPhrases)
    }
  } catch {}
  if ($phrases.Count -gt 0) {
    $choices = New-Object System.Speech.Recognition.Choices
    $addedChoices = 0
    foreach ($phrase in $phrases) {
      if (-not [string]::IsNullOrWhiteSpace($phrase)) {
        [void]$choices.Add($phrase)
        $addedChoices += 1
      }
    }
    if ($addedChoices -gt 0) {
      $wakeBuilder = New-Object System.Speech.Recognition.GrammarBuilder
      $wakeBuilder.Culture = $recognizer.RecognizerInfo.Culture
      $wakeBuilder.Append($choices)
      $wakeGrammar = New-Object System.Speech.Recognition.Grammar($wakeBuilder)
      $wakeGrammar.Name = 'LocalPersona wake phrases'
      $recognizer.LoadGrammar($wakeGrammar)
    }
  }
  $dictation = New-Object System.Speech.Recognition.DictationGrammar
  $dictation.Name = 'LocalPersona dictation'
  $recognizer.LoadGrammar($dictation)
  $script:lastLevelSent = [DateTime]::MinValue
  $recognizer.add_AudioLevelUpdated({
    param($sender, $eventArgs)
    $now = Get-Date
    if (($now - $script:lastLevelSent).TotalMilliseconds -ge 120) {
      $script:lastLevelSent = $now
      Send-SpeechEvent -Type 'level' -Level $eventArgs.AudioLevel
    }
  })
  $recognizer.add_AudioStateChanged({
    param($sender, $eventArgs)
    Send-SpeechEvent -Type 'level' -AudioState $eventArgs.AudioState.ToString()
  })
  $recognizer.add_SpeechHypothesized({
    param($sender, $eventArgs)
    if ($eventArgs.Result -and $eventArgs.Result.Text) {
      Send-SpeechEvent -Type 'transcript' -Text $eventArgs.Result.Text -Confidence $eventArgs.Result.Confidence
    }
  })
  $recognizer.add_SpeechRecognized({
    param($sender, $eventArgs)
    if ($eventArgs.Result -and $eventArgs.Result.Text) {
      Send-SpeechEvent -Type 'transcript' -Text $eventArgs.Result.Text -Confidence $eventArgs.Result.Confidence
    }
  })
  $recognizer.add_SpeechRecognitionRejected({
    Send-SpeechEvent -Type 'error' -Message 'Speech was heard but not recognized.'
  })
  $recognizer.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
  Send-SpeechEvent -Type 'ready'
  while ($true) {
    Start-Sleep -Milliseconds 200
  }
} catch {
  Send-SpeechEvent -Type 'error' -Message $_.Exception.Message
  exit 1
} finally {
  if ($recognizer) {
    try { $recognizer.RecognizeAsyncCancel() } catch {}
    try { $recognizer.Dispose() } catch {}
  }
}
`;
}

type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
};

type WebPageResult = {
  title: string;
  url: string;
  excerpt: string;
  links: WebSearchResult[];
};

type WebSearchContext = {
  prompt: string;
  sources: WebSearchResult[];
};

function emptyWebSearchContext(): WebSearchContext {
  return { prompt: '', sources: [] };
}

async function buildWebSearchContext(messages: ChatMessage[]) {
  const query = buildWebSearchQuery(messages);
  const userUrls = extractRecentUserUrls(messages);
  if (!query && userUrls.length === 0) {
    return emptyWebSearchContext();
  }

  try {
    const searchResults = query ? await searchWeb(query) : [];
    const userUrlResults = userUrls.map((url) => ({ title: url, url, snippet: 'User-provided link.' }));
    const results = uniqueSources([...userUrlResults, ...searchResults]).slice(0, 6);
    const pages = await browseWebPages(results, query);
    const sources = uniqueSources([
      ...pages.map((page) => ({ title: page.title, url: page.url, snippet: page.excerpt.slice(0, 180) })),
      ...results
    ]);

    if (results.length === 0 && pages.length === 0) {
      return emptyWebSearchContext();
    }

    return {
      prompt: [
        'Web browsing results, hidden:',
        query ? `- Search query: ${JSON.stringify(query)}` : '- No search query was needed; the user provided links.',
        '- You can use the search results, opened page excerpts, and discovered links below.',
        '- Treat opened page excerpts as stronger evidence than bare search snippets.',
        '- If you cite a source in your answer, copy its exact URL from the result. Do not write placeholder links such as [website].',
        '- Do not say "Searching", do not ask the user to select a result, and do not echo raw search result lists.',
        '- Do not write a separate Sources section; the app appends source links automatically.',
        '',
        'Search results:',
        ...(results.length > 0
          ? results.map((result, index) => `${index + 1}. ${result.title}\n   URL: ${result.url}\n   Summary: ${result.snippet || 'No snippet available.'}`)
          : ['None.']),
        '',
        'Opened pages:',
        ...(pages.length > 0
          ? pages.map((page, index) => {
              const links = page.links
                .slice(0, 5)
                .map((link) => `      - ${link.title}: ${link.url}`)
                .join('\n');
              return [
                `${index + 1}. ${page.title}`,
                `   URL: ${page.url}`,
                `   Excerpt: ${page.excerpt || 'No readable text extracted.'}`,
                links ? `   Relevant links found on page:\n${links}` : ''
              ]
                .filter(Boolean)
                .join('\n');
            })
          : ['None.'])
      ].join('\n'),
      sources
    };
  } catch {
    return emptyWebSearchContext();
  }
}

function buildWebSearchQuery(messages: ChatMessage[]) {
  const userMessages = messages
    .filter((message) => message.role === 'user')
    .map((message) => message.content.trim())
    .filter(Boolean);
  const latest = userMessages.at(-1) ?? '';
  if (!latest) {
    return '';
  }

  if (isWebSearchFollowUp(latest) && userMessages.length >= 2) {
    return `${userMessages.at(-2)} ${latest}`.replace(/\s+/g, ' ').trim().slice(0, 240);
  }

  if (!shouldUseWebSearch(latest)) {
    return '';
  }

  return latest.slice(0, 240);
}

function shouldUseWebSearch(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9:/?.&=-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return false;
  }
  if (extractUrlsFromText(value).length > 0) {
    return false;
  }

  const explicitSearch = /\b(?:search|look up|lookup|google|browse|web|internet|online|find me|find a site|find sites|find links?|send links?|provide links?|give links?|sources?|citations?|cite|url|website)\b/.test(normalized);
  const freshnessNeeded = /\b(?:latest|current|currently|today|tonight|yesterday|tomorrow|this week|this month|recent|newest|news|breaking|live|now|updated?|price|stock|weather|forecast|score|schedule|release date|version|download|where can i buy|near me)\b/.test(normalized);
  return explicitSearch || freshnessNeeded;
}

function isWebSearchFollowUp(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (normalized.length > 80) {
    return false;
  }

  return /\b(?:yes|yeah|yep|sure|ok|okay|please|provide|show|send|give|get|links?|sources?|websites?|urls?)\b/.test(normalized)
    && /\b(?:links?|sources?|websites?|urls?)\b/.test(normalized);
}

function buildWebSourceBlock(sources: WebSearchResult[]) {
  if (sources.length === 0) {
    return '';
  }

  return [
    '',
    '',
    'Sources:',
    ...uniqueSources(sources).slice(0, 8).map((source) => `- [${escapeMarkdownLinkText(source.title)}](${source.url})`)
  ].join('\n');
}

function escapeMarkdownLinkText(value: string) {
  return value.replace(/[[\]\\]/g, '\\$&').slice(0, 120);
}

async function searchWeb(query: string): Promise<WebSearchResult[]> {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetchWithTimeout(url, { headers: { 'User-Agent': 'LocalPersona/0.1.23' } }, 8000);
  if (!response.ok) {
    return [];
  }

  return parseDuckDuckGoResults(await response.text()).slice(0, 4);
}

async function browseWebPages(sources: WebSearchResult[], query: string): Promise<WebPageResult[]> {
  const primaryTargets = uniqueSources(sources).filter((source) => isSafeFetchUrl(source.url)).slice(0, 4);
  const primaryPages = await fetchPages(primaryTargets);
  const openedUrls = new Set(primaryPages.map((page) => normalizeComparableUrl(page.url)));
  const followTargets = chooseLinksToExplore(primaryPages, query)
    .filter((link) => !openedUrls.has(normalizeComparableUrl(link.url)))
    .slice(0, 2);
  const followedPages = await fetchPages(followTargets);
  return [...primaryPages, ...followedPages].slice(0, 6);
}

async function fetchPages(sources: WebSearchResult[]) {
  const settled = await Promise.allSettled(sources.map((source) => fetchWebPage(source)));
  return settled.flatMap((result) => (result.status === 'fulfilled' && result.value ? [result.value] : []));
}

async function fetchWebPage(source: WebSearchResult): Promise<WebPageResult | undefined> {
  if (!isSafeFetchUrl(source.url)) {
    return undefined;
  }

  const response = await fetchWithTimeout(
    source.url,
    {
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2',
        'User-Agent': 'LocalPersona/0.1.23'
      }
    },
    7000
  );
  if (!response.ok || !isSafeFetchUrl(response.url || source.url)) {
    return undefined;
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType && !/\b(?:text\/html|application\/xhtml\+xml|text\/plain)\b/i.test(contentType)) {
    return undefined;
  }

  const html = await readResponseTextLimited(response, 700_000);
  const finalUrl = response.url || source.url;
  const title = extractPageTitle(html) || source.title || finalUrl;
  const description = extractMetaDescription(html);
  const text = extractReadablePageText(html);
  const excerpt = [description, text].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 2400);

  if (!excerpt) {
    return undefined;
  }

  return {
    title,
    url: finalUrl,
    excerpt,
    links: extractPageLinks(html, finalUrl, queryTerms(`${source.title} ${source.snippet}`)).slice(0, 12)
  };
}

function chooseLinksToExplore(pages: WebPageResult[], query: string) {
  const terms = queryTerms(query);
  const links = pages.flatMap((page) => page.links);
  return uniqueSources(links)
    .map((link) => ({ link, score: scoreLinkForQuery(link, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.link);
}

function extractRecentUserUrls(messages: ChatMessage[]) {
  return uniqueUrls(
    messages
      .filter((message) => message.role === 'user')
      .slice(-3)
      .flatMap((message) => extractUrlsFromText(message.content))
      .filter(isSafeFetchUrl)
  ).slice(0, 4);
}

function extractUrlsFromText(value: string) {
  const urls: string[] = [];
  const urlRegex = /https?:\/\/[^\s<>"')\]}]+/gi;
  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(value))) {
    urls.push(match[0].replace(/[.,!?;:]+$/g, ''));
  }
  return urls;
}

function extractPageLinks(html: string, baseUrl: string, extraTerms: string[] = []) {
  const links: WebSearchResult[] = [];
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(html)) && links.length < 120) {
    const url = normalizePageLink(match[1], baseUrl);
    if (!url || !isSafeFetchUrl(url)) {
      continue;
    }
    const title = stripHtml(match[2]).slice(0, 140);
    if (!title || isLowValueLink(title, url)) {
      continue;
    }
    links.push({ title, url, snippet: '' });
  }

  const terms = extraTerms.length > 0 ? extraTerms : queryTerms(stripHtml(html).slice(0, 1000));
  return uniqueSources(links)
    .map((link) => ({ link, score: scoreLinkForQuery(link, terms) }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.link);
}

function normalizePageLink(rawHref: string, baseUrl: string) {
  try {
    const url = new URL(decodeHtmlAttribute(rawHref), baseUrl);
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function extractPageTitle(html: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '';
  return stripHtml(title).slice(0, 180);
}

function extractMetaDescription(html: string) {
  const match = html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["'][^>]*>/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:description|og:description)["'][^>]*>/i);
  return match ? decodeHtmlAttribute(match[1]).replace(/\s+/g, ' ').trim().slice(0, 500) : '';
}

function extractReadablePageText(html: string) {
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  return stripHtml(
    body
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<(?:nav|header|footer|form|aside)\b[\s\S]*?<\/(?:nav|header|footer|form|aside)>/gi, ' ')
  ).slice(0, 5000);
}

async function readResponseTextLimited(response: Response, maxBytes: number) {
  const reader = response.body?.getReader();
  if (!reader) {
    return (await response.text()).slice(0, maxBytes);
  }

  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  while (received < maxBytes) {
    const { value, done } = await reader.read();
    if (done || !value) {
      break;
    }
    received += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }
  if (received >= maxBytes) {
    await reader.cancel().catch(() => undefined);
  }
  text += decoder.decode();
  return text;
}

function scoreLinkForQuery(link: WebSearchResult, terms: string[]) {
  if (isLowValueLink(link.title, link.url)) {
    return -10;
  }
  const haystack = `${link.title} ${link.url} ${link.snippet}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (term.length >= 3 && haystack.includes(term)) {
      score += term.length > 5 ? 2 : 1;
    }
  }
  if (/\/(?:docs|guide|manual|reference|article|blog|news|support|learn|library)\b/i.test(link.url)) {
    score += 1;
  }
  return score;
}

function isLowValueLink(title: string, url: string) {
  const value = `${title} ${url}`.toLowerCase();
  return /\b(?:login|sign in|sign up|subscribe|privacy|terms|cookie|facebook|instagram|tiktok|linkedin|youtube|x\.com|twitter)\b/.test(value);
}

function queryTerms(value: string) {
  const stopWords = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'about', 'give', 'show', 'link', 'links', 'source', 'sources']);
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .match(/[a-z0-9]{3,}/g)
        ?.filter((word) => !stopWords.has(word))
        .slice(0, 16) ?? []
    )
  );
}

function uniqueSources(sources: WebSearchResult[]) {
  const found = new Map<string, WebSearchResult>();
  for (const source of sources) {
    const comparableUrl = normalizeComparableUrl(source.url);
    if (comparableUrl && !found.has(comparableUrl)) {
      found.set(comparableUrl, source);
    }
  }
  return Array.from(found.values());
}

function uniqueUrls(urls: string[]) {
  return Array.from(new Map(urls.map((url) => [normalizeComparableUrl(url), url])).values()).filter(Boolean);
}

function normalizeComparableUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href.replace(/\/$/, '').toLowerCase();
  } catch {
    return '';
  }
}

function isSafeFetchUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return false;
    }
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.')
    ) {
      return false;
    }
    const private172 = host.match(/^172\.(\d+)\./);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function parseDuckDuckGoResults(html: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const blockRegex = /<div[^>]+class=["'][^"']*result[^"']*["'][^>]*>([\s\S]*?)(?=<div[^>]+class=["'][^"']*result[^"']*["']|<\/body>)/gi;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockRegex.exec(html)) && results.length < 6) {
    const block = blockMatch[1];
    const linkMatch = block.match(/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) {
      continue;
    }

    const title = stripHtml(linkMatch[2]);
    const resultUrl = normalizeSearchResultUrl(linkMatch[1]);
    const snippetMatch = block.match(/<a[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)
      ?? block.match(/<div[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : '';

    if (title && resultUrl && !results.some((result) => result.url === resultUrl)) {
      results.push({ title, url: resultUrl, snippet });
    }
  }

  return results;
}

function normalizeSearchResultUrl(rawUrl: string) {
  const decoded = decodeHtmlAttribute(rawUrl);
  try {
    const parsed = new URL(decoded, 'https://duckduckgo.com');
    const redirected = parsed.searchParams.get('uddg');
    if (redirected) {
      return redirected;
    }
    return parsed.href;
  } catch {
    return decoded;
  }
}

function decodeHtmlAttribute(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
}

function buildRoleplaySystemPrompt(characterPrompt: string, messages: ChatMessage[], userName?: string, aboutUser?: string, voiceResponse = false) {
  const prompt = characterPrompt.trim();
  const userNameGuide = buildUserNameGuide(userName, 'roleplay');
  const aboutUserGuide = buildAboutUserGuide(aboutUser);
  const userStyle = buildUserStyleGuide(messages);
  const roleBoundary = buildLatestTurnRoleBoundary(messages);
  const sections = [HIDDEN_ROLEPLAY_PROMPT, prompt || 'No character card was provided. Infer a consistent roleplay character from the conversation.'];
  if (userNameGuide) {
    sections.push(userNameGuide);
  }
  if (aboutUserGuide) {
    sections.push(aboutUserGuide);
  }
  if (userStyle) {
    sections.push(userStyle);
  }
  if (roleBoundary) {
    sections.push(roleBoundary);
  }
  if (voiceResponse) {
    sections.push(VOICE_RESPONSE_PROMPT);
  }
  return sections.join('\n\n');
}

function buildAssistantSystemPrompt(characterPrompt: string, messages: ChatMessage[], userName?: string, aboutUser?: string, webContext?: string, voiceResponse = false) {
  const prompt = characterPrompt.trim();
  const userNameGuide = buildUserNameGuide(userName, 'assistant');
  const aboutUserGuide = buildAboutUserGuide(aboutUser);
  const userStyle = buildAssistantStyleGuide(messages);
  const sections = [HIDDEN_ASSISTANT_PROMPT, prompt || 'No extra assistant instructions were provided.'];
  if (userNameGuide) {
    sections.push(userNameGuide);
  }
  if (aboutUserGuide) {
    sections.push(aboutUserGuide);
  }
  if (webContext) {
    sections.push(webContext);
  }
  if (userStyle) {
    sections.push(userStyle);
  }
  if (voiceResponse) {
    sections.push(VOICE_RESPONSE_PROMPT);
  }
  return sections.join('\n\n');
}

function buildUserNameGuide(userName: string | undefined, mode: PromptMode) {
  const cleanName = cleanUserName(userName);
  if (!cleanName) {
    return '';
  }

  const usage =
    mode === 'assistant'
      ? 'Use this name when addressing the user directly, but do not force it into every reply.'
      : 'The character can know and use this name when it fits the relationship and scene, but should not force it into every reply.';

  return ['User profile, hidden:', `- The user's preferred name is ${JSON.stringify(cleanName)}.`, `- ${usage}`].join('\n');
}

function buildAboutUserGuide(aboutUser: string | undefined) {
  const cleanAboutUser = String(aboutUser || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
  if (!cleanAboutUser) {
    return '';
  }

  return [
    'About the user, hidden:',
    `- ${cleanAboutUser}`,
    '- Use this as background for personalization. Do not recite it unless it is directly relevant.'
  ].join('\n');
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

async function buildResponseError(prefix: string, response: Response) {
  const detail = await readResponseErrorDetail(response);
  return new Error(`${prefix}: HTTP ${response.status}${detail ? ` - ${detail}` : ''}`);
}

async function readResponseErrorDetail(response: Response) {
  try {
    const text = (await response.text()).trim();
    if (!text) {
      return '';
    }
    try {
      const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
      const detail = typeof parsed.error === 'string' ? parsed.error : typeof parsed.message === 'string' ? parsed.message : '';
      return compactErrorDetail(detail || text);
    } catch {
      return compactErrorDetail(text);
    }
  } catch {
    return '';
  }
}

function compactErrorDetail(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 600);
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

function parsePositiveInteger(value: unknown) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
