export type ChatRole = 'system' | 'user' | 'assistant';
export type PromptMode = 'roleplay' | 'assistant';
export type SpeechRecognitionEngine = 'browser' | 'vosk' | 'windows' | 'auto';
export type TtsProvider = 'system' | 'huggingface';
export type HuggingFaceTtsDtype = 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';

export type HuggingFaceTtsSpeaker = {
  id: string;
  name: string;
  embedding?: string;
};

export type HuggingFaceTtsModel = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  speakers?: HuggingFaceTtsSpeaker[];
  defaultSpeakerEmbedding?: string;
  defaultDtype?: HuggingFaceTtsDtype;
  requiresSpeakerEmbeddings?: boolean;
  downloads?: number;
  likes?: number;
  imported?: boolean;
  localPath?: string;
};

export type CharacterProfile = {
  id: string;
  name: string;
  userName?: string;
  aboutUser?: string;
  subtitle: string;
  description: string;
  systemPrompt: string;
  greeting: string;
  tags: string[];
  avatarColor: string;
  avatarImage?: string;
  temperature: number;
  promptMode: PromptMode;
  webSearchEnabled?: boolean;
  callEnabled?: boolean;
  activationPhrase?: string;
  activationResponse?: string;
  voiceName?: string;
  ttsProvider?: TtsProvider;
  hfTtsModel?: string;
  hfTtsSpeaker?: string;
  hfTtsDtype?: HuggingFaceTtsDtype;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessage = {
  id: string;
  role: Exclude<ChatRole, 'system'>;
  content: string;
  variants?: string[];
  variantIndex?: number;
  createdAt: string;
};

export type ChatSession = {
  id: string;
  characterId: string;
  model: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: string;
};

export type AppStore = {
  version: number;
  characters: CharacterProfile[];
  sessions: ChatSession[];
  userName?: string;
  selectedInputDeviceId?: string;
  selectedOutputDeviceId?: string;
  microphoneSensitivity?: number;
  speechRecognitionEngine?: SpeechRecognitionEngine;
  experimentalVoiceFeatures?: boolean;
  experimentalContinuousVoiceConversation?: boolean;
  experimentalVoiceCleanup?: boolean;
  hfTtsModels?: HuggingFaceTtsModel[];
  selectedCharacterId?: string;
  selectedSessionId?: string;
  selectedModel?: string;
};

export type OllamaStatus = {
  installed: boolean;
  running: boolean;
  version?: string;
  path?: string;
  error?: string;
};

export type LocalModel = {
  name: string;
  modifiedAt?: string;
  size?: number;
  digest?: string;
  details?: {
    parent_model?: string;
    format?: string;
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
};

export type LibraryModel = {
  name: string;
  description: string;
  tags: string[];
  variants: string[];
  pulls?: string;
  updated?: string;
};

export type PullProgress = {
  model: string;
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
};

export type ChatPayload = {
  requestId: string;
  model: string;
  systemPrompt: string;
  userName?: string;
  aboutUser?: string;
  messages: ChatMessage[];
  temperature: number;
  promptMode?: PromptMode;
  webSearchEnabled?: boolean;
  voiceResponse?: boolean;
};

export type ChatToken = {
  requestId: string;
  token: string;
};

export type VoiceCleanupPayload = {
  model: string;
  transcript: string;
  characterName?: string;
  userName?: string;
  messages?: ChatMessage[];
};

export type VoiceCleanupResult = {
  original: string;
  corrected: string;
  changed: boolean;
  confidence: number;
  model?: string;
};

export type HuggingFaceTtsPayload = {
  text: string;
  model: string;
  speakerEmbedding?: string;
  dtype?: HuggingFaceTtsDtype;
};

export type HuggingFaceTtsResult = {
  audioDataUrl: string;
  samplingRate: number;
  model: string;
};

export type LocalSpeechRecognitionEvent = {
  type: 'ready' | 'transcript' | 'level' | 'error' | 'end';
  engine: 'windows' | 'browser' | 'vosk';
  transcript?: string;
  alternatives?: string[];
  confidence?: number;
  audioLevel?: number;
  audioState?: string;
  isFinal?: boolean;
  message?: string;
};

export type ImportResult = {
  importedCharacters: number;
  importedSessions: number;
  skipped: boolean;
};

export type UpdateState = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
export type UpdatePackageKind = 'development' | 'installer' | 'portable';

export type UpdateStatus = {
  state: UpdateState;
  packageKind?: UpdatePackageKind;
  currentVersion?: string;
  version?: string;
  percent?: number;
  message?: string;
};
