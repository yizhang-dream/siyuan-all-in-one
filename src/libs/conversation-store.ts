/*
 * 对话会话持久化层。
 * 存储键：'conversations'
 */

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: { chunk: { id: string; sourceId: string; text: string; metadata: any }; score: number }[];
}

export interface ConversationSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  sourceIds: string[];
  createdAt: number;
  updatedAt: number;
}

export class ConversationStore {
  private sessions: ConversationSession[] = [];
  private plugin: any;

  constructor(plugin: any) {
    this.plugin = plugin;
  }

  async load(): Promise<void> {
    try {
      const data = await this.plugin.loadData('conversations');
      this.sessions = Array.isArray(data) ? data : [];
    } catch {
      this.sessions = [];
    }
  }

  async save(): Promise<void> {
    await this.plugin.saveData('conversations', this.sessions);
  }

  getAll(): ConversationSession[] {
    return [...this.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getById(id: string): ConversationSession | null {
    return this.sessions.find(s => s.id === id) ?? null;
  }

  create(firstMessage?: ChatMessage, sourceIds?: string[]): ConversationSession {
    const id = crypto.randomUUID();
    const title = firstMessage
      ? firstMessage.content.split('\n')[0].trim().slice(0, 30) || '新对话'
      : '新对话';
    const now = Date.now();
    const session: ConversationSession = {
      id,
      title,
      messages: firstMessage ? [firstMessage] : [],
      sourceIds: sourceIds ?? [],
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.push(session);
    this.save();
    return session;
  }

  update(id: string, partial: Partial<ConversationSession>): void {
    const idx = this.sessions.findIndex(s => s.id === id);
    if (idx >= 0) {
      Object.assign(this.sessions[idx], partial, { updatedAt: Date.now() });
      this.save();
    }
  }

  rename(id: string, title: string): void {
    const session = this.sessions.find(s => s.id === id);
    if (session) {
      session.title = title.substring(0, 50);
      session.updatedAt = Date.now();
      this.save();
    }
  }

  delete(id: string): void {
    this.sessions = this.sessions.filter(s => s.id !== id);
    this.save();
  }

  addMessage(id: string, message: ChatMessage): void {
    const session = this.sessions.find(s => s.id === id);
    if (session) {
      session.messages.push(message);
      session.updatedAt = Date.now();
      this.save();
    }
  }

  updateLastMessage(id: string, content: string): void {
    const session = this.sessions.find(s => s.id === id);
    if (session && session.messages.length > 0) {
      const lastMsg = session.messages[session.messages.length - 1];
      if (lastMsg.role === 'assistant') {
        lastMsg.content = content;
        session.updatedAt = Date.now();
        this.save();
      }
    }
  }
}
