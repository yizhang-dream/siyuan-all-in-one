import { callLLM, LLMError, parseLLMJSON } from '../llm';
import type { ChatMessage, LLMConfig } from '../llm';
import { createCard } from '../srs';
import type {
    CardCandidate,
    CardType,
    ConceptCandidate,
    PipelineResult,
    RelationCandidate,
    RelationType,
    SourceRef,
} from '../types/concept';
import type { Card } from '../types';
import {
    buildAssignCardsPrompt,
    buildExtractConceptsPrompt,
    buildGenerateCardsPrompt,
    buildInferRelationsPrompt,
    type PromptSourceChunk,
} from './prompts';

export interface PipelineSource {
    id: string;
    text: string;
    type?: SourceRef['type'];
    sourceId?: string;
    blockId?: string;
    chunkId?: string;
    quote?: string;
    page?: number;
    url?: string;
}

export type PipelineStep = 'extract-concepts' | 'infer-relations' | 'generate-cards' | 'assign-cards';

export interface PipelineOptions {
    llmConfig?: LLMConfig;
    language?: string;
    targetCardCount?: number;
    temperature?: number;
    cdfMode?: boolean;
    onStep?: (step: PipelineStep, message: string) => void;
    jsonCaller?: (prompt: string, step: PipelineStep) => Promise<any>;
}

export interface CardAssignment {
    cardIndex: number;
    conceptTempId: string;
    confidence: number;
    reason: string;
}

export interface CardAssignmentResult {
    assignments: CardAssignment[];
    suggestedNewConcepts: Array<{ title: string; summary?: string; cardIndexes: number[] }>;
    needsUserReview: Array<{ cardIndex: number; reason: string }>;
    warnings: string[];
}

export interface CandidateConfirmationOptions {
    acceptedConceptTempIds?: string[];
    acceptedRelationIndexes?: number[];
    acceptedCardIndexes?: number[];
    minConceptConfidence?: number;
    minRelationConfidence?: number;
    minCardConfidence?: number;
    deck?: string;
    tags?: string[];
    save?: boolean;
}

export interface CandidateConfirmationResult {
    conceptIdByTempId: Record<string, string>;
    createdConcepts: string[];
    createdRelations: string[];
    createdCards: string[];
    skippedCards: Array<{ index: number; reason: string }>;
    warnings: string[];
}

export interface ConceptStoreLike {
    create(title: string, summary?: string): { id: string };
    update(id: string, updates: Record<string, unknown>): void;
    addRelation(fromId: string, toId: string, type: RelationType, sourceRefs?: SourceRef[]): { id: string; confidence?: number };
    attachCard(conceptId: string, cardId: string): void;
    save?: () => Promise<void>;
}

export interface CardStoreLike {
    add(card: Card): void;
    isDuplicate?: (question: string) => boolean;
    save?: () => Promise<void>;
}

const VALID_RELATION_TYPES: RelationType[] = [
    'parent_child',
    'prerequisite',
    'contrast',
    'cause_effect',
    'sequence',
    'related',
];

const VALID_CARD_TYPES: CardType[] = ['qa', 'cloze', 'reverse', 'enumeration', 'compare', 'process', 'image-occlusion'];

