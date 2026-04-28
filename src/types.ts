export type ChatRole = 'system' | 'user' | 'assistant';
export type PromptMode = 'roleplay' | 'assistant';

export type CharacterProfile = {
  id: string;
  name: string;
  userName?: string;
  subtitle: string;
  description: string;
  systemPrompt: string;
  greeting: string;
  tags: string[];
  avatarColor: string;
  temperature: number;
  promptMode: PromptMode;
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
  messages: ChatMessage[];
  temperature: number;
  promptMode?: PromptMode;
};

export type ChatToken = {
  requestId: string;
  token: string;
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
