import type { ExternalValue } from './types.ts';
import { required, integerInput, invalid, textInput, uuidInput } from './validation.ts';

export type CharadesCategory = '网络热梗' | '网络俚语' | '歇后语' | '成语' | '名词' | '动作' | '抽象词语';
export interface CharadesPrompt { id: string; text: string; category: CharadesCategory; }
export interface CharadesSnapshot { question: CharadesPrompt; revision: number; generation: string; round: number; drawn: number; total: number; }
export interface CharadesNextRequest { revision: number; generation: string; }

function categoryInput(value: ExternalValue, path: string): CharadesCategory {
  if (value !== '网络热梗' && value !== '网络俚语' && value !== '歇后语' && value !== '成语' && value !== '名词' && value !== '动作' && value !== '抽象词语') invalid(path, '有效题目类型', value);
  return value;
}

export function decodeCharadesSnapshot(value: ExternalValue): CharadesSnapshot {
  const question = required(value, 'question', 'response');
  const total = integerInput(required(value, 'total', 'response'), 'response.total', 1, Number.MAX_SAFE_INTEGER);
  return {
    question: { id: textInput(required(question, 'id', 'response.question'), 'response.question.id', 80), text: textInput(required(question, 'text', 'response.question'), 'response.question.text', 100), category: categoryInput(required(question, 'category', 'response.question'), 'response.question.category') },
    revision: integerInput(required(value, 'revision', 'response'), 'response.revision', 1, Number.MAX_SAFE_INTEGER),
    generation: uuidInput(required(value, 'generation', 'response'), 'response.generation'),
    round: integerInput(required(value, 'round', 'response'), 'response.round', 1, Number.MAX_SAFE_INTEGER),
    drawn: integerInput(required(value, 'drawn', 'response'), 'response.drawn', 1, total),
    total,
  };
}

export function charadesNextRequestInput(value: ExternalValue): CharadesNextRequest {
  return { revision: integerInput(required(value, 'revision', 'request'), 'request.revision', 1, Number.MAX_SAFE_INTEGER), generation: uuidInput(required(value, 'generation', 'request'), 'request.generation') };
}
