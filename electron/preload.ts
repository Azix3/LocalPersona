import { contextBridge, ipcRenderer } from 'electron';
import type { ChatToken, LocalSpeechRecognitionEvent, PullProgress, UpdateStatus } from '../src/types';

function subscribe<T>(channel: string, callback: (payload: T) => void) {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('localAI', {
  loadStore: () => ipcRenderer.invoke('store:load'),
  saveCharacter: (character: unknown) => ipcRenderer.invoke('characters:save', character),
  deleteCharacter: (characterId: string) => ipcRenderer.invoke('characters:delete', characterId),
  saveSession: (session: unknown) => ipcRenderer.invoke('sessions:save', session),
  deleteSession: (sessionId: string) => ipcRenderer.invoke('sessions:delete', sessionId),
  updateSettings: (settings: unknown) => ipcRenderer.invoke('settings:update', settings),
  exportStore: () => ipcRenderer.invoke('store:export'),
  importStore: () => ipcRenderer.invoke('store:import'),
  getOllamaStatus: () => ipcRenderer.invoke('ollama:status'),
  ensureOllama: () => ipcRenderer.invoke('ollama:ensure'),
  installOllama: () => ipcRenderer.invoke('ollama:install'),
  listLocalModels: () => ipcRenderer.invoke('models:local'),
  getLibraryModels: () => ipcRenderer.invoke('models:library'),
  pullModel: (model: string) => ipcRenderer.invoke('models:pull', model),
  sendChat: (payload: unknown) => ipcRenderer.invoke('chat:send', payload),
  cancelChat: (requestId: string) => ipcRenderer.invoke('chat:cancel', requestId),
  cleanupVoiceTranscript: (payload: unknown) => ipcRenderer.invoke('voice:cleanup', payload),
  listHuggingFaceTtsModels: () => ipcRenderer.invoke('tts:hf-library'),
  importHuggingFaceTtsModel: (modelId: string) => ipcRenderer.invoke('tts:hf-import', modelId),
  importLocalHuggingFaceTtsModel: () => ipcRenderer.invoke('tts:hf-import-local'),
  synthesizeHuggingFaceTts: (payload: unknown) => ipcRenderer.invoke('tts:hf-synthesize', payload),
  startSpeechRecognition: (options: unknown) => ipcRenderer.invoke('speech:start', options),
  stopSpeechRecognition: () => ipcRenderer.invoke('speech:stop'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  getUpdateStatus: () => ipcRenderer.invoke('updates:status'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  onInstallLog: (callback: (line: string) => void) => subscribe<string>('ollama:install-log', callback),
  onPullProgress: (callback: (progress: PullProgress) => void) => subscribe<PullProgress>('models:pull-progress', callback),
  onChatToken: (callback: (token: ChatToken) => void) => subscribe<ChatToken>('chat:token', callback),
  onSpeechRecognitionEvent: (callback: (event: LocalSpeechRecognitionEvent) => void) => subscribe<LocalSpeechRecognitionEvent>('speech:event', callback),
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => subscribe<UpdateStatus>('updates:status', callback)
});
