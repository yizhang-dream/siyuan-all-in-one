import { callLLM, parseLLMJSON, type LLMConfig } from './llm';

export interface MindmapTopic {
    id: string;
    title: string;
    depth: number;
    path: string[];
}

export interface MindmapCardDraft {
    front: string;
    back: string;
    hint?: string;
    topicTitle?: string;
    topicPath: string[];
    confidence: number;
}

export function extractMindmapTopics(markdown: string): MindmapTopic[] {
    const stack: MindmapTopic[] = [];
    const topics: MindmapTopic[] = [];
    const seen = new Set<string>();

    markdown
        .replace(/```(?:mindmap|markdown)?/g, '')
        .replace(/```/g, '')
        .split(/\r?\n/)
        .forEach((line, index) => {
            const match = line.match(/^(\s*)-\s+(.+?)\s*$/);
            if (!match) return;
            const depth = Math.floor(match[1].replace(/\t/g, '  ').length / 2);
            const title = cleanMindmapNodeText(match[2]);
            if (!title) return;
            stack.length = Math.min(stack.length, depth);
            const path = [...stack.map((item) => item.title), title];
            const key = path.join(' > ').toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            const topic: MindmapTopic = {
                id: `t${index + 1}`,
                title,
                depth,
                path,
            };
            stack[depth] = topic;
            topics.push(topic);
        });

    return topics.filter((topic) => topic.path.length > 1 || topics.length === 1);
}

export function buildMindmapToCardsPrompt(topics: MindmapTopic[], targetCount: number, language = 'zh-CN'): string {
    const clippedTopics = topics.slice(0, 80).map((topic) => ({
        id: topic.id,
        title: topic.title,
        path: topic.path.join(' > '),
    }));
    return `你是一位学习科学和学科教学专家。请根据思维导图节点生成高质量闪卡。

语言：${language}
目标卡片数：${targetCount}

要求：
1. 只基于给定的思维导图节点，不要引入外部知识细节。
2. 优先为叶子节点、定义性节点、对比节点、流程节点生成卡片。
3. 每张卡片必须可独立复习，问题明确，答案简洁但完整。
4. 如果节点信息不足，只生成保守的概念辨认或关系理解卡，不要编造定义。
5. 公式保持 LaTeX 定界符，例如 $F = ma$。
6. 返回严格 JSON object，不要 markdown，不要解释。

输出格式：
{
  "cards": [
    {
      "front": "问题",
      "back": "答案",
      "hint": "提示，可为空",
      "topicId": "t1",
      "topicTitle": "节点标题",
      "topicPath": ["根节点", "子节点"],
      "confidence": 0.0
    }
  ],
  "warnings": []
}

思维导图节点：
${JSON.stringify(clippedTopics, null, 2)}`;
}

export async function generateMindmapCardDrafts(
    markdown: string,
    llmConfig: LLMConfig,
    targetCount = 8,
    language = 'zh-CN'
): Promise<{ cards: MindmapCardDraft[]; warnings: string[]; topics: MindmapTopic[] }> {
    const topics = extractMindmapTopics(markdown);
    if (topics.length === 0) {
        return { cards: [], warnings: ['No usable mindmap topics found'], topics };
    }
    const prompt = buildMindmapToCardsPrompt(topics, Math.max(1, Math.min(50, targetCount)), language);
    const content = await callLLM(
        [
            { role: 'system', content: 'Return one strict JSON object only. Do not wrap it in markdown.' },
            { role: 'user', content: prompt },
        ],
        { ...llmConfig, temperature: 0.25 }
    );
    const parsed = parseLLMJSON(content, 'object');
    return {
        cards: normalizeMindmapCardDrafts(parsed?.cards ?? parsed, topics).slice(0, Math.max(1, Math.min(50, targetCount))),
        warnings: Array.isArray(parsed?.warnings) ? parsed.warnings.map(String).filter(Boolean) : [],
        topics,
    };
}

export function normalizeMindmapCardDrafts(raw: any, topics: MindmapTopic[]): MindmapCardDraft[] {
    const byId = new Map(topics.map((topic) => [topic.id, topic]));
    const byTitle = new Map(topics.map((topic) => [normalizeKey(topic.title), topic]));
    const seen = new Set<string>();
    return toArray(raw)
        .map((item: any) => {
            const front = toString(item?.front || item?.question || item?.prompt).trim();
            const back = toString(item?.back || item?.answer || item?.completion).trim();
            if (!front || !back) return null;
            const topic = byId.get(toString(item?.topicId || item?.topic_id)) ||
                byTitle.get(normalizeKey(item?.topicTitle || item?.topic || item?.title));
            const topicPath = Array.isArray(item?.topicPath)
                ? item.topicPath.map(toString).filter(Boolean)
                : topic?.path || [];
            const key = normalizeKey(front);
            if (!key || seen.has(key)) return null;
            seen.add(key);
            return {
                front,
                back,
                hint: toString(item?.hint).trim() || undefined,
                topicTitle: toString(item?.topicTitle || topic?.title).trim() || undefined,
                topicPath,
                confidence: clampConfidence(item?.confidence),
            };
        })
        .filter((item: MindmapCardDraft | null): item is MindmapCardDraft => Boolean(item));
}

function cleanMindmapNodeText(text: string): string {
    return text
        .replace(/<!--.*?-->/g, '')
        .replace(/#[A-Za-z0-9_-]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeKey(value: any): string {
    return toString(value)
        .replace(/\s+/g, '')
        .replace(/[，。？！,.?!:;：；"'`“”‘’]/g, '')
        .toLowerCase();
}

function toArray(value: any): any[] {
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null) return [];
    return [value];
}

function toString(value: any): string {
    if (value === undefined || value === null) return '';
    return String(value);
}

function clampConfidence(value: any): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0.7;
    return Math.max(0, Math.min(1, n));
}