export async function runPromptPipeline(
    sources: PipelineSource[],
    options: PipelineOptions = {}
): Promise<PipelineResult> {
    const chunks = normalizeSources(sources);
    const language = options.language || 'auto';
    const llmConfig = withLowTemperature(options.llmConfig, options.temperature);
    if (chunks.length === 0) {
        return emptyPipelineResult('No usable source text was provided');
    }
    const warnings: string[] = [];

    options.onStep?.('extract-concepts', 'Extracting concept candidates');
    const conceptPrompt = buildExtractConceptsPrompt(chunks, language);
    const conceptJson = await callStepJson(conceptPrompt, 'extract-concepts', llmConfig, options, warnings);
    const concepts = normalizeConceptCandidates(conceptJson.concepts ?? conceptJson, chunks);
    const uncertain = normalizeUncertain(conceptJson.uncertain);
    warnings.push(...normalizeWarnings(conceptJson.warnings));
    if (concepts.length === 0) {
        warnings.push('No supported concept candidates were extracted; skipped relations and cards');
        return { concepts, relations: [], cards: [], uncertain, warnings };
    }

    options.onStep?.('infer-relations', 'Inferring relation candidates');
    const relationPrompt = buildInferRelationsPrompt(concepts, chunks, language);
    const relationJson = await callStepJson(relationPrompt, 'infer-relations', llmConfig, options, warnings);
    const relations = normalizeRelationCandidates(relationJson.relations ?? relationJson, chunks, concepts);
    uncertain.push(...normalizeUncertain(relationJson.uncertain));
    warnings.push(...normalizeWarnings(relationJson.warnings));

    options.onStep?.('generate-cards', 'Generating card candidates');
    const cardPrompt = buildGenerateCardsPrompt(
        concepts,
        relations,
        chunks,
        options.targetCardCount || Math.max(6, concepts.length * 2),
        language,
        options.cdfMode || false
    );
    const cardJson = await callStepJson(cardPrompt, 'generate-cards', llmConfig, options, warnings);
    let cards = normalizeCardCandidates(cardJson.cards ?? cardJson, chunks, concepts);
    uncertain.push(...normalizeUncertain(cardJson.uncertain));
    warnings.push(...normalizeWarnings(cardJson.warnings));
    if (cards.length === 0) {
        cards = createFallbackCardCandidates(concepts, options.targetCardCount || Math.max(1, concepts.length));
        if (cards.length > 0) {
            warnings.push('No supported card candidates were generated; created conservative review-only cards from extracted concepts');
        }
    }

    return { concepts, relations, cards, uncertain, warnings };
}

function emptyPipelineResult(warning: string): PipelineResult {
    return {
        concepts: [],
        relations: [],
        cards: [],
        uncertain: [],
        warnings: [warning],
    };
}

export async function assignCardsToConcepts(
    concepts: ConceptCandidate[],
    cards: CardCandidate[],
    options: PipelineOptions = {}
): Promise<CardAssignmentResult> {
    const language = options.language || 'auto';
    const warnings: string[] = [];
    options.onStep?.('assign-cards', 'Assigning cards to concepts');
    const json = await callStepJson(
        buildAssignCardsPrompt(concepts, cards, language),
        'assign-cards',
        withLowTemperature(options.llmConfig, options.temperature),
        options,
        warnings
    );

    const conceptIds = new Set(concepts.map((c) => c.tempId));
    const assignments = toArray(json.assignments)
        .map((item: any) => ({
            cardIndex: Math.trunc(toNumber(item?.cardIndex, -1)),
            conceptTempId: toString(item?.conceptTempId),
            confidence: clampConfidence(item?.confidence),
            reason: toString(item?.reason),
        }))
        .filter((item) => item.cardIndex >= 0 && item.cardIndex < cards.length && conceptIds.has(item.conceptTempId));

    const suggestedNewConcepts = toArray(json.suggestedNewConcepts).map((item: any) => ({
        title: toString(item?.title),
        summary: toString(item?.summary) || undefined,
        cardIndexes: toArray(item?.cardIndexes)
            .map((n: any) => Math.trunc(toNumber(n, -1)))
            .filter((n: number) => n >= 0 && n < cards.length),
    })).filter((item) => item.title && item.cardIndexes.length > 0);

    const needsUserReview = toArray(json.needsUserReview).map((item: any) => ({
        cardIndex: Math.trunc(toNumber(item?.cardIndex, -1)),
        reason: toString(item?.reason),
    })).filter((item) => item.cardIndex >= 0 && item.cardIndex < cards.length);

    return {
        assignments,
        suggestedNewConcepts,
        needsUserReview,
        warnings: [...warnings, ...normalizeWarnings(json.warnings)],
    };
}

