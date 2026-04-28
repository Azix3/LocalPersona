/// <reference types="vite/client" />

import type {
  AppStore,
  CharacterProfile,
  ChatPayload,
  ChatSession,
  ChatToken,
  ImportResult,
  LibraryModel,
  LocalModel,
  OllamaStatus,
  PullProgress,
  UpdateStatus
} from './types';

type Unsubscribe = () => void;

declare global {
  interface Window {
    localAI: {
      loadStore: () => Promise<AppStore>;
      saveCharacter: (character: Partial<CharacterProfile>) => Promise<AppStore>;
      deleteCharacter: (characterId: string) => Promise<AppStore>;
      saveSession: (session: ChatSession) => Promise<AppStore>;
      deleteSession: (sessionId: string) => Promise<AppStore>;
      updateSettings: (settings: Partial<Pick<AppStore, 'selectedCharacterId' | 'selectedModel'>>) => Promise<AppStore>;
      exportStore: () => Promise<{ path?: string; canceled: boolean }>;
      importStore: () => Promise<ImportResult & { store?: AppStore }>;
      getOllamaStatus: () => Promise<OllamaStatus>;
      ensureOllama: () => Promise<OllamaStatus>;
      installOllama: () => Promise<OllamaStatus>;
      listLocalModels: () => Promise<LocalModel[]>;
      getLibraryModels: () => Promise<LibraryModel[]>;
      pullModel: (model: string) => Promise<LocalModel[]>;
      sendChat: (payload: ChatPayload) => Promise<{ content: string }>;
      cancelChat: (requestId: string) => Promise<boolean>;
      checkForUpdates: () => Promise<UpdateStatus>;
      getUpdateStatus: () => Promise<UpdateStatus>;
      downloadUpdate: () => Promise<UpdateStatus>;
      installUpdate: () => Promise<UpdateStatus>;
      openExternal: (url: string) => Promise<void>;
      onInstallLog: (callback: (line: string) => void) => Unsubscribe;
      onPullProgress: (callback: (progress: PullProgress) => void) => Unsubscribe;
      onChatToken: (callback: (token: ChatToken) => void) => Unsubscribe;
      onUpdateStatus: (callback: (status: UpdateStatus) => void) => Unsubscribe;
    };
  }
}
