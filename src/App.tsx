import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  Bot,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Cpu,
  Download,
  FileDown,
  FileUp,
  Globe2,
  HardDrive,
  Loader2,
  Mic,
  PackageOpen,
  Phone,
  PhoneOff,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Sun,
  Trash2,
  UserRound,
  Volume2,
  Wand2,
  X
} from 'lucide-react';
import type { KaldiRecognizer, Model as VoskModel } from 'vosk-browser';
import type {
  AppStore,
  CharacterProfile,
  ChatMessage,
  ChatSession,
  HuggingFaceTtsDtype,
  HuggingFaceTtsModel,
  LibraryModel,
  LocalSpeechRecognitionEvent,
  LocalModel,
  OllamaStatus,
  PromptMode,
  PullProgress,
  SpeechRecognitionEngine,
  TtsProvider,
  UpdateStatus
} from './types';

type EditorDraft = Partial<CharacterProfile> & { tagsText?: string };
type ThemeMode = 'dark' | 'light';
type AudioDevice = MediaDeviceInfo;
type SpeechRecognitionConstructor = new () => SpeechRecognition;

type SpeechRecognitionResultLike = {
  readonly length: number;
  readonly isFinal: boolean;
  readonly [index: number]: { transcript: string };
};

type SpeechRecognitionEventLike = Event & {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    readonly [index: number]: SpeechRecognitionResultLike;
  };
};

type SpeechRecognition = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives?: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type CallPhase = 'off' | 'waiting' | 'listening' | 'thinking' | 'speaking';
type SendMessageOptions = { voiceResponse?: boolean };
type SendMessageResult = { content: string; speechText?: string };

const avatarColors = ['#1f7a70', '#5750c9', '#c15a32', '#2f6fae', '#8a5a16', '#7b3f75', '#4e6b31', '#b9434a'];
const THEME_STORAGE_KEY = 'localpersona-theme';
const MODELS_SIDEBAR_HIDDEN_KEY = 'localpersona-models-sidebar-hidden';
const OLLAMA_BROWSER_COLLAPSED_KEY = 'localpersona-ollama-browser-collapsed';
const TTS_BROWSER_COLLAPSED_KEY = 'localpersona-tts-browser-collapsed';
const APP_VERSION = __APP_VERSION__;
const VOSK_MODEL_URL = 'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz';
const VOSK_SAMPLE_RATE = 16000;
const PROMPT_SILENCE_MS = 3200;
const SHORT_PROMPT_SILENCE_MS = 4500;
const STOP_PROMPT_SILENCE_MS = 900;
const MAX_PROMPT_LISTEN_MS = 18000;