export async function confirmPipelineResult(
    result: PipelineResult,
    conceptStore: ConceptStoreLike,
    cardStore?: CardStoreLike,
    options: CandidateConfirmationOptions = {}
): Promise<CandidateConfirmationResult> {
    const minConceptConfidence = options.minConceptConfidence ?? 0.65;
    const minRelationConfidence = options.minRelationConfidence ?? 0.7;
    const minCardConfidence = options.minCardConfidence ?? 0.65;
    const acceptedConcepts = options.acceptedConceptTempIds ? new Set(options.acceptedConceptTempIds) : null;
    const acceptedRelations = options.acceptedRelationIndexes ? new Set(options.acceptedRelationIndexes) : null;
    const acceptedCards = options.acceptedCardIndexes ? new Set(options.acceptedCardIndexes) : null;
    const deck = options.deck || '默认';
    const tags = options.tags || [];

    const summary: CandidateConfirmationResult = {
        conceptIdByTempId: {},
        createdConcepts: [],
        createdRelations: [],
        createdCards: [],
        skippedCards: [],
        warnings: [],
    };

    for (const concept of result.concepts) {
        const shouldAccept = acceptedConcepts
            ? acceptedConcepts.has(concept.tempId)
            : concept.confidence >= minConceptConfidence;
        if (!shouldAccept) continue;

        const node = conceptStore.create(concept.title, concept.summary);
        conceptStore.update(node.id, {
            sourceRefs: concept.sourceRefs,
            tags: concept.tags || [],
            confidence: concept.confidence,
        });
        summary.conceptIdByTempId[concept.tempId] = node.id;
        summary.createdConcepts.push(node.id);
    }

    result.relations.forEach((relation, index) => {
        const shouldAccept = acceptedRelations
            ? acceptedRelations.has(index)
            : relation.confidence >= minRelationConfidence;
        if (!shouldAccept) return;
        if (relation.fromTempId === relation.toTempId) {
            summary.warnings.push(`Skipped relation ${index}: self relation is not supported`);
            return;
        }

        const fromId = summary.conceptIdByTempId[relation.fromTempId];
        const toId = summary.conceptIdByTempId[relation.toTempId];
        if (!fromId || !toId) {
            summary.warnings.push(`Skipped relation ${index}: concept was not accepted`);
            return;
        }
        const created = conceptStore.addRelation(fromId, toId, relation.type, relation.sourceRefs);
        created.confidence = relation.confidence;
        summary.createdRelations.push(created.id);
    });

    result.cards.forEach((candidate, index) => {
        const shouldAccept = acceptedCards
            ? acceptedCards.has(index)
            : candidate.confidence >= minCardConfidence;
        if (!shouldAccept) return;

        if (!candidate.front || !candidate.back) {
            summary.skippedCards.push({ index, reason: 'Missing front or back' });
            return;
        }
        if (cardStore?.isDuplicate?.(candidate.front)) {
            summary.skippedCards.push({ index, reason: 'Duplicate question' });
            return;
        }

        const conceptId = candidate.conceptTempId
            ? summary.conceptIdByTempId[candidate.conceptTempId]
            : undefined;
        if (candidate.conceptTempId && !conceptId) {
            summary.skippedCards.push({ index, reason: 'Concept was not accepted' });
            return;
        }

        const card = createCard(
            candidate.front,
            candidate.back,
            candidate.hint || '',
            deck,
            tags,
            undefined,
            candidate.cardType,
            conceptId,
            candidate.sourceRefs
        );
        cardStore?.add(card);
        if (conceptId) conceptStore.attachCard(conceptId, card.id);
        summary.createdCards.push(card.id);
    });

    if (options.save !== false) {
        await conceptStore.save?.();
        await cardStore?.save?.();
    }

    return summary;
}

function normalizeSources(sources: PipelineSource[]): PromptSourceChunk[] {
    return sources
        .map((source, index) => {
            const id = source.id || `source-${index + 1}`;
            const text = toString(source.text).trim();
            if (!text) return null;
            const sourceRef: SourceRef = {
                type: source.type || 'manual',
                sourceId: source.sourceId || id,
                blockId: source.blockId,
                quote: source.quote,
                page: source.page,
            };
            return { id, text, sourceRef };
        })
        .filter(Boolean) as PromptSourceChunk[];
}

