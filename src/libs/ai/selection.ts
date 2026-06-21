import type { CandidateConfirmationOptions } from './pipeline';
import type { PipelineResult } from '../types/concept';

export interface CandidateSelectionThresholds {
    minConceptConfidence?: number;
    minRelationConfidence?: number;
    minCardConfidence?: number;
}

export interface CandidateSelectionState {
    conceptTempIds: Set<string>;
    relationIndexes: Set<number>;
    cardIndexes: Set<number>;
}

export function createCandidateSelection(
    result: PipelineResult,
    thresholds: CandidateSelectionThresholds = {}
): CandidateSelectionState {
    const minConceptConfidence = thresholds.minConceptConfidence ?? 0.65;
    const minRelationConfidence = thresholds.minRelationConfidence ?? 0.7;
    const minCardConfidence = thresholds.minCardConfidence ?? 0.65;

    const conceptTempIds = new Set(
        result.concepts
            .filter((concept) => concept.confidence >= minConceptConfidence)
            .map((concept) => concept.tempId)
    );

    const relationIndexes = new Set<number>();
    result.relations.forEach((relation, index) => {
        if (
            relation.confidence >= minRelationConfidence &&
            relation.fromTempId !== relation.toTempId &&
            conceptTempIds.has(relation.fromTempId) &&
            conceptTempIds.has(relation.toTempId)
        ) {
            relationIndexes.add(index);
        }
    });

    const cardIndexes = new Set<number>();
    result.cards.forEach((card, index) => {
        if (
            card.confidence >= minCardConfidence &&
            (!card.conceptTempId || conceptTempIds.has(card.conceptTempId))
        ) {
            cardIndexes.add(index);
        }
    });

    return { conceptTempIds, relationIndexes, cardIndexes };
}

export function buildConfirmationOptions(
    selection: CandidateSelectionState,
    extra: Omit<
        CandidateConfirmationOptions,
        'acceptedConceptTempIds' | 'acceptedRelationIndexes' | 'acceptedCardIndexes'
    > = {}
): CandidateConfirmationOptions {
    return {
        ...extra,
        acceptedConceptTempIds: [...selection.conceptTempIds],
        acceptedRelationIndexes: [...selection.relationIndexes],
        acceptedCardIndexes: [...selection.cardIndexes],
    };
}

export function trimSelectionForAcceptedConcepts(
    result: PipelineResult,
    selection: CandidateSelectionState
): CandidateSelectionState {
    const conceptTempIds = new Set(selection.conceptTempIds);
    const relationIndexes = new Set<number>(
        [...selection.relationIndexes].filter((index) => {
            const relation = result.relations[index];
            return Boolean(
                relation &&
                relation.fromTempId !== relation.toTempId &&
                conceptTempIds.has(relation.fromTempId) &&
                conceptTempIds.has(relation.toTempId)
            );
        })
    );
    const cardIndexes = new Set<number>(
        [...selection.cardIndexes].filter((index) => {
            const card = result.cards[index];
            return Boolean(card && (!card.conceptTempId || conceptTempIds.has(card.conceptTempId)));
        })
    );
    return { conceptTempIds, relationIndexes, cardIndexes };
}