function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => loadTheme());
  const [store, setStore] = useState<AppStore | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [libraryModels, setLibraryModels] = useState<LibraryModel[]>([]);
  const [hfTtsModels, setHfTtsModels] = useState<HuggingFaceTtsModel[]>([]);
  const [characterQuery, setCharacterQuery] = useState('');
  const [modelQuery, setModelQuery] = useState('');
  const [hfTtsQuery, setHfTtsQuery] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [customHfTtsModel, setCustomHfTtsModel] = useState('');
  const [draft, setDraft] = useState('');
  const [editorDraft, setEditorDraft] = useState<EditorDraft | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [variantSelections, setVariantSelections] = useState<Record<string, string>>({});
  const [pullProgress, setPullProgress] = useState<Record<string, PullProgress>>({});
  const [installLines, setInstallLines] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [modelsSidebarHidden, setModelsSidebarHidden] = useState(() => loadBooleanSetting(MODELS_SIDEBAR_HIDDEN_KEY, false));
  const [ollamaBrowserCollapsed, setOllamaBrowserCollapsed] = useState(() => loadBooleanSetting(OLLAMA_BROWSER_COLLAPSED_KEY, false));
  const [ttsBrowserCollapsed, setTtsBrowserCollapsed] = useState(() => loadBooleanSetting(TTS_BROWSER_COLLAPSED_KEY, false));
  const [callPhase, setCallPhase] = useState<CallPhase>('off');
  const [callTranscript, setCallTranscript] = useState('');
  const [callError, setCallError] = useState('');
  const [micLevel, setMicLevel] = useState(0);

  const autoInstallStarted = useRef(false);
  const messageListRef = useRef<HTMLElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const currentRequestId = useRef<string | null>(null);
  const currentSessionId = useRef<string | null>(null);
  const currentAssistantId = useRef<string | null>(null);
  const currentVoiceRequestId = useRef<string | null>(null);
  const storeRef = useRef<AppStore | null>(null);
  const activeCharacterRef = useRef<CharacterProfile | undefined>(undefined);
  const activeSessionRef = useRef<ChatSession | undefined>(undefined);
  const selectedModelRef = useRef('');
  const effectiveUserNameRef = useRef('');
  const promptModeRef = useRef<PromptMode>('roleplay');
  const streamingRef = useRef(false);
  const callActiveRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const systemRecognitionActiveRef = useRef(false);
  const systemRecognitionCallbackRef = useRef<((transcript: string, alternatives: string[]) => void) | null>(null);
  const voskModelRef = useRef<VoskModel | null>(null);
  const voskModelLoadingRef = useRef<Promise<VoskModel> | null>(null);
  const voskRecognizerRef = useRef<KaldiRecognizer | null>(null);
  const voskSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const voskProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const voskOutputRef = useRef<GainNode | null>(null);
  const voskRecognitionCallbackRef = useRef<((transcript: string, alternatives: string[]) => void) | null>(null);
  const voskFinalTranscriptRef = useRef('');
  const callModeRef = useRef<'wake' | 'prompt'>('wake');
  const promptTranscriptRef = useRef('');
  const promptFirstTranscriptAtRef = useRef(0);
  const promptLastNormalizedTranscriptRef = useRef('');
  const silenceTimerRef = useRef<number | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserFrameRef = useRef<number | null>(null);
  const currentTtsAudioRef = useRef<HTMLAudioElement | null>(null);
  const [showJumpButton, setShowJumpButton] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    saveBooleanSetting(MODELS_SIDEBAR_HIDDEN_KEY, modelsSidebarHidden);
  }, [modelsSidebarHidden]);

  useEffect(() => {
    saveBooleanSetting(OLLAMA_BROWSER_COLLAPSED_KEY, ollamaBrowserCollapsed);
  }, [ollamaBrowserCollapsed]);

  useEffect(() => {
    saveBooleanSetting(TTS_BROWSER_COLLAPSED_KEY, ttsBrowserCollapsed);
  }, [ttsBrowserCollapsed]);

  useEffect(() => {
    const offInstall = window.localAI.onInstallLog((line) => {
      const parts = line.split(/\r?\n/).map((part) => part.trim()).filter(Boolean);
      setInstallLines((previous) => [...previous, ...parts].slice(-8));
    });
    const offPull = window.localAI.onPullProgress((progress) => {
      setPullProgress((previous) => ({ ...previous, [progress.model]: progress }));
    });
    const offChat = window.localAI.onChatToken(({ requestId, token }) => {
      if (requestId !== currentRequestId.current || !currentSessionId.current || !currentAssistantId.current) {
        return;
      }
      if (requestId === currentVoiceRequestId.current) {
        return;
      }
      setStore((previous) => {
        if (!previous) {
          return previous;
        }
        return updateSessionInStore(previous, currentSessionId.current!, (session) => ({
          ...session,
          messages: session.messages.map((message) =>
            message.id === currentAssistantId.current ? appendTokenToMessage(message, token) : message
          )
        }));
      });
    });
    const offUpdate = window.localAI.onUpdateStatus((status) => setUpdateStatus(status));
    const offSpeech = window.localAI.onSpeechRecognitionEvent(handleLocalSpeechRecognitionEvent);
    void window.localAI.getUpdateStatus().then(setUpdateStatus).catch(() => undefined);

    return () => {
      offInstall();
      offPull();
      offChat();
      offSpeech();
      offUpdate();
    };
  }, []);

  useEffect(() => {
    void boot();
  }, []);

  useEffect(() => {
    const loadVoices = () => setVoices(window.speechSynthesis?.getVoices() ?? []);
    loadVoices();
    window.speechSynthesis?.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', loadVoices);
  }, []);

  const activeCharacter = useMemo(() => {
    if (!store) {
      return undefined;
    }
    return store.characters.find((character) => character.id === store.selectedCharacterId) ?? store.characters[0];
  }, [store]);

  const activeSession = useMemo(() => {
    if (!store || !activeCharacter) {
      return undefined;
    }
    const selectedSession = store.selectedSessionId
      ? store.sessions.find((session) => session.id === store.selectedSessionId && session.characterId === activeCharacter.id)
      : undefined;
    return selectedSession ?? getLatestSessionForCharacter(store.sessions, activeCharacter.id);
  }, [activeCharacter, store]);

  const selectedModel = store?.selectedModel || localModels[0]?.name || '';
  const effectiveUserName = getEffectiveUserName(store, activeCharacter);
  const displayUserName = effectiveUserName || 'You';
  const promptMode = activeCharacter?.promptMode ?? 'roleplay';
  const voiceFeaturesEnabled = Boolean(store?.experimentalVoiceFeatures);

  useEffect(() => {
    storeRef.current = store;
    activeCharacterRef.current = activeCharacter;
    activeSessionRef.current = activeSession;
    selectedModelRef.current = selectedModel;
    effectiveUserNameRef.current = effectiveUserName;
    promptModeRef.current = promptMode;
    streamingRef.current = streaming;
  }, [activeCharacter, activeSession, effectiveUserName, promptMode, selectedModel, store, streaming]);

  useEffect(() => {
    return () => stopCallMode();
  }, []);

  const filteredCharacters = useMemo(() => {
    if (!store) {
      return [];
    }
    const query = characterQuery.trim().toLowerCase();
    if (!query) {
      return store.characters;
    }
    return store.characters.filter((character) =>
      [character.name, character.subtitle, character.description, ...character.tags].join(' ').toLowerCase().includes(query)
    );
  }, [characterQuery, store]);

  const filteredLibraryModels = useMemo(() => {
    const query = modelQuery.trim().toLowerCase();
    if (!query) {
      return libraryModels;
    }
    return libraryModels.filter((model) =>
      [model.name, model.description, ...model.tags, ...model.variants].join(' ').toLowerCase().includes(query)
    );
  }, [libraryModels, modelQuery]);

  const filteredHfTtsModels = useMemo(() => {
    const query = hfTtsQuery.trim().toLowerCase();
    if (!query) {
      return hfTtsModels;
    }
    return hfTtsModels.filter((model) =>
      [model.id, model.name, model.description, ...(model.tags ?? [])].join(' ').toLowerCase().includes(query)
    );
  }, [hfTtsModels, hfTtsQuery]);

  useEffect(() => {
    if (voiceFeaturesEnabled && hfTtsModels.length === 0) {
      void refreshHuggingFaceTtsModels();
    }
  }, [hfTtsModels.length, voiceFeaturesEnabled]);

  const localModelNames = useMemo(() => new Set(localModels.map((model) => model.name)), [localModels]);
  const displayedMessages = buildDisplayedMessages(activeCharacter, activeSession);
  const latestMessageKey = displayedMessages
    .map((message) => `${message.id}:${message.role}:${message.content.length}:${message.variantIndex ?? 0}`)
    .join('|');

  useEffect(() => {
    const element = messageListRef.current;
    if (!element) {
      return;
    }

    const updateJumpState = () => setShowJumpButton(!isNearBottom(element));
    updateJumpState();
    element.addEventListener('scroll', updateJumpState, { passive: true });
    return () => element.removeEventListener('scroll', updateJumpState);
  }, [activeCharacter?.id, activeSession?.id]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => scrollToLastMessage(streaming ? 'auto' : 'smooth'));
    return () => window.cancelAnimationFrame(frame);
  }, [latestMessageKey, streaming]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || editorDraft) {
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
        return;
      }

      event.preventDefault();
      void switchChat(event.key === 'ArrowDown' ? 1 : -1);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSession?.id, editorDraft, store, streaming]);

  useEffect(() => {
    if (settingsOpen && voiceFeaturesEnabled) {
      void refreshAudioDevices();
    }
  }, [settingsOpen, voiceFeaturesEnabled]);

  async function boot() {
    setBusy(true);
    try {
      const [loadedStore, models] = await Promise.all([
        window.localAI.loadStore(),
        window.localAI.getLibraryModels()
      ]);
      const ttsModels = loadedStore.experimentalVoiceFeatures ? await window.localAI.listHuggingFaceTtsModels() : [];
      setStore(loadedStore);
      setLibraryModels(models);
      setHfTtsModels(ttsModels);

      const status = await window.localAI.getOllamaStatus();
      setOllamaStatus(status);

      if (!status.installed && !autoInstallStarted.current) {
        autoInstallStarted.current = true;
        setInstalling(true);
        const installedStatus = await window.localAI.installOllama();
        setOllamaStatus(installedStatus);
        setInstalling(false);
      } else if (status.installed && !status.running) {
        const ensuredStatus = await window.localAI.ensureOllama();
        setOllamaStatus(ensuredStatus);
      }

      await refreshLocalModels();
    } catch (error) {
      setNotice(errorMessage(error));
      setInstalling(false);
    } finally {
      setBusy(false);
    }
  }

  async function refreshStatusAndModels() {
    setBusy(true);
    try {
      const status = await window.localAI.ensureOllama();
      setOllamaStatus(status);
      await refreshLocalModels();
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function refreshLocalModels() {
    const models = await window.localAI.listLocalModels();
    setLocalModels(models);
    setStore((previous) => {
      if (!previous || previous.selectedModel || models.length === 0) {
        return previous;
      }
      return { ...previous, selectedModel: models[0].name };
    });
  }

  async function refreshAudioDevices(requestPermission = false) {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setCallError('Audio devices are not available in this environment.');
      return;
    }

    let permissionStream: MediaStream | null = null;
    try {
      if (requestPermission) {
        permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      setAudioDevices(await navigator.mediaDevices.enumerateDevices());
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      permissionStream?.getTracks().forEach((track) => track.stop());
    }
  }

  async function saveSettings(settings: Partial<AppStore>, nextTheme?: ThemeMode) {
    if (nextTheme) {
      setTheme(nextTheme);
    }
    if (settings.experimentalVoiceFeatures === false && callPhase !== 'off') {
      stopCallMode();
    }
    const savedStore = await window.localAI.updateSettings(settings);
    storeRef.current = savedStore;
    setStore(savedStore);
    setNotice('Settings saved.');
  }

  async function checkForUpdates() {
    setUpdateStatus((previous) => ({ ...previous, state: 'checking', message: 'Checking for updates.' }));
    try {
      setUpdateStatus(await window.localAI.checkForUpdates());
    } catch (error) {
      setUpdateStatus((previous) => ({ ...previous, state: 'error', message: errorMessage(error) }));
    }
  }

  async function downloadUpdate() {
    setUpdateStatus((previous) => ({ ...previous, state: 'downloading', percent: 0, message: 'Starting update download.' }));
    try {
      setUpdateStatus(await window.localAI.downloadUpdate());
    } catch (error) {
      setUpdateStatus((previous) => ({ ...previous, state: 'error', message: errorMessage(error) }));
    }
  }

  async function installUpdate() {
    try {
      await window.localAI.installUpdate();
    } catch (error) {
      setUpdateStatus((previous) => ({ ...previous, state: 'error', message: errorMessage(error) }));
    }
  }

  async function selectCharacter(characterId: string) {
    if (!store) {
      return;
    }
    const nextSession = getLatestSessionForCharacter(store.sessions, characterId);
    setStore(await window.localAI.updateSettings({ selectedCharacterId: characterId, selectedSessionId: nextSession?.id ?? '' }));
  }

  async function selectModel(model: string) {
    if (!store || !model) {
      return;
    }
    if (streaming) {
      setNotice('Wait for the current response to finish before changing models.');
      return;
    }
    setStore(await window.localAI.updateSettings({ selectedModel: model }));
  }

  async function switchChat(direction: -1 | 1) {
    if (!store) {
      return;
    }
    if (streaming) {
      setNotice('Wait for the current response to finish before switching chats.');
      return;
    }

    const sessions = getOrderedSessions(store.sessions);
    if (sessions.length < 2) {
      return;
    }

    const currentId = activeSession?.id ?? store.selectedSessionId;
    const currentIndex = Math.max(0, sessions.findIndex((session) => session.id === currentId));
    const nextSession = sessions[wrapIndex(currentIndex + direction, sessions.length)];
    setStore(
      await window.localAI.updateSettings({
        selectedCharacterId: nextSession.characterId,
        selectedSessionId: nextSession.id,
        selectedModel: nextSession.model || store.selectedModel
      })
    );
  }

  async function saveCharacter(character: Partial<CharacterProfile>) {
    setStore(await window.localAI.saveCharacter(character));
    setEditorDraft(null);
    setNotice('Character saved.');
  }

  async function deleteCharacter(characterId: string) {
    if (!window.confirm('Delete this character and its chats?')) {
      return false;
    }
    setStore(await window.localAI.deleteCharacter(characterId));
    return true;
  }

  async function exportWorkspace() {
    const result = await window.localAI.exportStore();
    if (!result.canceled) {
      setNotice('Workspace exported.');
    }
  }

  async function importWorkspace() {
    const result = await window.localAI.importStore();
    if (!result.skipped && result.store) {
      setStore(result.store);
      setNotice(`Imported ${result.importedCharacters} characters and ${result.importedSessions} chats.`);
    }
  }

  async function pullModel(modelName: string) {
    if (streaming) {
      setNotice('Wait for the current response to finish before pulling or switching models.');
      return;
    }
    const cleanModel = modelName.trim();
    if (!cleanModel) {
      return;
    }
    setNotice('');
    setPullProgress((previous) => ({ ...previous, [cleanModel]: { model: cleanModel, status: 'Queued' } }));
    try {
      const models = await window.localAI.pullModel(cleanModel);
      setLocalModels(models);
      await selectModel(cleanModel);
      setNotice(`${cleanModel} is ready.`);
    } catch (error) {
      setPullProgress((previous) => ({ ...previous, [cleanModel]: { model: cleanModel, status: errorMessage(error) } }));
    }
  }

  async function refreshHuggingFaceTtsModels() {
    try {
      setHfTtsModels(await window.localAI.listHuggingFaceTtsModels());
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }

  async function importHuggingFaceTtsModel(modelId: string) {
    const cleanModel = modelId.trim();
    if (!cleanModel) {
      return;
    }

    try {
      const savedStore = await window.localAI.importHuggingFaceTtsModel(cleanModel);
      storeRef.current = savedStore;
      setStore(savedStore);
      setCustomHfTtsModel('');
      await refreshHuggingFaceTtsModels();
      setNotice(`${cleanModel} was added to Hugging Face TTS.`);
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }

  async function importLocalHuggingFaceTtsModel() {
    try {
      const result = await window.localAI.importLocalHuggingFaceTtsModel();
      if (result.canceled) {
        return;
      }
      if (result.store) {
        storeRef.current = result.store;
        setStore(result.store);
      }
      await refreshHuggingFaceTtsModels();
      setNotice('Local Hugging Face TTS model imported.');
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }

  async function useHuggingFaceTtsModel(model: HuggingFaceTtsModel) {
    const character = activeCharacterRef.current;
    if (!character) {
      return;
    }

    const speaker = model.speakers?.[0]?.embedding || model.defaultSpeakerEmbedding || '';
    const savedStore = await window.localAI.saveCharacter({
      ...character,
      ttsProvider: 'huggingface',
      hfTtsModel: model.id,
      hfTtsSpeaker: speaker,
      hfTtsDtype: model.defaultDtype ?? 'q8'
    });
    storeRef.current = savedStore;
    setStore(savedStore);
    setNotice(`${character.name} will use ${model.name} for call voice.`);
  }

  async function sendMessageFromText(text: string, options: SendMessageOptions = {}): Promise<SendMessageResult | undefined> {
    const cleanText = text.trim();
    const currentStore = storeRef.current;
    const currentCharacter = activeCharacterRef.current;
    const currentSession = activeSessionRef.current;
    const currentModel = selectedModelRef.current;
    const currentPromptMode = promptModeRef.current;
    const currentUserName = effectiveUserNameRef.current;
    if (!currentStore || !currentCharacter || !currentModel || !cleanText || streamingRef.current) {
      return undefined;
    }

    const requestId = createId();
    const baseSession = currentSession ?? createSession(currentCharacter, currentModel);
    const baseMessages = baseSession.messages.length > 0 ? baseSession.messages : initialMessages(currentCharacter);
    const userMessage: ChatMessage = {
      id: createId(),
      role: 'user',
      content: cleanText,
      createdAt: new Date().toISOString()
    };
    const assistantMessage: ChatMessage = {
      id: createId(),
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString()
    };
    const pendingSession: ChatSession = {
      ...baseSession,
      model: currentModel,
      messages: [...baseMessages, userMessage, assistantMessage],
      updatedAt: new Date().toISOString()
    };

    currentRequestId.current = requestId;
    currentSessionId.current = pendingSession.id;
    currentAssistantId.current = assistantMessage.id;
    currentVoiceRequestId.current = options.voiceResponse ? requestId : null;
    activeSessionRef.current = pendingSession;
    streamingRef.current = true;
    setStreaming(true);
    setDraft('');
    const pendingStore = upsertSessionInStore(currentStore, pendingSession);
    storeRef.current = pendingStore;
    setStore(pendingStore);

    try {
      const response = await window.localAI.sendChat({
        requestId,
        model: currentModel,
        systemPrompt: currentCharacter.systemPrompt,
        userName: currentUserName,
        aboutUser: currentCharacter.aboutUser,
        messages: normalizeMessagesForPrompt([...baseMessages, userMessage]),
        temperature: currentCharacter.temperature,
        promptMode: currentPromptMode,
        webSearchEnabled: Boolean(currentCharacter.webSearchEnabled && currentPromptMode === 'assistant'),
        voiceResponse: Boolean(options.voiceResponse)
      });
      const rawAssistantContent = response.content || 'No response.';
      const assistantContent = stripVoiceSpeechMarkers(rawAssistantContent) || 'No response.';
      const speechText = options.voiceResponse ? extractVoiceSpeechText(rawAssistantContent) : undefined;
      const finalSession: ChatSession = {
        ...pendingSession,
        messages: [...baseMessages, userMessage, { ...assistantMessage, content: assistantContent, variants: [assistantContent], variantIndex: 0 }],
        updatedAt: new Date().toISOString()
      };
      const savedStore = await window.localAI.saveSession(finalSession);
      activeSessionRef.current = finalSession;
      storeRef.current = savedStore;
      setStore(savedStore);
      return { content: assistantContent, speechText };
    } catch (error) {
      const assistantContent = `Error: ${errorMessage(error)}`;
      const failedSession: ChatSession = {
        ...pendingSession,
        messages: [...baseMessages, userMessage, { ...assistantMessage, content: assistantContent, variants: [assistantContent], variantIndex: 0 }],
        updatedAt: new Date().toISOString()
      };
      const savedStore = await window.localAI.saveSession(failedSession);
      activeSessionRef.current = failedSession;
      storeRef.current = savedStore;
      setStore(savedStore);
      return undefined;
    } finally {
      currentRequestId.current = null;
      currentSessionId.current = null;
      currentAssistantId.current = null;
      currentVoiceRequestId.current = null;
      streamingRef.current = false;
      setStreaming(false);
    }
  }

  async function sendMessage() {
    await sendMessageFromText(draft);
  }

  async function regenerateMessage(messageId: string) {
    if (!store || !activeSession || !activeCharacter || !selectedModel || streaming) {
      return;
    }

    const messageIndex = activeSession.messages.findIndex((message) => message.id === messageId);
    const targetMessage = activeSession.messages[messageIndex];
    if (messageIndex < 0 || targetMessage?.role !== 'assistant') {
      return;
    }

    const requestId = createId();
    const oldVersions = getMessageVersions(targetMessage);
    const pendingVersionIndex = oldVersions.length;
    const pendingMessage: ChatMessage = {
      ...targetMessage,
      content: '',
      variants: [...oldVersions, ''],
      variantIndex: pendingVersionIndex
    };
    const pendingSession: ChatSession = {
      ...activeSession,
      model: selectedModel,
      messages: activeSession.messages.map((message) => (message.id === messageId ? pendingMessage : message)),
      updatedAt: new Date().toISOString()
    };
    const contextMessages = normalizeMessagesForPrompt(activeSession.messages.slice(0, messageIndex));

    currentRequestId.current = requestId;
    currentSessionId.current = activeSession.id;
    currentAssistantId.current = messageId;
    streamingRef.current = true;
    setStreaming(true);
    activeSessionRef.current = pendingSession;
    const pendingStore = upsertSessionInStore(store, pendingSession);
    storeRef.current = pendingStore;
    setStore(pendingStore);

    try {
      const response = await window.localAI.sendChat({
        requestId,
        model: selectedModel,
        systemPrompt: activeCharacter.systemPrompt,
        userName: effectiveUserName,
        aboutUser: activeCharacter.aboutUser,
        messages: contextMessages,
        temperature: activeCharacter.temperature,
        promptMode,
        webSearchEnabled: Boolean(activeCharacter.webSearchEnabled && promptMode === 'assistant')
      });
      const content = response.content || 'No response.';
      const finalMessage: ChatMessage = {
        ...targetMessage,
        content,
        variants: [...oldVersions, content],
        variantIndex: oldVersions.length
      };
      const finalSession: ChatSession = {
        ...pendingSession,
        messages: pendingSession.messages.map((message) => (message.id === messageId ? finalMessage : message)),
        updatedAt: new Date().toISOString()
      };
      const savedStore = await window.localAI.saveSession(finalSession);
      activeSessionRef.current = finalSession;
      storeRef.current = savedStore;
      setStore(savedStore);
    } catch (error) {
      const content = `Error: ${errorMessage(error)}`;
      const failedMessage: ChatMessage = {
        ...targetMessage,
        content,
        variants: [...oldVersions, content],
        variantIndex: oldVersions.length
      };
      const failedSession: ChatSession = {
        ...pendingSession,
        messages: pendingSession.messages.map((message) => (message.id === messageId ? failedMessage : message)),
        updatedAt: new Date().toISOString()
      };
      const savedStore = await window.localAI.saveSession(failedSession);
      activeSessionRef.current = failedSession;
      storeRef.current = savedStore;
      setStore(savedStore);
    } finally {
      currentRequestId.current = null;
      currentSessionId.current = null;
      currentAssistantId.current = null;
      streamingRef.current = false;
      setStreaming(false);
    }
  }

  async function changeMessageVersion(messageId: string, direction: -1 | 1) {
    if (!activeSession || streaming) {
      return;
    }

    const updatedSession: ChatSession = {
      ...activeSession,
      messages: activeSession.messages.map((message) => {
        if (message.id !== messageId || message.role !== 'assistant') {
          return message;
        }

        const versions = getMessageVersions(message);
        const currentIndex = getMessageVersionIndex(message);
        const nextIndex = clamp(currentIndex + direction, 0, versions.length - 1);
        return {
          ...message,
          content: versions[nextIndex],
          variants: versions,
          variantIndex: nextIndex
        };
      }),
      updatedAt: new Date().toISOString()
    };

    setStore(await window.localAI.saveSession(updatedSession));
  }

  async function resetChat() {
    if (!activeSession) {
      return;
    }
    setStore(await window.localAI.deleteSession(activeSession.id));
  }

  async function stopGeneration() {
    if (!currentRequestId.current) {
      return;
    }
    await window.localAI.cancelChat(currentRequestId.current);
  }

  async function toggleCallMode() {
    if (callPhase === 'off') {
      await startCallMode();
      return;
    }
    stopCallMode();
  }

  function handleLocalSpeechRecognitionEvent(event: LocalSpeechRecognitionEvent) {
    if (!callActiveRef.current || event.engine !== 'windows') {
      return;
    }
    if (event.type === 'ready') {
      setCallError('');
      setCallTranscript('Mic ready');
      setMicLevel(0);
      return;
    }
    if (event.type === 'level') {
      setMicLevel(clamp(Number(event.audioLevel ?? 0) / 100, 0, 1));
      return;
    }
    if (event.type === 'error') {
      if (event.message && event.message !== 'Speech was heard but not recognized.') {
        setCallError(event.message);
      }
      return;
    }
    if (event.type === 'transcript' && event.transcript) {
      const alternatives = event.alternatives?.length ? event.alternatives : [event.transcript];
      systemRecognitionCallbackRef.current?.(event.transcript, alternatives);
    }
  }

  async function startCallMode() {
    if (!storeRef.current?.experimentalVoiceFeatures || !activeCharacter?.callEnabled) {
      return;
    }

    try {
      const Recognition = getSpeechRecognitionConstructor();
      setCallError('');
      setCallTranscript('');
      setMicLevel(0);
      void refreshAudioDevices();
      if (getSpeechRecognitionEngine() !== 'windows') {
        await prepareMicrophone();
      }
      callActiveRef.current = true;
      setCallPhase('waiting');
      startWakeListening(Recognition);
    } catch (error) {
      setCallError(errorMessage(error));
      stopCallMode();
    }
  }

  function stopCallMode() {
    callActiveRef.current = false;
    clearSilenceTimer();
    stopRecognition();
    stopMicMeter();
    window.speechSynthesis?.cancel();
    stopCurrentTtsAudio();
    promptTranscriptRef.current = '';
    promptFirstTranscriptAtRef.current = 0;
    promptLastNormalizedTranscriptRef.current = '';
    setCallTranscript('');
    setCallPhase('off');
    setMicLevel(0);
  }

  async function prepareMicrophone(): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone access is not available.');
    }

    stopMicMeter();
    const deviceId = storeRef.current?.selectedInputDeviceId;
    const audio: MediaTrackConstraints = deviceId
      ? { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, channelCount: 1, sampleRate: VOSK_SAMPLE_RATE }
      : { echoCancellation: true, noiseSuppression: true, channelCount: 1, sampleRate: VOSK_SAMPLE_RATE };
    const stream = await navigator.mediaDevices.getUserMedia({ audio });
    mediaStreamRef.current = stream;
    void refreshAudioDevices();
    startMicMeter(stream);
    return stream;
  }

  function startWakeListening(Recognition = getSpeechRecognitionConstructor()) {
    if (!callActiveRef.current) {
      return;
    }

    callModeRef.current = 'wake';
    const character = activeCharacterRef.current;
    const phrase = normalizeWakePhrase(character?.activationPhrase || `hey ${character?.name || 'there'}`);
    const wakePhrases = buildWakePhraseVariants(phrase);
    startRecognition(Recognition, (transcript, alternatives) => {
      setCallError('');
      setCallTranscript(transcript ? `Heard: ${transcript}` : '');
      if (phrase && matchesActivationPhrase(phrase, alternatives)) {
        void handleWakePhrase();
      }
    }, wakePhrases);
  }

  async function handleWakePhrase() {
    if (!callActiveRef.current || callModeRef.current !== 'wake') {
      return;
    }

    callModeRef.current = 'prompt';
    stopRecognition();
    setCallTranscript('');
    setCallPhase('speaking');
    const character = activeCharacterRef.current;
    await speakText(character?.activationResponse || 'yes?', character);
    if (!callActiveRef.current) {
      return;
    }
    promptTranscriptRef.current = '';
    setCallPhase('listening');
    startPromptListening();
  }

  function startPromptListening(Recognition = getSpeechRecognitionConstructor()) {
    if (!callActiveRef.current) {
      return;
    }

    callModeRef.current = 'prompt';
    promptTranscriptRef.current = '';
    promptFirstTranscriptAtRef.current = 0;
    promptLastNormalizedTranscriptRef.current = '';
    setCallTranscript('');
    startRecognition(Recognition, (transcript) => {
      setCallError('');
      const cleanTranscript = normalizePromptTranscriptUpdate(transcript);
      if (!cleanTranscript) {
        return;
      }
      promptTranscriptRef.current = cleanTranscript;
      setCallTranscript(cleanTranscript);
      schedulePromptSilence();
    });
  }

  function startRecognition(Recognition: SpeechRecognitionConstructor | undefined, onTranscript: (transcript: string, alternatives: string[]) => void, phrases: string[] = []) {
    stopRecognition();
    const engine = getSpeechRecognitionEngine();
    if (engine === 'browser') {
      if (Recognition) {
        startBrowserRecognition(Recognition, onTranscript, phrases, true);
      } else {
        void startVoskRecognition(onTranscript, phrases);
      }
      return;
    }
    if (engine === 'vosk') {
      void startVoskRecognition(onTranscript, phrases);
      return;
    }
    if (engine === 'windows') {
      startSystemRecognition(onTranscript, phrases, Recognition, false);
      return;
    }
    if (Recognition) {
      startBrowserRecognition(Recognition, onTranscript, phrases, true);
    } else {
      void startVoskRecognition(onTranscript, phrases);
    }
  }

  function startSystemRecognition(
    onTranscript: (transcript: string, alternatives: string[]) => void,
    phrases: string[] = [],
    Recognition?: SpeechRecognitionConstructor,
    allowBrowserFallback = true
  ) {
    stopRecognition();
    systemRecognitionCallbackRef.current = onTranscript;
    setCallTranscript('Starting Windows speech...');
    void window.localAI.startSpeechRecognition({ phrases }).then((result) => {
      if (!callActiveRef.current || systemRecognitionCallbackRef.current !== onTranscript) {
        return;
      }
      if (result.started) {
        systemRecognitionActiveRef.current = true;
        return;
      }
      systemRecognitionCallbackRef.current = null;
      systemRecognitionActiveRef.current = false;
      if (Recognition && allowBrowserFallback) {
        startBrowserRecognition(Recognition, onTranscript, phrases, false);
      } else {
        setCallError(result.error || 'Speech recognition is not available on this system.');
      }
    }).catch((error) => {
      systemRecognitionCallbackRef.current = null;
      systemRecognitionActiveRef.current = false;
      if (Recognition && allowBrowserFallback) {
        startBrowserRecognition(Recognition, onTranscript, phrases, false);
      } else {
        setCallError(errorMessage(error));
      }
    });
  }

  function startBrowserRecognition(
    Recognition: SpeechRecognitionConstructor,
    onTranscript: (transcript: string, alternatives: string[]) => void,
    phrases: string[] = [],
    allowVoskFallback = true
  ) {
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 5;
    recognition.onresult = (event) => {
      const alternatives = collectRecognitionAlternatives(event);
      onTranscript(alternatives[0] ?? '', alternatives);
    };
    recognition.onerror = (event) => {
      if (event.error && event.error !== 'no-speech') {
        setCallError(formatSpeechRecognitionError(event.error));
        if (event.error === 'network' && allowVoskFallback) {
          setCallError('');
          stopBrowserRecognition();
          void startVoskRecognition(onTranscript, phrases);
        }
      }
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (!callActiveRef.current) {
        return;
      }
      window.setTimeout(() => {
        if (!callActiveRef.current || recognitionRef.current) {
          return;
        }
        if (callModeRef.current === 'wake') {
          startWakeListening();
        } else if (!promptTranscriptRef.current.trim()) {
          startPromptListening();
        }
      }, 250);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (error) {
      if (allowVoskFallback) {
        stopBrowserRecognition();
        void startVoskRecognition(onTranscript, phrases);
      } else {
        setCallError(errorMessage(error));
      }
    }
  }

  async function startVoskRecognition(
    onTranscript: (transcript: string, alternatives: string[]) => void,
    phrases: string[] = [],
    Recognition?: SpeechRecognitionConstructor
  ) {
    stopSystemRecognition();
    stopBrowserRecognition();
    stopVoskRecognition();
    voskRecognitionCallbackRef.current = onTranscript;
    voskFinalTranscriptRef.current = '';
    setCallTranscript(voskModelRef.current ? 'Starting Vosk...' : 'Downloading Vosk voice model...');
    try {
      const model = await loadVoskModel();
      if (!callActiveRef.current || voskRecognitionCallbackRef.current !== onTranscript) {
        return;
      }

      const stream = getActiveMediaStream() ?? (await prepareMicrophone());
      if (!callActiveRef.current) {
        stopMicMeter();
        return;
      }
      let context = audioContextRef.current;
      if (!context) {
        startMicMeter(stream);
        context = audioContextRef.current;
      }
      if (!context) {
        throw new Error('Audio processing is not available.');
      }
      if (context.state === 'suspended') {
        await context.resume().catch(() => undefined);
      }
      if (!callActiveRef.current || voskRecognitionCallbackRef.current !== onTranscript) {
        return;
      }

      const grammar = phrases.length ? JSON.stringify(Array.from(new Set([...phrases, '[unk]']))) : undefined;
      const recognizer = new model.KaldiRecognizer(VOSK_SAMPLE_RATE, grammar);
      recognizer.on('partialresult', (message) => {
        if ('result' in message && 'partial' in message.result) {
          handleVoskTranscript(message.result.partial, onTranscript, false);
        }
      });
      recognizer.on('result', (message) => {
        if ('result' in message && 'text' in message.result) {
          handleVoskTranscript(message.result.text, onTranscript, true);
        }
      });

      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const output = context.createGain();
      output.gain.value = 0;
      processor.onaudioprocess = (event) => {
        try {
          recognizer.acceptWaveform(event.inputBuffer);
        } catch (error) {
          setCallError(`Vosk audio error: ${errorMessage(error)}`);
        }
      };
      source.connect(processor);
      processor.connect(output);
      output.connect(context.destination);

      voskRecognizerRef.current = recognizer;
      voskSourceRef.current = source;
      voskProcessorRef.current = processor;
      voskOutputRef.current = output;
      setCallTranscript('Mic ready');
    } catch (error) {
      stopVoskRecognition();
      if (Recognition) {
        startBrowserRecognition(Recognition, onTranscript, phrases, false);
      } else {
        setCallError(`Vosk speech recognition failed: ${errorMessage(error)}`);
      }
    }
  }

  async function loadVoskModel() {
    if (voskModelRef.current) {
      return voskModelRef.current;
    }
    if (!voskModelLoadingRef.current) {
      voskModelLoadingRef.current = import('vosk-browser')
        .then(async (Vosk) => {
          const model = await Vosk.createModel(VOSK_MODEL_URL, -1);
          model.setLogLevel(-1);
          voskModelRef.current = model;
          return model;
        })
        .catch((error) => {
          voskModelLoadingRef.current = null;
          throw error;
        });
    }
    return voskModelLoadingRef.current;
  }

  function handleVoskTranscript(transcript: string, onTranscript: (transcript: string, alternatives: string[]) => void, isFinal: boolean) {
    if (!callActiveRef.current || voskRecognitionCallbackRef.current !== onTranscript) {
      return;
    }
    const cleaned = transcript.replace(/\s+/g, ' ').trim();
    if (isFinal) {
      voskFinalTranscriptRef.current = mergeTranscriptParts(voskFinalTranscriptRef.current, cleaned);
      const finalTranscript = voskFinalTranscriptRef.current.trim();
      if (finalTranscript) {
        onTranscript(finalTranscript, [finalTranscript]);
      }
      return;
    }

    const transcriptWithPartial = mergeTranscriptParts(voskFinalTranscriptRef.current, cleaned).trim();
    if (transcriptWithPartial) {
      onTranscript(transcriptWithPartial, [transcriptWithPartial]);
    }
  }

  function getActiveMediaStream() {
    const stream = mediaStreamRef.current;
    return stream?.getAudioTracks().some((track) => track.readyState === 'live') ? stream : null;
  }

  function stopRecognition() {
    stopSystemRecognition();
    stopBrowserRecognition();
    stopVoskRecognition();
  }

  function stopSystemRecognition() {
    if (systemRecognitionActiveRef.current || systemRecognitionCallbackRef.current) {
      systemRecognitionActiveRef.current = false;
      systemRecognitionCallbackRef.current = null;
      void window.localAI.stopSpeechRecognition().catch(() => undefined);
    }
  }

  function stopBrowserRecognition() {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) {
      return;
    }
    recognition.onend = null;
    recognition.onresult = null;
    recognition.onerror = null;
    try {
      recognition.abort();
    } catch {
      undefined;
    }
  }

  function stopVoskRecognition() {
    voskRecognitionCallbackRef.current = null;
    const processor = voskProcessorRef.current;
    voskProcessorRef.current = null;
    if (processor) {
      processor.onaudioprocess = null;
      try {
        processor.disconnect();
      } catch {
        undefined;
      }
    }
    const source = voskSourceRef.current;
    voskSourceRef.current = null;
    try {
      source?.disconnect();
    } catch {
      undefined;
    }
    const output = voskOutputRef.current;
    voskOutputRef.current = null;
    try {
      output?.disconnect();
    } catch {
      undefined;
    }
    const recognizer = voskRecognizerRef.current;
    voskRecognizerRef.current = null;
    voskFinalTranscriptRef.current = '';
    try {
      recognizer?.remove();
    } catch {
      undefined;
    }
  }

  function getSpeechRecognitionEngine(): SpeechRecognitionEngine {
    return storeRef.current?.speechRecognitionEngine ?? 'browser';
  }

  function isContinuousVoiceConversationEnabled() {
    return Boolean(storeRef.current?.experimentalVoiceFeatures && storeRef.current?.experimentalContinuousVoiceConversation);
  }

  function isVoiceCleanupEnabled() {
    return Boolean(storeRef.current?.experimentalVoiceFeatures && storeRef.current?.experimentalVoiceCleanup);
  }

  function matchesVoiceStopPrompt(transcript: string) {
    const normalizedTranscript = normalizeWakePhrase(transcript);
    if (!normalizedTranscript) {
      return false;
    }

    return buildVoiceStopPhrases(activeCharacterRef.current, selectedModelRef.current).some((phrase) =>
      phraseMatchesTranscript(phrase, normalizedTranscript)
    );
  }

  function normalizePromptTranscriptUpdate(transcript: string) {
    const cleanTranscript = transcript.replace(/\s+/g, ' ').trim();
    const normalizedTranscript = normalizeWakePhrase(cleanTranscript);
    if (!normalizedTranscript) {
      return '';
    }
    if (normalizedTranscript === promptLastNormalizedTranscriptRef.current) {
      return '';
    }
    if (isMinorTranscriptJitter(promptLastNormalizedTranscriptRef.current, normalizedTranscript)) {
      return '';
    }

    if (!promptFirstTranscriptAtRef.current) {
      promptFirstTranscriptAtRef.current = Date.now();
    }
    promptLastNormalizedTranscriptRef.current = normalizedTranscript;
    return cleanTranscript;
  }

  function isMinorTranscriptJitter(previous: string, next: string) {
    if (!previous) {
      return false;
    }
    const previousWords = previous.split(' ').filter(Boolean);
    const nextWords = next.split(' ').filter(Boolean);
    if (nextWords.length > previousWords.length) {
      return false;
    }
    return editDistance(previous, next) <= 2;
  }

  function schedulePromptSilence() {
    clearSilenceTimer();
    const scheduledTranscript = promptTranscriptRef.current.trim();
    const wordCount = normalizeWakePhrase(scheduledTranscript).split(' ').filter(Boolean).length;
    const naturalDelay = matchesVoiceStopPrompt(scheduledTranscript)
      ? STOP_PROMPT_SILENCE_MS
      : wordCount > 0 && wordCount <= 3
        ? SHORT_PROMPT_SILENCE_MS
        : PROMPT_SILENCE_MS;
    const startedAt = promptFirstTranscriptAtRef.current || Date.now();
    const maxRemaining = Math.max(500, startedAt + MAX_PROMPT_LISTEN_MS - Date.now());
    const delay = Math.min(naturalDelay, maxRemaining);
    silenceTimerRef.current = window.setTimeout(() => {
      const maxListenReached = Date.now() - startedAt >= MAX_PROMPT_LISTEN_MS;
      if (!maxListenReached && promptTranscriptRef.current.trim() !== scheduledTranscript) {
        schedulePromptSilence();
        return;
      }
      void finishPromptTurn();
    }, delay);
  }

  function clearSilenceTimer() {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }

  async function finishPromptTurn() {
    clearSilenceTimer();
    const prompt = promptTranscriptRef.current.trim();
    const continuousVoice = isContinuousVoiceConversationEnabled();
    stopRecognition();
    if (!callActiveRef.current) {
      return;
    }
    if (!prompt) {
      promptFirstTranscriptAtRef.current = 0;
      promptLastNormalizedTranscriptRef.current = '';
      if (continuousVoice) {
        setCallPhase('listening');
        startPromptListening();
      } else {
        setCallPhase('waiting');
        startWakeListening();
      }
      return;
    }
    if (continuousVoice && matchesVoiceStopPrompt(prompt)) {
      stopCallMode();
      return;
    }

    setCallPhase('thinking');
    const promptForSend = await cleanupRecognizedPrompt(prompt);
    if (!callActiveRef.current) {
      return;
    }

    const response = await sendMessageFromText(promptForSend, { voiceResponse: true });
    if (!callActiveRef.current) {
      return;
    }

    if (response) {
      setCallPhase('speaking');
      await speakText(response.speechText || sanitizeForSpeech(response.content), activeCharacterRef.current);
    }
    if (callActiveRef.current) {
      promptTranscriptRef.current = '';
      promptFirstTranscriptAtRef.current = 0;
      promptLastNormalizedTranscriptRef.current = '';
      setCallTranscript('');
      if (continuousVoice) {
        setCallPhase('listening');
        startPromptListening();
      } else {
        setCallPhase('waiting');
        startWakeListening();
      }
    }
  }

  async function cleanupRecognizedPrompt(transcript: string) {
    const cleanTranscript = transcript.trim();
    if (!isVoiceCleanupEnabled() || !selectedModelRef.current) {
      return cleanTranscript;
    }

    try {
      setCallTranscript(`${cleanTranscript} (cleaning up...)`);
      const result = await window.localAI.cleanupVoiceTranscript({
        model: selectedModelRef.current,
        transcript: cleanTranscript,
        characterName: activeCharacterRef.current?.name,
        userName: effectiveUserNameRef.current,
        messages: normalizeMessagesForPrompt(activeSessionRef.current?.messages.slice(-8) ?? [])
      });
      if (result.changed && result.corrected.trim()) {
        const corrected = result.corrected.trim();
        setCallTranscript(corrected);
        return corrected;
      }
    } catch {
      undefined;
    }

    setCallTranscript(cleanTranscript);
    return cleanTranscript;
  }

  async function speakText(text: string, character?: CharacterProfile) {
    const cleanText = prepareTextForTts(text);
    if (!cleanText) {
      return;
    }

    if (character?.ttsProvider === 'huggingface' && character.hfTtsModel) {
      try {
        await speakHuggingFaceText(cleanText, character);
        return;
      } catch (error) {
        setCallError(`Hugging Face TTS failed, using system voice: ${errorMessage(error)}`);
      }
    }

    await speakSystemText(cleanText, character?.voiceName);
  }

  async function speakSystemText(text: string, voiceName?: string) {
    const cleanText = prepareTextForTts(text);
    if (!cleanText || !window.speechSynthesis) {
      return;
    }

    await new Promise<void>((resolve) => {
      stopCurrentTtsAudio();
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(cleanText);
      const voice = window.speechSynthesis.getVoices().find((item) => item.name === voiceName);
      if (voice) {
        utterance.voice = voice;
      }
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
    });
  }

  async function speakHuggingFaceText(text: string, character: CharacterProfile) {
    const ttsText = prepareTextForTts(text);
    if (!ttsText) {
      return;
    }
    stopCurrentTtsAudio();
    window.speechSynthesis?.cancel();
    if (callActiveRef.current) {
      setCallTranscript('Generating Hugging Face voice...');
    }
    const result = await window.localAI.synthesizeHuggingFaceTts({
      text: ttsText,
      model: character.hfTtsModel || '',
      speakerEmbedding: character.hfTtsSpeaker,
      dtype: character.hfTtsDtype
    });
    await playAudioDataUrl(result.audioDataUrl);
  }

  async function playAudioDataUrl(audioDataUrl: string) {
    await new Promise<void>((resolve) => {
      const audio = new Audio(audioDataUrl);
      currentTtsAudioRef.current = audio;
      const cleanup = () => {
        if (currentTtsAudioRef.current === audio) {
          currentTtsAudioRef.current = null;
        }
        resolve();
      };
      audio.onended = cleanup;
      audio.onerror = cleanup;
      const outputDeviceId = storeRef.current?.selectedOutputDeviceId;
      const sinkAudio = audio as HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> };
      const start = async () => {
        if (outputDeviceId && sinkAudio.setSinkId) {
          await sinkAudio.setSinkId(outputDeviceId);
        }
        await audio.play();
      };
      void start().catch(cleanup);
    });
  }

  function stopCurrentTtsAudio() {
    const audio = currentTtsAudioRef.current;
    currentTtsAudioRef.current = null;
    if (!audio) {
      return;
    }
    audio.pause();
    audio.src = '';
  }

  function startMicMeter(stream: MediaStream) {
    const AudioContextConstructor = window.AudioContext;
    if (!AudioContextConstructor) {
      return;
    }

    const context = new AudioContextConstructor();
    if (context.state === 'suspended') {
      void context.resume().catch(() => undefined);
    }
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);

    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, sample) => sum + Math.pow((sample - 128) / 128, 2), 0) / samples.length);
      const sensitivity = storeRef.current?.microphoneSensitivity ?? 0.08;
      setMicLevel(clamp(rms / sensitivity, 0, 1));
      analyserFrameRef.current = window.requestAnimationFrame(tick);
    };

    audioContextRef.current = context;
    tick();
  }

  function stopMicMeter() {
    if (analyserFrameRef.current !== null) {
      window.cancelAnimationFrame(analyserFrameRef.current);
      analyserFrameRef.current = null;
    }
    audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }

  function scrollToLastMessage(behavior: ScrollBehavior = 'smooth') {
    messageEndRef.current?.scrollIntoView({ block: 'end', behavior });
    setShowJumpButton(false);
  }

  if (!store) {
    return (
      <main className="loading-shell">
        <Loader2 className="spin" size={28} />
        <span>Loading local workspace</span>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <Bot size={24} />
          <div className="brand-copy">
            <span className="brand-title-line">
              <strong>LocalPersona</strong>
              <span className="app-version">v{APP_VERSION}</span>
            </span>
            <span className="brand-subtitle">Local AI personas</span>
          </div>
        </div>
        <div className="topbar-actions">
          <StatusPill status={ollamaStatus} installing={installing} />
          <button className="icon-button" title="Settings" onClick={() => setSettingsOpen(true)}>
            <SlidersHorizontal size={18} />
          </button>
          <button className="icon-button" title="Refresh Ollama" onClick={refreshStatusAndModels} disabled={busy}>
            <RefreshCw size={18} className={busy ? 'spin' : ''} />
          </button>
        </div>
      </header>

      <div className={`workspace ${modelsSidebarHidden ? 'models-sidebar-hidden' : ''}`}>
        <aside className="left-pane">
          <div className="pane-heading">
            <div>
              <span className="eyebrow">Characters</span>
              <h2>Browser</h2>
            </div>
            <button className="icon-button accent" title="Create character" onClick={() => setEditorDraft(createCharacterDraft())}>
              <Plus size={18} />
            </button>
          </div>

          <label className="search-box">
            <Search size={17} />
            <input value={characterQuery} onChange={(event) => setCharacterQuery(event.target.value)} placeholder="Search characters" />
          </label>

          <div className="character-list">
            {filteredCharacters.map((character) => (
              <button
                key={character.id}
                className={`character-card ${character.id === activeCharacter?.id ? 'selected' : ''}`}
                onClick={() => selectCharacter(character.id)}
              >
                <Avatar character={character} />
                <span>
                  <strong>{character.name}</strong>
                  <small>{character.subtitle || character.description}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <main className="chat-pane">
          <section className="chat-header">
            {activeCharacter ? (
              <>
                <Avatar character={activeCharacter} large />
                <div className="chat-title">
                  <span className="eyebrow">{activeCharacter.tags.join(' / ') || 'Character'}</span>
                  <h1>{activeCharacter.name}</h1>
                  <p>{activeCharacter.description}</p>
                </div>
                <div className="chat-actions">
                  {voiceFeaturesEnabled && activeCharacter.callEnabled ? (
                    <button
                      className={`icon-button ${callPhase !== 'off' ? 'danger-button' : ''}`}
                      title={callPhase === 'off' ? 'Start call mode' : 'End call mode'}
                      onClick={() => void toggleCallMode()}
                      disabled={!selectedModel || (streaming && callPhase === 'off')}
                    >
                      {callPhase === 'off' ? <Phone size={18} /> : <PhoneOff size={18} />}
                    </button>
                  ) : null}
                  <button className="icon-button" title="Edit character" onClick={() => setEditorDraft(toEditorDraft(activeCharacter))}>
                    <Settings size={18} />
                  </button>
                  <button className="icon-button" title="Reset chat" onClick={resetChat}>
                    <Trash2 size={18} />
                  </button>
                </div>
              </>
            ) : null}
          </section>

          {voiceFeaturesEnabled && callPhase !== 'off' ? (
            <section className="call-panel">
              <div className="call-state">
                <Mic size={17} />
                <span>{callPhaseLabel(callPhase, activeCharacter)}</span>
              </div>
              <div className="mic-meter" aria-hidden="true">
                <i style={{ width: `${Math.round(micLevel * 100)}%` }} />
              </div>
              {callTranscript ? <p>{callTranscript}</p> : null}
              {callError ? <p className="call-error">{callError}</p> : null}
            </section>
          ) : null}

          <section className="message-list" ref={messageListRef}>
            {displayedMessages.map((message) => {
              const versions = getMessageVersions(message);
              const versionIndex = getMessageVersionIndex(message);
              const hasVersions = versions.length > 1;
              const isRegenerating = streaming && message.id === currentAssistantId.current;
              const canUseAssistantControls = Boolean(activeSession && message.role === 'assistant' && selectedModel);

              return (
                <article key={message.id} className={`message ${message.role}`}>
                  <div className="message-meta">
                    <span>{message.role === 'user' ? displayUserName : activeCharacter?.name}</span>
                    {canUseAssistantControls ? (
                      <div className="message-controls">
                        {hasVersions ? <small>{versionIndex + 1}/{versions.length}</small> : null}
                        <button
                          className="message-icon-button"
                          title="Previous version"
                          disabled={!hasVersions || versionIndex <= 0 || streaming}
                          onClick={() => changeMessageVersion(message.id, -1)}
                        >
                          <ChevronLeft size={15} />
                        </button>
                        <button
                          className="message-icon-button"
                          title="Next version"
                          disabled={!hasVersions || versionIndex >= versions.length - 1 || streaming}
                          onClick={() => changeMessageVersion(message.id, 1)}
                        >
                          <ChevronRight size={15} />
                        </button>
                        <button
                          className="message-icon-button"
                          title="Regenerate response"
                          disabled={streaming}
                          onClick={() => regenerateMessage(message.id)}
                        >
                          {isRegenerating ? <Loader2 size={15} className="spin" /> : <RotateCcw size={15} />}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <MessageText content={message.content || (isRegenerating ? 'Thinking...' : '')} />
                </article>
              );
            })}
            <div ref={messageEndRef} className="message-end-anchor" />
          </section>

          <button
            className={`jump-last-button ${showJumpButton ? 'visible' : ''}`}
            title="Jump to last message"
            onClick={() => scrollToLastMessage()}
          >
            <ArrowDown size={18} />
          </button>

          <footer className="composer">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder={selectedModel ? `Message ${activeCharacter?.name ?? 'character'} with ${selectedModel}` : 'Install or pull a model first'}
              disabled={!selectedModel || streaming}
            />
            <button
              className={`send-button ${streaming ? 'stop' : ''}`}
              title={streaming ? 'Stop generating' : 'Send message'}
              onClick={streaming ? stopGeneration : sendMessage}
              disabled={streaming ? false : !selectedModel || !draft.trim()}
            >
              {streaming ? <X size={20} /> : <Send size={20} />}
            </button>
          </footer>
        </main>

        {modelsSidebarHidden ? (
          <button className="models-sidebar-restore" title="Show models sidebar" onClick={() => setModelsSidebarHidden(false)}>
            <ChevronLeft size={18} />
          </button>
        ) : null}

        <aside className="right-pane" aria-hidden={modelsSidebarHidden}>
          <div className="models-sidebar-toolbar">
            <span>Models</span>
            <button className="icon-button" title="Hide models sidebar" onClick={() => setModelsSidebarHidden(true)}>
              <ChevronRight size={18} />
            </button>
          </div>
          <section className="tool-section">
            <div className="pane-heading compact">
              <div>
                <span className="eyebrow">Models</span>
                <h2>Local</h2>
              </div>
              <HardDrive size={19} />
            </div>

            <div className="local-model-list">
              {localModels.length === 0 ? (
                <div className="empty-state">
                  <PackageOpen size={22} />
                  <span>No local models yet</span>
                </div>
              ) : (
                localModels.map((model) => (
                  <button
                    key={model.name}
                    className={`model-row ${selectedModel === model.name ? 'selected' : ''}`}
                    title={streaming ? 'Wait for the current response to finish before changing models' : model.name}
                    disabled={streaming}
                    onClick={() => selectModel(model.name)}
                  >
                    <Cpu size={17} />
                    <span>
                      <strong>{model.name}</strong>
                      <small>{formatModelMeta(model)}</small>
                    </span>
                    {selectedModel === model.name ? <CheckCircle2 size={17} /> : null}
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="tool-section">
            <div className="pane-heading compact">
              <div>
                <span className="eyebrow">Ollama.com</span>
                <h2>Model Browser</h2>
              </div>
              <div className="collapsible-actions">
                <button className="icon-button" title="Open Ollama library" onClick={() => window.localAI.openExternal('https://ollama.com/library')}>
                  <PackageOpen size={18} />
                </button>
                <button
                  className={`icon-button collapse-button ${ollamaBrowserCollapsed ? '' : 'open'}`}
                  title={ollamaBrowserCollapsed ? 'Show Ollama models' : 'Collapse Ollama models'}
                  onClick={() => setOllamaBrowserCollapsed((previous) => !previous)}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>

            {!ollamaBrowserCollapsed ? (
              <>
                <label className="search-box">
                  <Search size={17} />
                  <input value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder="Search models" />
                </label>

                <div className="custom-pull">
                  <input
                    value={customModel}
                    onChange={(event) => setCustomModel(event.target.value)}
                    placeholder="model or model:tag"
                    disabled={streaming}
                  />
                  <button className="icon-button accent" title="Pull custom model" disabled={streaming || !customModel.trim()} onClick={() => pullModel(customModel)}>
                    <Download size={17} />
                  </button>
                </div>

                <div className="library-list">
                  {filteredLibraryModels.map((model) => {
                    const selectedVariant = variantSelections[model.name] ?? model.variants[0] ?? '';
                    const pullName = selectedVariant ? `${model.name}:${selectedVariant}` : model.name;
                    const installed = isLibraryModelInstalled(model.name, localModelNames);
                    const progress = pullProgress[pullName];

                    return (
                      <article className="library-card" key={model.name}>
                        <div className="library-card-header">
                          <div>
                            <strong>{model.name}</strong>
                            <p>{model.description}</p>
                          </div>
                          {installed ? <CheckCircle2 className="ready-icon" size={18} /> : null}
                        </div>

                        <div className="tag-row">
                          {model.tags.slice(0, 4).map((tag) => (
                            <span key={tag}>{tag}</span>
                          ))}
                        </div>

                        <div className="model-actions">
                          {model.variants.length > 0 ? (
                            <select
                              value={selectedVariant}
                              disabled={streaming}
                              onChange={(event) =>
                                setVariantSelections((previous) => ({ ...previous, [model.name]: event.target.value }))
                              }
                            >
                              {model.variants.map((variant) => (
                                <option value={variant} key={variant}>
                                  {variant}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="model-stat">{model.pulls || 'Library'}</span>
                          )}
                          <button className="text-button small" disabled={streaming} onClick={() => pullModel(pullName)}>
                            <Download size={16} />
                            Pull
                          </button>
                        </div>
                        {progress ? <ProgressLine progress={progress} /> : null}
                      </article>
                    );
                  })}
                </div>
              </>
            ) : null}
          </section>

          {voiceFeaturesEnabled ? (
            <section className="tool-section">
              <div className="pane-heading compact">
                <div>
                  <span className="eyebrow">Hugging Face</span>
                  <h2>TTS Browser</h2>
                </div>
                <div className="collapsible-actions">
                  <button className="icon-button" title="Open Hugging Face TTS models" onClick={() => window.localAI.openExternal('https://huggingface.co/models?library=transformers.js&pipeline_tag=text-to-speech')}>
                    <Volume2 size={18} />
                  </button>
                  <button
                    className={`icon-button collapse-button ${ttsBrowserCollapsed ? '' : 'open'}`}
                    title={ttsBrowserCollapsed ? 'Show TTS models' : 'Collapse TTS models'}
                    onClick={() => setTtsBrowserCollapsed((previous) => !previous)}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>

              {!ttsBrowserCollapsed ? (
                <>
                  <label className="search-box">
                    <Search size={17} />
                    <input value={hfTtsQuery} onChange={(event) => setHfTtsQuery(event.target.value)} placeholder="Search TTS models" />
                  </label>

                  <div className="custom-pull">
                    <input
                      value={customHfTtsModel}
                      onChange={(event) => setCustomHfTtsModel(event.target.value)}
                      placeholder="owner/model"
                    />
                    <button className="text-button small primary" title="Add Hugging Face model id to the list" disabled={!customHfTtsModel.trim()} onClick={() => importHuggingFaceTtsModel(customHfTtsModel)}>
                      <FileUp size={17} />
                      Add
                    </button>
                  </div>
                  <p className="notice">
                    Custom models must be public Transformers.js/ONNX TTS repos. For private, gated, PyTorch-only, or converted models, import a local model folder.
                  </p>

                  <button className="text-button" type="button" onClick={() => void importLocalHuggingFaceTtsModel()}>
                    <FileUp size={17} />
                    Import local TTS folder
                  </button>

                  <div className="library-list tts-library-list">
                    {filteredHfTtsModels.map((model) => {
                      const selected = activeCharacter?.ttsProvider === 'huggingface' && activeCharacter.hfTtsModel === model.id;
                      return (
                        <article className="library-card" key={model.id}>
                          <div className="library-card-header">
                            <div>
                              <strong>{model.name}</strong>
                              <p>{model.description}</p>
                            </div>
                            {selected ? <CheckCircle2 className="ready-icon" size={18} /> : null}
                          </div>
                          <div className="tag-row">
                            {model.tags.slice(0, 4).map((tag) => (
                              <span key={tag}>{tag}</span>
                            ))}
                            {model.downloads ? <span>{formatCompactNumber(model.downloads)} downloads</span> : null}
                          </div>
                          <div className="model-actions">
                            <span className="model-stat">{model.localPath ? 'Local folder' : model.id}</span>
                            <button className="text-button small" type="button" onClick={() => void useHuggingFaceTtsModel(model)} disabled={!activeCharacter}>
                              <Volume2 size={16} />
                              Use
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </section>
          ) : null}

          {(installing || installLines.length > 0 || notice) && (
            <section className="tool-section">
              <div className="pane-heading compact">
                <div>
                  <span className="eyebrow">System</span>
                  <h2>Status</h2>
                </div>
                {notice ? <AlertCircle size={18} /> : <Wand2 size={18} />}
              </div>
              {notice ? <p className="notice">{notice}</p> : null}
              {installLines.length > 0 ? (
                <div className="log-lines">
                  {installLines.map((line, index) => (
                    <code key={`${line}-${index}`}>{line}</code>
                  ))}
                </div>
              ) : null}
            </section>
          )}
        </aside>
      </div>

      {editorDraft ? (
        <CharacterEditor
          draft={editorDraft}
          globalUserName={store.userName}
          voiceFeaturesEnabled={voiceFeaturesEnabled}
          voices={voices}
          hfTtsModels={hfTtsModels}
          onClose={() => setEditorDraft(null)}
          onSave={saveCharacter}
          onDelete={deleteCharacter}
        />
      ) : null}
      {settingsOpen ? (
        <SettingsModal
          store={store}
          theme={theme}
          voiceFeaturesEnabled={voiceFeaturesEnabled}
          updateStatus={updateStatus}
          audioDevices={audioDevices}
          onRefreshDevices={() => refreshAudioDevices(true)}
          onCheckForUpdates={checkForUpdates}
          onDownloadUpdate={downloadUpdate}
          onInstallUpdate={installUpdate}
          onImportWorkspace={importWorkspace}
          onExportWorkspace={exportWorkspace}
          onClose={() => setSettingsOpen(false)}
          onSave={saveSettings}
        />
      ) : null}
    </div>
  );
}

function SettingsModal({
  store,
  theme,
  voiceFeaturesEnabled,
  updateStatus,
  audioDevices,
  onRefreshDevices,
  onCheckForUpdates,
  onDownloadUpdate,
  onInstallUpdate,
  onImportWorkspace,
  onExportWorkspace,
  onClose,
  onSave
}: {
  store: AppStore;
  theme: ThemeMode;
  voiceFeaturesEnabled: boolean;
  updateStatus: UpdateStatus;
  audioDevices: AudioDevice[];
  onRefreshDevices: () => Promise<void>;
  onCheckForUpdates: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
  onImportWorkspace: () => Promise<void>;
  onExportWorkspace: () => Promise<void>;
  onClose: () => void;
  onSave: (settings: Partial<AppStore>, theme: ThemeMode) => Promise<void>;
}) {
  const [form, setForm] = useState({
    userName: store.userName ?? '',
    theme,
    selectedInputDeviceId: store.selectedInputDeviceId ?? '',
    selectedOutputDeviceId: store.selectedOutputDeviceId ?? '',
    microphoneSensitivity: store.microphoneSensitivity ?? 0.08,
    speechRecognitionEngine: store.speechRecognitionEngine ?? 'browser',
    experimentalVoiceFeatures: voiceFeaturesEnabled,
    experimentalContinuousVoiceConversation: Boolean(store.experimentalContinuousVoiceConversation),
    experimentalVoiceCleanup: Boolean(store.experimentalVoiceCleanup)
  });
  const inputDevices = audioDevices.filter((device) => device.kind === 'audioinput');
  const outputDevices = audioDevices.filter((device) => device.kind === 'audiooutput');

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  return (
    <div className="modal-backdrop">
      <section className="modal settings-modal">
        <header className="modal-header">
          <div>
            <span className="eyebrow">Settings</span>
            <h2>App settings</h2>
          </div>
          <button className="icon-button" title="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="editor-grid">
          <label>
            Global name
            <span className="input-with-icon">
              <UserRound size={16} />
              <input value={form.userName} maxLength={80} onChange={(event) => update('userName', event.target.value)} />
            </span>
          </label>
          <label>
            Theme
            <span className="input-with-icon">
              <Sun size={16} />
              <select value={form.theme} onChange={(event) => update('theme', event.target.value as ThemeMode)}>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </span>
          </label>
          <section className="settings-actions wide">
            <span className="settings-actions-title">App</span>
            <div className="settings-action-row">
              <UpdateControl status={updateStatus} onCheck={onCheckForUpdates} onDownload={onDownloadUpdate} onInstall={onInstallUpdate} />
              <button className="text-button" type="button" onClick={() => void onImportWorkspace()}>
                <FileUp size={17} />
                Import
              </button>
              <button className="text-button" type="button" onClick={() => void onExportWorkspace()}>
                <FileDown size={17} />
                Export
              </button>
            </div>
          </section>
          <label className="checkbox-row wide">
            <input
              type="checkbox"
              checked={form.experimentalVoiceFeatures}
              onChange={(event) => {
                update('experimentalVoiceFeatures', event.target.checked);
                if (event.target.checked) {
                  void onRefreshDevices();
                }
              }}
            />
            <span>
              <Mic size={16} />
              Enable experimental voice and call features
            </span>
          </label>
          {form.experimentalVoiceFeatures ? (
            <>
              <label>
                Input device
                <span className="input-with-icon">
                  <Mic size={16} />
                  <select value={form.selectedInputDeviceId} onChange={(event) => update('selectedInputDeviceId', event.target.value)}>
                    <option value="">System default</option>
                    {inputDevices.map((device, index) => (
                      <option key={device.deviceId || index} value={device.deviceId}>
                        {device.label || `Microphone ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              <label>
                Output device
                <span className="input-with-icon">
                  <Volume2 size={16} />
                  <select value={form.selectedOutputDeviceId} onChange={(event) => update('selectedOutputDeviceId', event.target.value)}>
                    <option value="">System default</option>
                    {outputDevices.map((device, index) => (
                      <option key={device.deviceId || index} value={device.deviceId}>
                        {device.label || `Speaker ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              <label>
                Microphone sensitivity: {Number(form.microphoneSensitivity).toFixed(2)}
                <input
                  type="range"
                  min="0.01"
                  max="1"
                  step="0.01"
                  value={form.microphoneSensitivity}
                  onChange={(event) => update('microphoneSensitivity', Number(event.target.value))}
                />
              </label>
              <label>
                Speech recognition
                <select
                  value={form.speechRecognitionEngine}
                  onChange={(event) => update('speechRecognitionEngine', event.target.value as SpeechRecognitionEngine)}
                >
                  <option value="browser">Browser microphone</option>
                  <option value="vosk">Vosk offline</option>
                  <option value="auto">Browser, then Vosk</option>
                  <option value="windows">Windows speech</option>
                </select>
              </label>
            </>
          ) : null}
          {form.experimentalVoiceFeatures ? (
            <details className="settings-submenu wide">
              <summary>Experimental voice</summary>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.experimentalContinuousVoiceConversation}
                onChange={(event) => update('experimentalContinuousVoiceConversation', event.target.checked)}
              />
              <span>Continuous conversation</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.experimentalVoiceCleanup}
                onChange={(event) => update('experimentalVoiceCleanup', event.target.checked)}
              />
              <span>Clean up recognized speech</span>
            </label>
            </details>
          ) : null}
          {form.experimentalVoiceFeatures ? (
            <button className="text-button wide" type="button" onClick={() => void onRefreshDevices()}>
              <RefreshCw size={17} />
              Refresh audio devices
            </button>
          ) : null}
        </div>

        <footer className="modal-actions">
          <span />
          <button className="text-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="text-button primary"
            onClick={async () => {
              await onSave(
                {
                  userName: form.userName,
                  selectedInputDeviceId: form.selectedInputDeviceId,
                  selectedOutputDeviceId: form.selectedOutputDeviceId,
                  microphoneSensitivity: form.microphoneSensitivity,
                  speechRecognitionEngine: form.speechRecognitionEngine,
                  experimentalVoiceFeatures: form.experimentalVoiceFeatures,
                  experimentalContinuousVoiceConversation:
                    form.experimentalVoiceFeatures && form.experimentalContinuousVoiceConversation,
                  experimentalVoiceCleanup: form.experimentalVoiceFeatures && form.experimentalVoiceCleanup
                },
                form.theme
              );
              onClose();
            }}
          >
            <Save size={17} />
            Save
          </button>
        </footer>
      </section>
    </div>
  );
}

function CharacterEditor({
  draft,
  globalUserName,
  voiceFeaturesEnabled,
  voices,
  hfTtsModels,
  onClose,
  onSave,
  onDelete
}: {
  draft: EditorDraft;
  globalUserName?: string;
  voiceFeaturesEnabled: boolean;
  voices: SpeechSynthesisVoice[];
  hfTtsModels: HuggingFaceTtsModel[];
  onClose: () => void;
  onSave: (character: Partial<CharacterProfile>) => Promise<void>;
  onDelete: (characterId: string) => Promise<boolean>;
}) {
  const [form, setForm] = useState<EditorDraft>(draft);

  function update<K extends keyof EditorDraft>(key: K, value: EditorDraft[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  function updateAvatarImage(file?: File) {
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => update('avatarImage', typeof reader.result === 'string' ? reader.result : undefined);
    reader.readAsDataURL(file);
  }

  const selectedHfTtsModel = hfTtsModels.find((model) => model.id === form.hfTtsModel);
  const hfTtsSpeakers = selectedHfTtsModel?.speakers ?? [];

  function updateHuggingFaceTtsModel(modelId: string) {
    const model = hfTtsModels.find((item) => item.id === modelId);
    setForm((previous) => ({
      ...previous,
      hfTtsModel: modelId,
      hfTtsSpeaker: model?.speakers?.[0]?.embedding || model?.defaultSpeakerEmbedding || '',
      hfTtsDtype: model?.defaultDtype ?? previous.hfTtsDtype ?? 'q8'
    }));
  }

  const canSave = Boolean(String(form.name || '').trim() && String(form.systemPrompt || '').trim());

  return (
    <div className="modal-backdrop">
      <section className="modal">
        <header className="modal-header">
          <div>
            <span className="eyebrow">Character Creator</span>
            <h2>{form.id ? 'Edit character' : 'New character'}</h2>
          </div>
          <button className="icon-button" title="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="editor-grid">
          <label>
            Name
            <input value={form.name || ''} onChange={(event) => update('name', event.target.value)} />
          </label>
          <label>
            Your name
            <input
              value={form.userName || ''}
              maxLength={80}
              onChange={(event) => update('userName', event.target.value)}
              placeholder={globalUserName ? `Uses ${globalUserName}` : 'Uses global name'}
            />
          </label>
          <label>
            Subtitle
            <input value={form.subtitle || ''} onChange={(event) => update('subtitle', event.target.value)} />
          </label>
          <label className="wide avatar-picker">
            Profile picture
            <div>
              <Avatar character={normalizeAvatarPreview(form)} large />
              <input type="file" accept="image/*" onChange={(event) => updateAvatarImage(event.target.files?.[0])} />
              {form.avatarImage ? (
                <button className="text-button small" type="button" onClick={() => update('avatarImage', undefined)}>
                  <X size={15} />
                  Remove
                </button>
              ) : null}
            </div>
          </label>
          <label className="wide">
            Description
            <textarea value={form.description || ''} onChange={(event) => update('description', event.target.value)} />
          </label>
          <label className="wide">
            About user
            <textarea
              value={form.aboutUser || ''}
              onChange={(event) => update('aboutUser', event.target.value)}
              placeholder="What this character should know about you"
            />
          </label>
          <label className="wide">
            System prompt
            <textarea className="tall" value={form.systemPrompt || ''} onChange={(event) => update('systemPrompt', event.target.value)} />
          </label>
          <label className="wide">
            Greeting
            <input value={form.greeting || ''} onChange={(event) => update('greeting', event.target.value)} />
          </label>
          <label>
            Response mode
            <select value={form.promptMode ?? 'roleplay'} onChange={(event) => update('promptMode', event.target.value as PromptMode)}>
              <option value="roleplay">Roleplay</option>
              <option value="assistant">Assistant</option>
            </select>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={Boolean(form.webSearchEnabled)}
              onChange={(event) => update('webSearchEnabled', event.target.checked)}
            />
            <span>
              <Globe2 size={16} />
              Web search
            </span>
          </label>
          <label>
            Tags
            <input value={form.tagsText || ''} onChange={(event) => update('tagsText', event.target.value)} />
          </label>
          <label>
            Temperature: {Number(form.temperature ?? 0.7).toFixed(2)}
            <input
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={form.temperature ?? 0.7}
              onChange={(event) => update('temperature', Number(event.target.value))}
            />
          </label>
          {voiceFeaturesEnabled ? (
            <>
              <label className="checkbox-row">
                <input type="checkbox" checked={Boolean(form.callEnabled)} onChange={(event) => update('callEnabled', event.target.checked)} />
                <span>
                  <Phone size={16} />
                  Call mode
                </span>
              </label>
              <label>
                Activation phrase
                <input
                  value={form.activationPhrase || ''}
                  onChange={(event) => update('activationPhrase', event.target.value)}
                  placeholder={form.name ? `hey ${form.name}` : 'hey Sarah'}
                />
              </label>
              <label>
                Wake response
                <input
                  value={form.activationResponse || ''}
                  onChange={(event) => update('activationResponse', event.target.value)}
                  placeholder="yes?"
                />
              </label>
              <label>
                TTS engine
                <select value={form.ttsProvider || 'system'} onChange={(event) => update('ttsProvider', event.target.value as TtsProvider)}>
                  <option value="system">Windows / system voice</option>
                  <option value="huggingface">Hugging Face local model</option>
                </select>
              </label>
              {form.ttsProvider !== 'huggingface' ? (
                <label>
                  System voice
                  <select value={form.voiceName || ''} onChange={(event) => update('voiceName', event.target.value)}>
                    <option value="">System default</option>
                    {voices.map((voice) => (
                      <option key={`${voice.name}-${voice.lang}`} value={voice.name}>
                        {voice.name} ({voice.lang})
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {form.ttsProvider === 'huggingface' ? (
                <>
                  <label>
                    Hugging Face model
                    <select value={form.hfTtsModel || ''} onChange={(event) => updateHuggingFaceTtsModel(event.target.value)}>
                      <option value="">Choose a TTS model</option>
                      {hfTtsModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    HF quality
                    <select value={form.hfTtsDtype || selectedHfTtsModel?.defaultDtype || 'q8'} onChange={(event) => update('hfTtsDtype', event.target.value as HuggingFaceTtsDtype)}>
                      <option value="q8">Balanced q8</option>
                      <option value="q4">Faster q4</option>
                      <option value="q4f16">Fast q4f16</option>
                      <option value="fp16">Higher fp16</option>
                      <option value="fp32">Highest fp32</option>
                    </select>
                  </label>
                  {hfTtsSpeakers.length > 0 ? (
                    <label className="wide">
                      HF voice preset
                      <select value={form.hfTtsSpeaker || selectedHfTtsModel?.defaultSpeakerEmbedding || ''} onChange={(event) => update('hfTtsSpeaker', event.target.value)}>
                        {hfTtsSpeakers.map((speaker) => (
                          <option key={speaker.id} value={speaker.embedding || speaker.id}>
                            {speaker.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label className="wide">
                    HF voice override
                    <input
                      value={form.hfTtsSpeaker || ''}
                      onChange={(event) => update('hfTtsSpeaker', event.target.value)}
                      placeholder="Optional speaker embedding URL, local file path, or Kokoro voice id"
                    />
                  </label>
                </>
              ) : null}
            </>
          ) : null}
          <div className="wide swatches">
            {avatarColors.map((color) => (
              <button
                key={color}
                className={form.avatarColor === color ? 'selected' : ''}
                style={{ background: color }}
                title={color}
                onClick={() => update('avatarColor', color)}
              />
            ))}
          </div>
        </div>

        <footer className="modal-actions">
          {form.id ? (
            <button
              className="text-button danger"
              onClick={async () => {
                if (await onDelete(form.id!)) {
                  onClose();
                }
              }}
            >
              <Trash2 size={17} />
              Delete
            </button>
          ) : null}
          <span />
          <button className="text-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="text-button primary"
            disabled={!canSave}
            onClick={() =>
              onSave({
                ...form,
                tags: String(form.tagsText || '')
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter(Boolean)
              })
            }
          >
            <Save size={17} />
            Save
          </button>
        </footer>
      </section>
    </div>
  );
}

function UpdateControl({
  status,
  onCheck,
  onDownload,
  onInstall
}: {
  status: UpdateStatus;
  onCheck: () => void;
  onDownload: () => void;
  onInstall: () => void;
}) {
  const title = status.message || 'Check for LocalPersona updates';

  if (status.state === 'available') {
    return (
      <button className="text-button update-control available" title={title} onClick={onDownload}>
        <Download size={17} />
        download update
      </button>
    );
  }

  if (status.state === 'downloaded') {
    const label = status.packageKind === 'portable' ? 'open update' : 'restart';
    return (
      <button className="text-button update-control downloaded" title={title} onClick={onInstall}>
        <RefreshCw size={17} />
        {label}
      </button>
    );
  }

  if (status.state === 'downloading') {
    return (
      <button className="text-button update-control" title={title} disabled>
        <Loader2 size={17} className="spin" />
        {status.percent ?? 0}%
      </button>
    );
  }

  if (status.state === 'checking') {
    return (
      <button className="text-button update-control" title={title} disabled>
        <Loader2 size={17} className="spin" />
        check for update
      </button>
    );
  }

  return (
    <button className={`text-button update-control ${status.state === 'error' ? 'error' : ''}`} title={title} onClick={onCheck}>
      {status.state === 'error' ? <AlertCircle size={17} /> : <RefreshCw size={17} />}
      check for update
    </button>
  );
}

function StatusPill({ status, installing }: { status: OllamaStatus | null; installing: boolean }) {
  if (installing) {
    return (
      <span className="status-pill pending">
        <Loader2 size={15} className="spin" />
        Installing Ollama
      </span>
    );
  }
  if (status?.running) {
    return (
      <span className="status-pill ready">
        <CheckCircle2 size={15} />
        Ollama {status.version || 'ready'}
      </span>
    );
  }
  if (status?.installed) {
    return (
      <span className="status-pill pending">
        <Loader2 size={15} className="spin" />
        Starting Ollama
      </span>
    );
  }
  return (
    <span className="status-pill missing">
      <AlertCircle size={15} />
      Ollama missing
    </span>
  );
}

function Avatar({ character, large = false }: { character: CharacterProfile; large?: boolean }) {
  return (
    <span className={`avatar ${large ? 'large' : ''}`} style={{ backgroundColor: character.avatarColor }}>
      {character.avatarImage ? <img src={character.avatarImage} alt="" /> : initials(character.name)}
    </span>
  );
}

function MessageText({ content }: { content: string }) {
  const visibleContent = useMemo(() => stripVoiceSpeechMarkers(content), [content]);
  const nodes = useMemo(() => linkifyMessageContent(visibleContent), [visibleContent]);
  return <p>{nodes}</p>;
}

function MessageLink({ url, children }: { url: string; children: ReactNode }) {
  return (
    <a
      href={url}
      onClick={(event) => {
        event.preventDefault();
        void window.localAI.openExternal(url);
      }}
    >
      {children}
    </a>
  );
}

function ProgressLine({ progress }: { progress: PullProgress }) {
  const percentage = progress.total && progress.completed ? Math.round((progress.completed / progress.total) * 100) : undefined;
  return (
    <div className="progress-line">
      <span>
        {progress.status}
        {percentage !== undefined ? ` ${percentage}%` : ''}
      </span>
      {percentage !== undefined ? (
        <div>
          <i style={{ width: `${percentage}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function createCharacterDraft(): EditorDraft {
  return {
    name: '',
    userName: '',
    subtitle: '',
    description: '',
    aboutUser: '',
    systemPrompt: '',
    greeting: '',
    tagsText: '',
    avatarColor: avatarColors[0],
    temperature: 0.7,
    promptMode: 'roleplay',
    webSearchEnabled: false,
    callEnabled: false,
    activationPhrase: '',
    activationResponse: 'yes?',
    voiceName: '',
    ttsProvider: 'system',
    hfTtsModel: '',
    hfTtsSpeaker: '',
    hfTtsDtype: 'q8'
  };
}

function toEditorDraft(character: CharacterProfile): EditorDraft {
  return {
    ...character,
    tagsText: character.tags.join(', ')
  };
}

function createSession(character: CharacterProfile, model: string): ChatSession {
  return {
    id: createId(),
    characterId: character.id,
    model,
    title: character.name,
    messages: initialMessages(character),
    updatedAt: new Date().toISOString()
  };
}

function initialMessages(character?: CharacterProfile): ChatMessage[] {
  if (!character?.greeting) {
    return [];
  }
  return [
    {
      id: `${character.id}-greeting`,
      role: 'assistant',
      content: character.greeting,
      createdAt: character.createdAt
    }
  ];
}

function appendTokenToMessage(message: ChatMessage, token: string): ChatMessage {
  const content = message.content + token;
  if (!message.variants || typeof message.variantIndex !== 'number') {
    return { ...message, content };
  }

  const variants = [...message.variants];
  variants[message.variantIndex] = content;
  return { ...message, content, variants };
}

function normalizeMessageForPrompt(message: ChatMessage): ChatMessage {
  return {
    ...message,
    content: stripVoiceSpeechMarkers(getMessageVersions(message)[getMessageVersionIndex(message)])
  };
}

function normalizeMessagesForPrompt(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .map(normalizeMessageForPrompt)
    .filter((message) => message.content.trim().length > 0);
}

function getMessageVersions(message: ChatMessage) {
  const variants = Array.isArray(message.variants)
    ? message.variants.map((variant) => String(variant)).filter((variant) => variant.trim().length > 0)
    : [];
  if (variants.length === 0) {
    return [message.content];
  }
  return variants;
}

function getMessageVersionIndex(message: ChatMessage) {
  const versions = getMessageVersions(message);
  return clamp(Number(message.variantIndex ?? versions.length - 1), 0, versions.length - 1);
}

function buildDisplayedMessages(character?: CharacterProfile, session?: ChatSession): ChatMessage[] {
  if (session?.messages.length) {
    return session.messages;
  }
  return initialMessages(character);
}

function upsertSessionInStore(store: AppStore, session: ChatSession): AppStore {
  const exists = store.sessions.some((item) => item.id === session.id);
  return {
    ...store,
    selectedCharacterId: session.characterId,
    selectedSessionId: session.id,
    selectedModel: session.model,
    sessions: exists ? store.sessions.map((item) => (item.id === session.id ? session : item)) : [session, ...store.sessions]
  };
}

function updateSessionInStore(store: AppStore, sessionId: string, updater: (session: ChatSession) => ChatSession): AppStore {
  return {
    ...store,
    sessions: store.sessions.map((session) => (session.id === sessionId ? updater(session) : session))
  };
}

function getOrderedSessions(sessions: ChatSession[]) {
  return [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function getLatestSessionForCharacter(sessions: ChatSession[], characterId?: string) {
  if (!characterId) {
    return undefined;
  }
  return getOrderedSessions(sessions).find((session) => session.characterId === characterId);
}

function wrapIndex(index: number, length: number) {
  return ((index % length) + length) % length;
}

function getEffectiveUserName(store: AppStore | null, character?: CharacterProfile) {
  return cleanUserName(character?.userName || store?.userName || '');
}

function cleanUserName(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 80);
}

function isLibraryModelInstalled(name: string, localModelNames: Set<string>) {
  for (const localName of localModelNames) {
    if (localName === name || localName.startsWith(`${name}:`)) {
      return true;
    }
  }
  return false;
}

function normalizeAvatarPreview(form: EditorDraft): CharacterProfile {
  return {
    id: String(form.id || 'preview'),
    name: String(form.name || 'Character'),
    userName: form.userName,
    aboutUser: form.aboutUser,
    subtitle: String(form.subtitle || ''),
    description: String(form.description || ''),
    systemPrompt: String(form.systemPrompt || ''),
    greeting: String(form.greeting || ''),
    tags: [],
    avatarColor: String(form.avatarColor || avatarColors[0]),
    avatarImage: form.avatarImage,
    temperature: Number(form.temperature ?? 0.7),
    promptMode: form.promptMode ?? 'roleplay',
    webSearchEnabled: form.webSearchEnabled,
    callEnabled: form.callEnabled,
    activationPhrase: form.activationPhrase,
    activationResponse: form.activationResponse,
    voiceName: form.voiceName,
    ttsProvider: form.ttsProvider,
    hfTtsModel: form.hfTtsModel,
    hfTtsSpeaker: form.hfTtsSpeaker,
    hfTtsDtype: form.hfTtsDtype,
    createdAt: String(form.createdAt || new Date().toISOString()),
    updatedAt: String(form.updatedAt || new Date().toISOString())
  };
}

function linkifyMessageContent(content: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\[([^\]\n]{1,180})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+)/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content))) {
    const fullMatch = match[0];
    const markdownLabel = match[1];
    const markdownUrl = match[2];
    const plainUrl = match[3];
    const matchStart = match.index;
    const matchEnd = matchStart + fullMatch.length;
    const rawUrl = markdownUrl || plainUrl || '';
    const { url, trailing } = trimUrlTrailingPunctuation(rawUrl);

    if (!isSafeWebUrl(url)) {
      continue;
    }

    if (matchStart > cursor) {
      nodes.push(content.slice(cursor, matchStart));
    }

    nodes.push(
      <MessageLink key={`${url}-${matchStart}`} url={url}>
        {markdownLabel || url}
      </MessageLink>
    );
    if (trailing) {
      nodes.push(trailing);
    }
    cursor = matchEnd;
  }

  if (cursor < content.length) {
    nodes.push(content.slice(cursor));
  }

  return nodes.length > 0 ? nodes : [content];
}

function trimUrlTrailingPunctuation(rawUrl: string) {
  const match = rawUrl.match(/^(.+?)([.,!?;:)\]}]*)$/);
  return {
    url: match?.[1] ?? rawUrl,
    trailing: match?.[2] ?? ''
  };
}

function isSafeWebUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | undefined {
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

function collectRecognitionAlternatives(event: SpeechRecognitionEventLike) {
  const parts: string[] = [];
  const alternatives = new Set<string>();
  for (let index = 0; index < event.results.length; index += 1) {
    const result = event.results[index];
    const transcript = result?.[0]?.transcript?.trim();
    if (transcript) {
      parts.push(transcript);
    }
    for (let alternativeIndex = 0; alternativeIndex < Math.min(result?.length ?? 0, 5); alternativeIndex += 1) {
      const alternative = result?.[alternativeIndex]?.transcript?.trim();
      if (alternative) {
        alternatives.add(alternative.replace(/\s+/g, ' '));
      }
    }
  }
  const primary = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (primary) {
    alternatives.add(primary);
  }
  return Array.from(alternatives);
}

function normalizeWakePhrase(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function matchesActivationPhrase(phrase: string, transcripts: string[]) {
  const phraseVariants = buildWakePhraseVariants(phrase);
  return transcripts.some((transcript) => {
    const normalizedTranscript = normalizeWakePhrase(transcript);
    return phraseVariants.some((variant) => phraseMatchesTranscript(variant, normalizedTranscript));
  });
}

function buildWakePhraseVariants(phrase: string) {
  const normalized = normalizeWakePhrase(phrase);
  const words = normalized.split(' ').filter(Boolean);
  const variants = new Set([normalized]);
  if (words.length >= 2 && ['hey', 'hi', 'hello', 'okay', 'ok'].includes(words[0])) {
    const rest = words.slice(1).join(' ');
    variants.add(rest);
    variants.add(`hay ${rest}`);
    variants.add(`hi ${rest}`);
    variants.add(`hey ${rest}`);
  }
  return Array.from(variants).filter(Boolean);
}

function buildVoiceStopPhrases(character?: CharacterProfile, modelName?: string) {
  const names = new Set<string>();
  const addName = (value?: string) => {
    const normalized = normalizeWakePhrase(String(value || '').split(':')[0]);
    if (normalized) {
      names.add(normalized);
    }
  };

  addName(character?.name);
  addName(modelName);

  const stopPhrases = new Set<string>();
  for (const name of names) {
    stopPhrases.add(`bye ${name}`);
    stopPhrases.add(`goodbye ${name}`);
    stopPhrases.add(`stop ${name}`);
    stopPhrases.add(`end call ${name}`);
    stopPhrases.add(`hang up ${name}`);
  }
  return Array.from(stopPhrases);
}

function mergeTranscriptParts(existing: string, next: string) {
  const cleanExisting = existing.replace(/\s+/g, ' ').trim();
  const cleanNext = next.replace(/\s+/g, ' ').trim();
  if (!cleanExisting) {
    return cleanNext;
  }
  if (!cleanNext) {
    return cleanExisting;
  }

  const lowerExisting = cleanExisting.toLowerCase();
  const lowerNext = cleanNext.toLowerCase();
  if (lowerExisting.endsWith(lowerNext)) {
    return cleanExisting;
  }
  if (lowerNext.startsWith(lowerExisting)) {
    return cleanNext;
  }
  return `${cleanExisting} ${cleanNext}`;
}

function phraseMatchesTranscript(phrase: string, transcript: string) {
  if (!phrase || !transcript) {
    return false;
  }
  if (transcript.includes(phrase)) {
    return true;
  }

  const phraseWords = phrase.split(' ').filter(Boolean);
  const transcriptWords = transcript.split(' ').filter(Boolean);
  if (phraseWords.length === 0 || transcriptWords.length === 0) {
    return false;
  }

  for (let start = 0; start <= transcriptWords.length - phraseWords.length; start += 1) {
    const windowWords = transcriptWords.slice(start, start + phraseWords.length);
    if (windowWords.every((word, index) => wakeWordsMatch(phraseWords[index], word))) {
      return true;
    }
  }

  return false;
}

function wakeWordsMatch(expected: string, heard: string) {
  if (expected === heard) {
    return true;
  }
  const wakeAliases: Record<string, string[]> = {
    hey: ['hay', 'hei', 'hi'],
    sarah: ['sara', 'sera', 'saira', 'zara'],
    friday: ['fri day']
  };
  if (wakeAliases[expected]?.includes(heard)) {
    return true;
  }
  if (expected.length <= 3) {
    return false;
  }
  const allowedDistance = expected.length >= 7 ? 2 : 1;
  return editDistance(expected, heard) <= allowedDistance;
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function formatSpeechRecognitionError(error: string) {
  if (error === 'not-allowed' || error === 'service-not-allowed') {
    return 'Microphone permission was blocked.';
  }
  if (error === 'audio-capture') {
    return 'No microphone audio was captured. Check the system default input device.';
  }
  if (error === 'network') {
    return 'Speech recognition could not connect. Try restarting call mode.';
  }
  return `Speech recognition error: ${error}`;
}

function sanitizeForSpeech(value: string) {
  return prepareTextForTts(value);
}

function prepareTextForTts(value: string) {
  const cleaned = stripSilentSectionsForSpeech(value)
    .replace(/\[([^\]\n]{1,180})\]\((https?:\/\/[^\s)]+)\)/gi, '$1')
    .replace(voiceSpeechMarkerPattern(), ' ')
    .replace(/\*[^*\n]{0,240}\*/g, ' ')
    .replace(/^\s*(?:searching|search results for)\s+["“].*?["”]:?\s*/gim, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  const lines = cleaned
    .split(/\n+/)
    .map((line) => normalizeNaturalSpeechText(line))
    .map((line) => addTtsLineEnding(line))
    .filter(Boolean);

  return lines.join(' ').replace(/\s+/g, ' ').trim();
}

function extractVoiceSpeechText(value: string) {
  const segments: string[] = [];
  const patterns = [
    /<\s*lp[-\s]?speak\s*>([\s\S]*?)<\s*\/\s*lp[-\s]?speak\s*>/gi,
    /<\s*speak\s*>([\s\S]*?)<\s*\/\s*speak\s*>/gi,
    /\[speak\]([\s\S]*?)\[\/speak\]/gi
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(value))) {
      const segment = stripSilentSectionsForSpeech(match[1] || '').trim();
      if (segment) {
        segments.push(segment);
      }
    }
  }

  if (segments.length === 0) {
    segments.push(...extractLooseVoiceSpeechSegments(value));
  }

  if (segments.length === 0) {
    return sanitizeForSpeech(value);
  }
  return sanitizeForSpeech(segments.join(' '));
}

function stripVoiceSpeechMarkers(value: string) {
  return value
    .replace(voiceSpeechMarkerPattern(), ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+\n/g, '\n')
    .trim();
}

function extractLooseVoiceSpeechSegments(value: string) {
  const segments: string[] = [];
  const openPattern = /(?:^|\n)\s*(?:<\s*)?(?:lp[-\s]?speak|speak)\s*>\s*/gi;
  const matches = Array.from(value.matchAll(openPattern));
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? value.length;
    let segment = value.slice(start, end);
    const closeIndex = segment.search(/(?:<\s*\/\s*(?:lp[-\s]?speak|speak)\s*>|\/\s*(?:lp[-\s]?speak|speak)\s*>)/i);
    if (closeIndex >= 0) {
      segment = segment.slice(0, closeIndex);
    }
    const cleanSegment = segment.trim();
    if (cleanSegment) {
      segments.push(cleanSegment);
    }
  }
  return segments;
}

function voiceSpeechMarkerPattern() {
  return /<\s*\/?\s*(?:lp[-\s]?speak|speak)\s*>|(?:^|[\s\n])\/?\s*(?:lp[-\s]?speak|speak)\s*>|\[\/?\s*speak\s*\]/gi;
}

function stripSourceSectionsForSpeech(value: string) {
  return value.replace(/(?:^|\n)\s*(?:Sources?|References?|Citations?|Further reading|Links?):\s*[\s\S]*$/i, ' ');
}

function stripSilentSectionsForSpeech(value: string) {
  return value
    .replace(/(?:^|\n)\s*(?:Sources?|References?|Citations?|Further reading|Links?):\s*[\s\S]*$/i, ' ')
    .replace(/\n\s*(?:Related recipes?|More recipes?|Recipe links?|Cake recipes?|Sources? used):\s*[\s\S]*$/i, ' ');
}

function normalizeNaturalSpeechText(value: string) {
  return value
    .replace(/\[([^\]\n]{1,180})\]\((https?:\/\/[^\s)]+)\)/gi, '$1')
    .replace(voiceSpeechMarkerPattern(), ' ')
    .replace(/\*[^*\n]{0,240}\*/g, ' ')
    .replace(/^\s*(?:searching|search results for)\s+["“].*?["”]:?\s*/gim, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b0\.25\s*(?:tsp|teaspoons?)\b/gi, 'a quarter teaspoon')
    .replace(/\b0\.5\s*(?:cups?)\b/gi, 'half a cup')
    .replace(/\b0\.75\s*(?:cups?)\b/gi, 'three quarters of a cup')
    .replace(/\b1\.5\s*(?:cups?)\b/gi, 'one and a half cups')
    .replace(/\b(\d+(?:\.\d+)?)\s*f\b/gi, '$1 degrees Fahrenheit')
    .replace(/\bganulated\b/gi, 'granulated')
    .replace(/\btsp\b/gi, 'teaspoon')
    .replace(/\btbsp\b/gi, 'tablespoon')
    .replace(/\b([a-z][a-z-]+(?:\s+[a-z][a-z-]+){0,2})(?:\s*\/\s*([a-z][a-z-]+(?:\s+[a-z][a-z-]+){0,2})){1,4}\b/gi, (match) =>
      slashListToSpeech(match)
    )
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\s*\/\s*/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addTtsLineEnding(value: string) {
  const line = value.trim();
  if (!line) {
    return '';
  }
  if (/[.!?,;:]$/.test(line) || /[.!?,;:]["')\]]$/.test(line)) {
    return line;
  }
  return `${line}.`;
}

function slashListToSpeech(value: string) {
  const parts = value.split(/\s*\/\s*/).map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return value;
  }
  if (parts.length === 2) {
    return `${parts[0]} and ${parts[1]}`;
  }
  return `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`;
}

function callPhaseLabel(phase: CallPhase, character?: CharacterProfile) {
  if (phase === 'waiting') {
    return `Waiting for "${character?.activationPhrase || `hey ${character?.name || 'there'}`}"`;
  }
  if (phase === 'listening') {
    return 'Listening';
  }
  if (phase === 'thinking') {
    return 'Thinking';
  }
  if (phase === 'speaking') {
    return 'Speaking';
  }
  return 'Call off';
}

function formatModelMeta(model: LocalModel) {
  const details = [model.details?.parameter_size, model.details?.quantization_level].filter(Boolean).join(' / ');
  return details || formatBytes(model.size);
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function formatBytes(size?: number) {
  if (!size) {
    return 'Local model';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = size;
  let unitIndex = 0;
  while (value > 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function isNearBottom(element: HTMLElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 80;
}

function loadTheme(): ThemeMode {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function loadBooleanSetting(key: string, fallback: boolean) {
  try {
    const value = localStorage.getItem(key);
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
  } catch {
    undefined;
  }
  return fallback;
}

function saveBooleanSetting(key: string, value: boolean) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    undefined;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default App;