async function callJsonObject(prompt: string, config?: LLMConfig): Promise<any> {
    const messages: ChatMessage[] = [
        {
            role: 'system',
            content: 'Return one strict JSON object only. Do not wrap it in markdown.',
        },
        { role: 'user', content: prompt },
    ];
    let content = '';
    try {
        content = await callLLM(messages, { ...config, responseFormat: 'json_object' });
    } catch (err: any) {
        if (!isJsonModeUnsupported(err)) throw err;
        content = await callLLM(messages, config);
    }
    try {
        return coerceStepJson(content);
    } catch (err: any) {
        throw new LLMError(`AI JSON 解析失败: ${err.message}`, 0);
    }
}

async function callStepJson(
    prompt: string,
    step: PipelineStep,
    config: LLMConfig | undefined,
    options: PipelineOptions,
    warnings: string[]
): Promise<any> {
    try {
        if (options.jsonCaller) return coerceStepJson(await options.jsonCaller(prompt, step));
        return await callJsonObject(prompt, config);
    } catch (err: any) {
        const message = `${step} failed: ${err?.message || err}`;
        warnings.push(message);
        return {};
    }
}

function coerceStepJson(raw: any): any {
    if (typeof raw === 'string') {
        return parseLLMJSON(raw, 'object');
    }
    if (!raw || typeof raw !== 'object') {
        return {};
    }
    const embeddedText = extractEmbeddedJsonText(raw);
    if (embeddedText) {
        return parseLLMJSON(embeddedText, 'object');
    }
    return raw;
}

function isJsonModeUnsupported(err: any): boolean {
    if (!(err instanceof LLMError)) return false;
    if (![400, 404, 422].includes(err.status)) return false;
    return /response_format|json|schema|unsupported|unknown parameter|invalid/i.test(err.message || '');
}

function extractEmbeddedJsonText(raw: Record<string, any>): string {
    const candidates = [
        raw.json,
        raw.content,
        raw.text,
        raw.output,
        raw.result,
        raw.message?.content,
        raw.choices?.[0]?.message?.content,
        raw.choices?.[0]?.text,
        raw.output?.[0]?.content,
        raw.output?.[0]?.content?.[0]?.text,
        raw.output?.[0]?.content?.[0]?.content,
        raw.response?.output_text,
        raw.response?.content,
    ];
    for (const candidate of candidates) {
        const text = textFromCandidate(candidate);
        if (text) return text;
    }
    return '';
}

function textFromCandidate(candidate: any): string {
    if (typeof candidate === 'string') return candidate.trim();
    if (Array.isArray(candidate)) {
        return candidate
            .map(textFromCandidate)
            .filter(Boolean)
            .join('\n')
            .trim();
    }
    if (candidate && typeof candidate === 'object') {
        return textFromCandidate(
            candidate.text ??
            candidate.content ??
            candidate.output_text ??
            candidate.message?.content ??
            candidate.value
        );
    }
    return '';
}

function normalizeConceptCandidates(raw: any, chunks: PromptSourceChunk[]): ConceptCandidate[] {
    const seen = new Set<string>();
    return toArray(raw)
        .map((item: any, index) => {
            const title = toString(item?.title || item?.name || item?.concept).trim();
            const tempId = toString(item?.tempId || item?.temp_id || item?.id || `c${index + 1}`).trim();
            if (!title || seen.has(tempId)) return null;
            seen.add(tempId);
            return {
                tempId,
                title,
                summary: toString(item?.summary || item?.description || item?.definition).trim() || undefined,
                tags: toArray(item?.tags).map(toString).filter(Boolean),
                confidence: clampConfidence(item?.confidence),
                sourceRefs: normalizeSourceRefs(item?.sourceRefs || item?.source_refs || item?.evidence || item?.citations, chunks),
            };
        })
        .filter((item: ConceptCandidate | null): item is ConceptCandidate => Boolean(item && item.sourceRefs.length > 0));
}

