/*
 * 对话会话持久化层。
 * 双文件存储：
 *   - 轻量索引：loadData/saveData 读写 chat-sessions.json
 *   - 消息负载：SiYuan file API 读写 /data/storage/petal/siyuan-all-in-one/sessions/{id}.json
 */

export interface ContextDocument {
  sourceId: string;
  title: string;
  chunkText: string;  // first 200 chars of the chunk text
  score: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  sources?: { chunk: { id: string; sourceId: string; text: string; metadata: any }; score: number }[];
  contextDocuments?: ContextDocument[];  // source context for this message
  /** Agent: tool_calls on assistant messages */
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  /** Agent: tool_call_id for tool result messages */
  tool_call_id?: string;
  /** Agent: tool name for tool result messages */
  name?: string;
}

export interface SessionIndex {
  id: string;
  title: string;
  messageCount: number;
  sourceIds: string[];
  createdAt: number;
  updatedAt: number;
}

const SESSION_DIR = '/data/storage/petal/siyuan-all-in-one/sessions';
const INDEX_KEY = 'chat-sessions.json';

export class ConversationStore {
  private sessions: SessionIndex[] = [];
  private loadedMessages: Map<string, ChatMessage[]> = new Map();
  private plugin: any;
  private apiBase: string;

  constructor(plugin: any) {
    this.plugin = plugin;
    this.apiBase = this.getApiBase();
  }

  private getApiBase(): string {
    try {
      return (this.plugin as any).app?.kernel?.origin || 'http://127.0.0.1:6806';
    } catch {
      return 'http://127.0.0.1:6806';
    }
  }

  private async putSessionFile(id: string, messages: ChatMessage[]): Promise<void> {
    const path = `${SESSION_DIR}/${id}.json`;
    const blob = new Blob([JSON.stringify({ messages })], { type: 'application/json' });
    const form = new FormData();
    form.append('path', path);
    form.append('file', blob);
    form.append('isDir', 'false');
    await fetch(`${this.apiBase}/api/file/putFile`, { method: 'POST', body: form });
  }

  private async getSessionFile(id: string): Promise<ChatMessage[] | null> {
    const path = `${SESSION_DIR}/${id}.json`;
    const resp = await fetch(`${this.apiBase}/api/file/getFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!resp.ok) return null;
    const result = await resp.json();
    // SiYuan wraps responses in { code, data }; data may be parsed JSON or base64
    let data = result.code === 0 ? result.data : result;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(atob(data));
      } catch {
        return null;
      }
    }
    return data?.messages || null;
  }

  private async deleteSessionFile(id: string): Promise<void> {
    const path = `${SESSION_DIR}/${id}.json`;
    await fetch(`${this.apiBase}/api/file/removeFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
  }

  async load(): Promise<void> {
    // Migration from old 'conversations' key
    try {
      const oldData = await this.plugin.loadData('conversations');
      if (Array.isArray(oldData) && oldData.length > 0) {
        for (const conv of oldData) {
          const messages: ChatMessage[] = conv.messages || [];
          await this.putSessionFile(conv.id, messages);
          this.sessions.push({
            id: conv.id,
            title: conv.title || '新对话',
            messageCount: messages.length,
            sourceIds: conv.sourceIds || [],
            createdAt: conv.createdAt || Date.now(),
            updatedAt: conv.updatedAt || Date.now(),
          });
        }
        await this.save();
        // Clear old data key
        await this.plugin.saveData('conversations', []);
        return;
      }
    } catch {
      // No old data — proceed to normal load
    }

    // Normal load of lightweight index
    try {
      const data = await this.plugin.loadData(INDEX_KEY);
      if (data && Array.isArray(data.sessions)) {
        this.sessions = data.sessions;
      } else {
        this.sessions = [];
      }
    } catch {
      this.sessions = [];
    }
  }

  async save(): Promise<void> {
    await this.plugin.saveData(INDEX_KEY, { sessions: this.sessions });
  }

  getAll(): SessionIndex[] {
    return [...this.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getById(id: string): SessionIndex | null {
    return this.sessions.find(s => s.id === id) ?? null;
  }

  async getMessages(id: string): Promise<ChatMessage[]> {
    const cached = this.loadedMessages.get(id);
    if (cached) return cached;
    const messages = await this.getSessionFile(id);
    if (messages) {
      this.loadedMessages.set(id, messages);
      return messages;
    }
    return [];
  }

  create(firstMessage?: ChatMessage, sourceIds?: string[]): SessionIndex {
    const id = crypto.randomUUID();
    const title = firstMessage
      ? firstMessage.content.split('\n')[0].trim().slice(0, 30) || '新对话'
      : '新对话';
    const now = Date.now();
    const session: SessionIndex = {
      id,
      title,
      messageCount: firstMessage ? 1 : 0,
      sourceIds: sourceIds ?? [],
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.push(session);

    if (firstMessage) {
      const messages = [firstMessage];
      this.loadedMessages.set(id, messages);
      this.putSessionFile(id, messages);
    }

    this.save();
    return session;
  }

  async addMessage(id: string, message: ChatMessage): Promise<void> {
    let messages = this.loadedMessages.get(id);
    if (!messages) {
      messages = (await this.getSessionFile(id)) || [];
      this.loadedMessages.set(id, messages);
    }
    messages.push(message);

    const session = this.sessions.find(s => s.id === id);
    if (session) {
      session.messageCount = messages.length;
      session.updatedAt = Date.now();
    }

    await Promise.all([this.putSessionFile(id, messages), this.save()]);
  }

  async updateLastMessage(id: string, content: string): Promise<void> {
    let messages = this.loadedMessages.get(id);
    if (!messages) {
      messages = (await this.getSessionFile(id)) || [];
      this.loadedMessages.set(id, messages);
    }
    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === 'assistant') {
        lastMsg.content = content;
        const session = this.sessions.find(s => s.id === id);
        if (session) session.updatedAt = Date.now();
        await Promise.all([this.putSessionFile(id, messages), this.save()]);
      }
    }
  }

  async delete(id: string): Promise<void> {
    this.sessions = this.sessions.filter(s => s.id !== id);
    this.loadedMessages.delete(id);
    await Promise.all([this.deleteSessionFile(id), this.save()]);
  }

  rename(id: string, title: string): void {
    const session = this.sessions.find(s => s.id === id);
    if (session) {
      session.title = title.substring(0, 50);
      session.updatedAt = Date.now();
      this.save();
    }
  }

  async update(id: string, partial: Partial<{ title: string; messages: ChatMessage[] }>): Promise<void> {
    const session = this.sessions.find(s => s.id === id);
    if (!session) return;

    if (partial.title !== undefined) {
      session.title = partial.title.substring(0, 50);
    }
    if (partial.messages !== undefined) {
      this.loadedMessages.set(id, partial.messages);
      await this.putSessionFile(id, partial.messages);
      session.messageCount = partial.messages.length;
    }

    session.updatedAt = Date.now();
    await this.save();
  }
}
