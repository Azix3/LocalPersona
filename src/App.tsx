import { useEffect, useMemo, useRef, useState } from 'react';
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
  HardDrive,
  Loader2,
  Moon,
  PackageOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings,
  Sun,
  Trash2,
  UserRound,
  Wand2,
  X
} from 'lucide-react';
import type {
  AppStore,
  CharacterProfile,
  ChatMessage,
  ChatSession,
  LibraryModel,
  LocalModel,
  OllamaStatus,
  PromptMode,
  PullProgress,
  UpdateStatus
} from './types';

type EditorDraft = Partial<CharacterProfile> & { tagsText?: string };
type ThemeMode = 'dark' | 'light';

const avatarColors = ['#1f7a70', '#5750c9', '#c15a32', '#2f6fae', '#8a5a16', '#7b3f75', '#4e6b31', '#b9434a'];
const THEME_STORAGE_KEY = 'localpersona-theme';

function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => loadTheme());
  const [store, setStore] = useState<AppStore | null>(null);
  const [globalUserNameDraft, setGlobalUserNameDraft] = useState('');
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [libraryModels, setLibraryModels] = useState<LibraryModel[]>([]);
  const [characterQuery, setCharacterQuery] = useState('');
  const [modelQuery, setModelQuery] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [draft, setDraft] = useState('');
  const [editorDraft, setEditorDraft] = useState<EditorDraft | null>(null);
  const [variantSelections, setVariantSelections] = useState<Record<string, string>>({});
  const [pullProgress, setPullProgress] = useState<Record<string, PullProgress>>({});
  const [installLines, setInstallLines] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' });

  const autoInstallStarted = useRef(false);
  const messageListRef = useRef<HTMLElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const currentRequestId = useRef<string | null>(null);
  const currentSessionId = useRef<string | null>(null);
  const currentAssistantId = useRef<string | null>(null);
  const [showJumpButton, setShowJumpButton] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

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
    void window.localAI.getUpdateStatus().then(setUpdateStatus).catch(() => undefined);

    return () => {
      offInstall();
      offPull();
      offChat();
      offUpdate();
    };
  }, []);

  useEffect(() => {
    void boot();
  }, []);

  useEffect(() => {
    setGlobalUserNameDraft(store?.userName ?? '');
  }, [store?.userName]);

  useEffect(() => {
    if (!store) {
      return;
    }
    const cleanName = cleanUserName(globalUserNameDraft);
    if (cleanName === (store.userName ?? '')) {
      return;
    }

    const timer = window.setTimeout(() => {
      void saveGlobalUserName(cleanName);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [globalUserNameDraft, store?.userName]);

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

  const localModelNames = useMemo(() => new Set(localModels.map((model) => model.name)), [localModels]);
  const displayedMessages = buildDisplayedMessages(activeCharacter, activeSession);
  const promptMode = activeCharacter?.promptMode ?? 'roleplay';
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

  async function boot() {
    setBusy(true);
    try {
      const [loadedStore, models] = await Promise.all([window.localAI.loadStore(), window.localAI.getLibraryModels()]);
      setStore(loadedStore);
      setLibraryModels(models);

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

  async function saveGlobalUserName(userName: string) {
    if (!store) {
      return;
    }

    const cleanName = cleanUserName(userName);
    setStore({ ...store, userName: cleanName });
    try {
      setStore(await window.localAI.updateSettings({ userName: cleanName }));
    } catch (error) {
      setNotice(errorMessage(error));
    }
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

  async function sendMessage() {
    if (!store || !activeCharacter || !selectedModel || !draft.trim() || streaming) {
      return;
    }

    const requestId = createId();
    const baseSession = activeSession ?? createSession(activeCharacter, selectedModel);
    const baseMessages = baseSession.messages.length > 0 ? baseSession.messages : initialMessages(activeCharacter);
    const userMessage: ChatMessage = {
      id: createId(),
      role: 'user',
      content: draft.trim(),
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
      model: selectedModel,
      messages: [...baseMessages, userMessage, assistantMessage],
      updatedAt: new Date().toISOString()
    };

    currentRequestId.current = requestId;
    currentSessionId.current = pendingSession.id;
    currentAssistantId.current = assistantMessage.id;
    setStreaming(true);
    setDraft('');
    setStore(upsertSessionInStore(store, pendingSession));

    try {
      const response = await window.localAI.sendChat({
        requestId,
        model: selectedModel,
        systemPrompt: activeCharacter.systemPrompt,
        userName: effectiveUserName,
        messages: [...baseMessages, userMessage],
        temperature: activeCharacter.temperature,
        promptMode
      });
      const assistantContent = response.content || 'No response.';
      const finalSession: ChatSession = {
        ...pendingSession,
        messages: [...baseMessages, userMessage, { ...assistantMessage, content: assistantContent, variants: [assistantContent], variantIndex: 0 }],
        updatedAt: new Date().toISOString()
      };
      setStore(await window.localAI.saveSession(finalSession));
    } catch (error) {
      const assistantContent = `Error: ${errorMessage(error)}`;
      const failedSession: ChatSession = {
        ...pendingSession,
        messages: [...baseMessages, userMessage, { ...assistantMessage, content: assistantContent, variants: [assistantContent], variantIndex: 0 }],
        updatedAt: new Date().toISOString()
      };
      setStore(await window.localAI.saveSession(failedSession));
    } finally {
      currentRequestId.current = null;
      currentSessionId.current = null;
      currentAssistantId.current = null;
      setStreaming(false);
    }
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
    const contextMessages = activeSession.messages.slice(0, messageIndex).map(normalizeMessageForPrompt);

    currentRequestId.current = requestId;
    currentSessionId.current = activeSession.id;
    currentAssistantId.current = messageId;
    setStreaming(true);
    setStore(upsertSessionInStore(store, pendingSession));

    try {
      const response = await window.localAI.sendChat({
        requestId,
        model: selectedModel,
        systemPrompt: activeCharacter.systemPrompt,
        userName: effectiveUserName,
        messages: contextMessages,
        temperature: activeCharacter.temperature,
        promptMode
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
      setStore(await window.localAI.saveSession(finalSession));
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
      setStore(await window.localAI.saveSession(failedSession));
    } finally {
      currentRequestId.current = null;
      currentSessionId.current = null;
      currentAssistantId.current = null;
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

  function toggleTheme() {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
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
          <div>
            <strong>LocalPersona</strong>
            <span>Local AI personas</span>
          </div>
        </div>
        <div className="topbar-actions">
          <StatusPill status={ollamaStatus} installing={installing} />
          <UpdateControl status={updateStatus} onCheck={checkForUpdates} onDownload={downloadUpdate} onInstall={installUpdate} />
          <button className="icon-button" title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggleTheme}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button className="icon-button" title="Refresh Ollama" onClick={refreshStatusAndModels} disabled={busy}>
            <RefreshCw size={18} className={busy ? 'spin' : ''} />
          </button>
          <button className="text-button" onClick={importWorkspace}>
            <FileUp size={17} />
            Import
          </button>
          <button className="text-button" onClick={exportWorkspace}>
            <FileDown size={17} />
            Export
          </button>
        </div>
      </header>

      <div className="workspace">
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

          <label className="user-name-card">
            <span>
              <UserRound size={17} />
              Your name
            </span>
            <input
              value={globalUserNameDraft}
              maxLength={80}
              onChange={(event) => setGlobalUserNameDraft(event.target.value)}
              onBlur={() => saveGlobalUserName(globalUserNameDraft)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur();
                }
              }}
              placeholder="What characters call you"
            />
          </label>

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
                  <p>{message.content || (isRegenerating ? 'Thinking...' : '')}</p>
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

        <aside className="right-pane">
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
              <button className="icon-button" title="Open Ollama library" onClick={() => window.localAI.openExternal('https://ollama.com/library')}>
                <PackageOpen size={18} />
              </button>
            </div>

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
          </section>

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
          onClose={() => setEditorDraft(null)}
          onSave={saveCharacter}
          onDelete={deleteCharacter}
        />
      ) : null}
    </div>
  );
}

function CharacterEditor({
  draft,
  globalUserName,
  onClose,
  onSave,
  onDelete
}: {
  draft: EditorDraft;
  globalUserName?: string;
  onClose: () => void;
  onSave: (character: Partial<CharacterProfile>) => Promise<void>;
  onDelete: (characterId: string) => Promise<boolean>;
}) {
  const [form, setForm] = useState<EditorDraft>(draft);

  function update<K extends keyof EditorDraft>(key: K, value: EditorDraft[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
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
          <label className="wide">
            Description
            <textarea value={form.description || ''} onChange={(event) => update('description', event.target.value)} />
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
      {initials(character.name)}
    </span>
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
    systemPrompt: '',
    greeting: '',
    tagsText: '',
    avatarColor: avatarColors[0],
    temperature: 0.7,
    promptMode: 'roleplay'
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
    content: getMessageVersions(message)[getMessageVersionIndex(message)]
  };
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

function formatModelMeta(model: LocalModel) {
  const details = [model.details?.parameter_size, model.details?.quantization_level].filter(Boolean).join(' / ');
  return details || formatBytes(model.size);
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default App;