function normalizeRelationCandidates(
    raw: any,
    chunks: PromptSourceChunk[],
    concepts: ConceptCandidate[]
): RelationCandidate[] {
    const conceptLookup = buildConceptLookup(concepts);
    return toArray(raw)
        .map((item: any) => {
            const fromRaw = item?.fromTempId || item?.from_temp_id || item?.from || item?.source ||
                item?.parentTempId || item?.parent || item?.sourceConcept || item?.source_concept;
            const toRaw = item?.toTempId || item?.to_temp_id || item?.to || item?.target ||
                item?.childTempId || item?.child || item?.targetConcept || item?.target_concept;
            const relation: RelationCandidate = {
                fromTempId: resolveConceptTempId(fromRaw, conceptLookup),
                toTempId: resolveConceptTempId(toRaw, conceptLookup),
                type: normalizeRelationType(item?.type || item?.relation || item?.relationType || item?.relation_type),
                confidence: clampConfidence(item?.confidence),
                sourceRefs: normalizeSourceRefs(
                    item?.sourceRefs || item?.source_refs || item?.evidence || item?.citations ||
                        item?.references || item?.refs,
                    chunks
                ),
            };
            return relation;
        })
        .filter((item) =>
            conceptLookup.byTempId.has(item.fromTempId) &&
            conceptLookup.byTempId.has(item.toTempId) &&
            item.fromTempId !== item.toTempId &&
            item.sourceRefs.length > 0
        );
}

function normalizeCardCandidates(
    raw: any,
    chunks: PromptSourceChunk[],
    concepts: ConceptCandidate[]
): CardCandidate[] {
    const conceptLookup = buildConceptLookup(concepts);
    return toArray(raw)
        .map((item: any) => {
            const cardType = normalizeCardType(item?.cardType || item?.card_type || item?.type);
            const conceptTempId = resolveConceptTempId(
                item?.conceptTempId || item?.concept_temp_id || item?.concept_id || item?.conceptTempID ||
                    item?.conceptId || item?.concept || item?.conceptTitle || item?.concept_title,
                conceptLookup
            );
            const candidate: CardCandidate = {
                conceptTempId: conceptLookup.byTempId.has(conceptTempId) ? conceptTempId : undefined,
                cardType,
                front: toString(item?.front || item?.question || item?.prompt || item?.q).trim(),
                back: toString(item?.back || item?.answer || item?.completion || item?.a).trim(),
                hint: toString(item?.hint).trim() || undefined,
                descriptorDimension: toString(item?.descriptorDimension || item?.descriptor_dimension || item?.dimension).trim() || undefined,
                confidence: clampConfidence(item?.confidence),
                sourceRefs: normalizeSourceRefs(
                    item?.sourceRefs || item?.source_refs || item?.evidence || item?.citations ||
                        item?.sources || item?.references || item?.refs,
                    chunks
                ),
            };
            return candidate;
        })
        .filter((item) => item.front && item.back && item.sourceRefs.length > 0);
}

function createFallbackCardCandidates(
    concepts: ConceptCandidate[],
    targetCount: number
): CardCandidate[] {
    return concepts
        .filter((concept) => concept.title && concept.sourceRefs.length > 0)
        .slice(0, Math.max(0, targetCount))
        .map((concept) => {
            const evidence = concept.sourceRefs.find((ref) => ref.quote)?.quote || '';
            const back = concept.summary || evidence;
            return {
                conceptTempId: concept.tempId,
                cardType: 'qa',
                front: hasCJK(concept.title) ? `什么是${concept.title}？` : `What is ${concept.title}?`,
                back: back || concept.title,
                hint: '由概念摘要自动生成，请人工审核',
                sourceRefs: concept.sourceRefs,
                confidence: Math.min(0.6, concept.confidence),
            } satisfies CardCandidate;
        })
        .filter((card) => card.front && card.back);
}

function normalizeSourceRefs(raw: any, chunks: PromptSourceChunk[]): SourceRef[] {
    const byId = new Map<string, PromptSourceChunk>();
    for (const chunk of chunks) {
        byId.set(chunk.id, chunk);
        if (chunk.sourceRef.sourceId) byId.set(chunk.sourceRef.sourceId, chunk);
        if (chunk.sourceRef.blockId) byId.set(chunk.sourceRef.blockId, chunk);
        // NOTE: chunkId and url are only on PipelineSource, not on SourceRef
    }
    const refs = toArray(raw)
        .flatMap((item: any) => {
            const refId = toString(
                typeof item === 'string'
                    ? item
                    : item?.id || item?.source || item?.source_ref || item?.sourceRef ||
                        item?.sourceId || item?.source_id || item?.chunkId || item?.chunk_id ||
                        item?.blockId || item?.block_id || item?.url
            );
            const matchedById = Boolean(refId && byId.has(refId));
            const itemObj = typeof item === 'string' ? {} : item;
            const quoteText = toString(
                typeof item === 'string'
                    ? (matchedById ? '' : item)
                    : itemObj?.quote || itemObj?.text || itemObj?.excerpt || itemObj?.evidence || itemObj?.content
            ).trim();
            const chunk = byId.get(refId) || findChunkByQuote(quoteText, chunks);
            const base: Partial<SourceRef> = chunk?.sourceRef || {};
            const type = toString(itemObj?.type || base.type || 'manual') as SourceRef['type'];
            const ref: SourceRef = {
                type: isValidSourceType(type) ? type : 'manual',
                sourceId: toString(itemObj?.sourceId || itemObj?.source_id || itemObj?.source || base.sourceId) || undefined,
                blockId: toString(itemObj?.blockId || itemObj?.block_id || base.blockId) || undefined,
                quote: (quoteText || toString(base.quote)).slice(0, 500) || undefined,
                page: toOptionalNumber(itemObj?.page ?? base.page),
            };
            if (!ref.sourceId && !ref.blockId && ref.quote) {
                const matchedChunks = findChunksByQuote(ref.quote, chunks);
                if (matchedChunks.length > 0) {
                    return matchedChunks.map((matched) => ({
                        ...matched.sourceRef,
                        quote: ref.quote,
                    }));
                }
            }
            return [ref];
        })
        .filter((ref) => ref.sourceId || ref.blockId || ref.quote);

    const deduped = dedupeRefs(refs);
    if (deduped.length === 0 && chunks.length === 1) {
        const chunk = chunks[0];
        return [{
            ...chunk.sourceRef,
            quote: chunk.sourceRef.quote || chunk.text.slice(0, 500),
        }];
    }
    return deduped;
}

function findChunkByQuote(quote: string, chunks: PromptSourceChunk[]): PromptSourceChunk | undefined {
    return findChunksByQuote(quote, chunks)[0];
}

function findChunksByQuote(quote: string, chunks: PromptSourceChunk[]): PromptSourceChunk[] {
    const needle = normalizeEvidenceText(quote);
    if (needle.length < 6) return [];
    return chunks.filter((chunk) => {
        const haystack = normalizeEvidenceText(chunk.text);
        return haystack.includes(needle) || needle.includes(haystack);
    });
}

function normalizeEvidenceText(value: string): string {
    return toString(value)
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function dedupeRefs(refs: SourceRef[]): SourceRef[] {
    const seen = new Set<string>();
    const out: SourceRef[] = [];
    for (const ref of refs) {
        const key = [ref.type, ref.sourceId, ref.blockId, ref.page, ref.quote].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(ref);
    }
    return out;
}

function normalizeUncertain(raw: any): Array<{ type: string; content: string; reason: string }> {
    return toArray(raw)
        .map((item: any) => ({
            type: toString(item?.type || 'unknown'),
            content: toString(item?.content),
            reason: toString(item?.reason),
        }))
        .filter((item) => item.content || item.reason);
}

function normalizeWarnings(raw: any): string[] {
    return toArray(raw).map(toString).filter(Boolean);
}

function buildConceptLookup(concepts: ConceptCandidate[]): {
    byTempId: Set<string>;
    byKey: Map<string, string>;
} {
    const byTempId = new Set<string>();
    const byKey = new Map<string, string>();
    for (const concept of concepts) {
        byTempId.add(concept.tempId);
        byKey.set(normalizeKey(concept.tempId), concept.tempId);
        byKey.set(normalizeKey(concept.title), concept.tempId);
    }
    return { byTempId, byKey };
}

function resolveConceptTempId(value: any, lookup: { byKey: Map<string, string> }): string {
    const raw = toString(value).trim();
    if (!raw) return '';
    return lookup.byKey.get(normalizeKey(raw)) || raw;
}

function normalizeRelationType(value: any): RelationType {
    const raw = normalizeKey(value);
    if (VALID_RELATION_TYPES.includes(raw as RelationType)) return raw as RelationType;
    const aliases: Record<string, RelationType> = {
        parentchild: 'parent_child',
        parent_child_relation: 'parent_child',
        parent: 'parent_child',
        child: 'parent_child',
        hierarchical: 'parent_child',
        hierarchy: 'parent_child',
        partof: 'parent_child',
        part_of: 'parent_child',
        contains: 'parent_child',
        isa: 'parent_child',
        is_a: 'parent_child',
        requires: 'prerequisite',
        require: 'prerequisite',
        depends_on: 'prerequisite',
        dependson: 'prerequisite',
        dependency: 'prerequisite',
        before: 'prerequisite',
        contrastive: 'contrast',
        opposite: 'contrast',
        differs_from: 'contrast',
        different_from: 'contrast',
        vs: 'contrast',
        causes: 'cause_effect',
        cause: 'cause_effect',
        effect: 'cause_effect',
        leads_to: 'cause_effect',
        leadsto: 'cause_effect',
        results_in: 'cause_effect',
        sequence_order: 'sequence',
        order: 'sequence',
        next: 'sequence',
        then: 'sequence',
        related_to: 'related',
        association: 'related',
    };
    return aliases[raw] || 'related';
}

function normalizeCardType(value: any): CardType {
    const raw = normalizeKey(value);
    if (VALID_CARD_TYPES.includes(raw as CardType)) return raw as CardType;
    const aliases: Record<string, CardType> = {
        question_answer: 'qa',
        questionanswer: 'qa',
        basic: 'qa',
        front_back: 'qa',
        frontback: 'qa',
        fill_blank: 'cloze',
        fillintheblank: 'cloze',
        fill_in_the_blank: 'cloze',
        blank: 'cloze',
        bidirectional: 'reverse',
        inverse: 'reverse',
        list: 'enumeration',
        steps: 'process',
        procedure: 'process',
        comparison: 'compare',
    };
    return aliases[raw] || 'qa';
}

function withLowTemperature(config?: LLMConfig, temperature?: number): LLMConfig | undefined {
    return {
        ...config,
        temperature: temperature ?? config?.temperature ?? 0.2,
    };
}

function isValidSourceType(value: string): value is SourceRef['type'] {
    return ['siyuan-doc', 'manual', 'source'].includes(value);
}

function clampConfidence(value: any): number {
    const n = toNumber(value, 0.5);
    if (Number.isNaN(n)) return 0.5;
    return Math.max(0, Math.min(1, n));
}

function toNumber(value: any, fallback = 0): number {
    if (value === undefined || value === null || value === '') return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function toOptionalNumber(value: any): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}

function toString(value: any): string {
    if (value === undefined || value === null) return '';
    return String(value);
}

function normalizeKey(value: any): string {
    return toString(value)
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_')
        .replace(/[^\p{L}\p{N}_]+/gu, '');
}

function hasCJK(value: string): boolean {
    return /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(value);
}

function toArray(value: any): any[] {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return [];
    if (looksLikeSingleItem(value)) return [value];
    const wrapped = unwrapArrayContainer(value);
    if (wrapped) return wrapped;
    return Object.values(value);
}

function unwrapArrayContainer(value: Record<string, unknown>): any[] | null {
    const keys = [
        'items',
        'data',
        'results',
        'result',
        'output',
        'outputs',
        'list',
        'records',
        'nodes',
        'edges',
    ];
    for (const key of keys) {
        const child = value[key];
        if (Array.isArray(child)) return child;
    }
    return null;
}

function looksLikeSingleItem(value: Record<string, unknown>): boolean {
    return [
        'title',
        'name',
        'concept',
        'tempId',
        'temp_id',
        'fromTempId',
        'from_temp_id',
        'toTempId',
        'to_temp_id',
        'front',
        'question',
        'answer',
        'sourceId',
        'source_id',
        'chunkId',
        'chunk_id',
        'blockId',
        'block_id',
        'quote',
        'url',
        'cardIndex',
    ].some((key) => Object.prototype.hasOwnProperty.call(value, key));
}
