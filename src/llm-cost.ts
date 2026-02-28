import { LlmPlatform, LlmResponseBase } from '@little-samo/samo-ai';

export interface LlmCostPerMillionTokens {
  platform: LlmPlatform;
  model: string;
  thinking?: boolean;
  input: number;
  cachedInput?: number;
  cacheCreation?: number;
  output: number;
  imageOutput?: number;
}

export const LlmCosts: LlmCostPerMillionTokens[] = [
  // ========================================
  // OPENAI MODELS
  // ========================================
  {
    platform: LlmPlatform.OPENAI,
    model: 'gpt-4.5-preview',
    input: 75,
    cachedInput: 37.5,
    output: 150,
  },
  {
    platform: LlmPlatform.OPENAI,
    model: 'gpt-4o-mini',
    input: 0.15,
    cachedInput: 0.075,
    output: 0.6,
  },
  {
    platform: LlmPlatform.OPENAI,
    model: 'gpt-4o',
    input: 2.5,
    cachedInput: 1.25,
    output: 10,
  },
  {
    platform: LlmPlatform.OPENAI,
    model: 'gpt-4.1-mini',
    input: 0.4,
    cachedInput: 0.1,
    output: 1.6,
  },
  {
    platform: LlmPlatform.OPENAI,
    model: 'gpt-4.1-nano',
    input: 0.1,
    cachedInput: 0.025,
    output: 0.4,
  },
  {
    platform: LlmPlatform.OPENAI,
    model: 'gpt-4.1',
    input: 2,
    cachedInput: 0.5,
    output: 8,
  },
  {
    platform: LlmPlatform.OPENAI,
    model: 'gpt-5.2-pro',
    input: 21,
    output: 168,
  },
  {
    platform: LlmPlatform.OPENAI,
    model: 'gpt-5.2',
    input: 1.75,
    cachedInput: 0.175,
    output: 14,
  },
  {
    platform: LlmPlatform.OPENAI,
    model: 'gpt-5.1',
    input: 1.25,
    cachedInput: 0.125,
    output: 10,
  },
  {
    platform: LlmPlatform.OPENAI,
    model: 'gpt-5-pro',
    input: 15,
    output: 120,
  },
  {
    platform: LlmPlatform.OPENAI,
    model: 'gpt-5-mini',
    input: 0.25,
    cachedInput: 0.0025,
    output: 2,
  },
  {
    platform: LlmPlatform.OPENAI,
    model: 'gpt-5-nano',
    input: 0.05,
    cachedInput: 0.005,
    output: 0.4,
  },
  {
    platform: LlmPlatform.OPENAI,
    model: 'gpt-5',
    input: 1.25,
    cachedInput: 0.125,
    output: 10,
  },
  {
    platform: LlmPlatform.OPENAI,
    model: 'o1-mini',
    input: 1.1,
    cachedInput: 0.55,
    output: 4.4,
  },
  {
    platform: LlmPlatform.OPENAI,
    model: 'o1-pro',
    input: 150,
    output: 600,
  },
  {
    platform: LlmPlatform.OPENAI,
    model: 'o1',
    input: 15,
    cachedInput: 7.5,
    output: 60,
  },
  {
    platform: LlmPlatform.OPENAI,
    model: 'o3-mini',
    input: 1.1,
    cachedInput: 0.55,
    output: 4.4,
  },
  {
    platform: LlmPlatform.OPENAI,
    model: 'o3',
    input: 10,
    cachedInput: 2.5,
    output: 40,
  },
  {
    platform: LlmPlatform.OPENAI,
    model: 'o4-mini',
    input: 1.1,
    cachedInput: 0.275,
    output: 4.4,
  },

  // ========================================
  // ANTHROPIC MODELS
  // ========================================
  {
    platform: LlmPlatform.ANTHROPIC,
    model: 'claude-opus-4-6',
    input: 5,
    cacheCreation: 6.25,
    cachedInput: 0.5,
    output: 25,
  },
  {
    platform: LlmPlatform.ANTHROPIC,
    model: 'claude-sonnet-4-6',
    input: 3,
    cacheCreation: 3.75,
    cachedInput: 0.3,
    output: 15,
  },
  {
    platform: LlmPlatform.ANTHROPIC,
    model: 'claude-opus-4-5',
    input: 5,
    cacheCreation: 6.25,
    cachedInput: 0.5,
    output: 25,
  },
  {
    platform: LlmPlatform.ANTHROPIC,
    model: 'claude-sonnet-4-5',
    input: 3,
    cacheCreation: 3.75,
    cachedInput: 0.3,
    output: 15,
  },
  {
    platform: LlmPlatform.ANTHROPIC,
    model: 'claude-haiku-4-5',
    input: 1,
    cacheCreation: 1.25,
    cachedInput: 0.1,
    output: 5,
  },
  {
    platform: LlmPlatform.ANTHROPIC,
    model: 'claude-opus-4-1',
    input: 15,
    cacheCreation: 18.75,
    cachedInput: 1.5,
    output: 75,
  },
  {
    platform: LlmPlatform.ANTHROPIC,
    model: 'claude-opus-4',
    input: 15,
    cacheCreation: 18.75,
    cachedInput: 1.5,
    output: 75,
  },
  {
    platform: LlmPlatform.ANTHROPIC,
    model: 'claude-sonnet-4',
    input: 3,
    cacheCreation: 3.75,
    cachedInput: 0.3,
    output: 15,
  },
  {
    platform: LlmPlatform.ANTHROPIC,
    model: 'claude-3.7-sonnet',
    input: 3,
    cacheCreation: 3.75,
    cachedInput: 0.3,
    output: 15,
  },
  {
    platform: LlmPlatform.ANTHROPIC,
    model: 'claude-3.5-haiku',
    input: 0.8,
    cacheCreation: 1,
    cachedInput: 0.08,
    output: 4,
  },
  {
    platform: LlmPlatform.ANTHROPIC,
    model: 'claude-3-opus',
    input: 15,
    cacheCreation: 18.75,
    cachedInput: 1.5,
    output: 75,
  },
  {
    platform: LlmPlatform.ANTHROPIC,
    model: 'claude-3-haiku',
    input: 0.25,
    cacheCreation: 0.3,
    cachedInput: 0.03,
    output: 1.25,
  },

  // ========================================
  // GOOGLE GEMINI MODELS
  // ========================================
  {
    platform: LlmPlatform.GEMINI,
    model: 'gemini-3-pro-image',
    input: 2,
    output: 12,
    imageOutput: 120,
  },
  {
    platform: LlmPlatform.GEMINI,
    model: 'gemini-3-pro-preview',
    input: 2,
    cachedInput: 0.5,
    output: 12,
  },
  {
    platform: LlmPlatform.GEMINI,
    model: 'gemini-3.1-pro-preview',
    input: 2,
    cachedInput: 0.5,
    output: 12,
  },
  {
    platform: LlmPlatform.GEMINI,
    model: 'gemini-3-flash-preview',
    input: 0.5,
    cachedInput: 0.125,
    output: 3,
  },
  {
    platform: LlmPlatform.GEMINI,
    model: 'gemini-3-flash',
    input: 0.5,
    cachedInput: 0.125,
    output: 3,
  },
  {
    platform: LlmPlatform.GEMINI,
    model: 'gemini-2.5-pro',
    input: 1.25,
    cachedInput: 0.31,
    output: 10,
  },
  {
    platform: LlmPlatform.GEMINI,
    model: 'gemini-2.5-flash-preview-09-2025',
    input: 0.3,
    cachedInput: 0.075,
    output: 2.5,
  },
  {
    platform: LlmPlatform.GEMINI,
    model: 'gemini-2.5-flash-lite-preview-09-2025',
    input: 0.1,
    cachedInput: 0.025,
    output: 0.4,
  },
  {
    platform: LlmPlatform.GEMINI,
    model: 'gemini-2.5-flash-image',
    input: 0.3,
    output: 30,
  },
  {
    platform: LlmPlatform.GEMINI,
    model: 'gemini-2.5-flash-lite',
    input: 0.1,
    cachedInput: 0.025,
    output: 0.4,
  },
  {
    platform: LlmPlatform.GEMINI,
    model: 'gemini-2.5-flash',
    input: 0.3,
    cachedInput: 0.075,
    output: 2.5,
  },
  {
    platform: LlmPlatform.GEMINI,
    model: 'gemini-flash-lite-latest',
    input: 0.1,
    cachedInput: 0.025,
    output: 0.4,
  },
  {
    platform: LlmPlatform.GEMINI,
    model: 'gemini-flash-latest',
    input: 0.3,
    cachedInput: 0.075,
    output: 2.5,
  },

  // ========================================
  // DEEPSEEK MODELS
  // ========================================
  {
    platform: LlmPlatform.DEEPSEEK,
    model: 'deepseek-chat',
    input: 0.27,
    cachedInput: 0.07,
    output: 1.1,
  },
  {
    platform: LlmPlatform.DEEPSEEK,
    model: 'deepseek-reasoner',
    input: 0.55,
    cachedInput: 0.14,
    output: 2.19,
  },

  // ========================================
  // XAI MODELS
  // ========================================
  {
    platform: LlmPlatform.XAI,
    model: 'grok-4-fast',
    input: 0.2,
    cachedInput: 0.05,
    output: 0.5,
  },
  {
    platform: LlmPlatform.XAI,
    model: 'grok-4',
    input: 3,
    cachedInput: 0.75,
    output: 15,
  },

  // ========================================
  // OPENROUTER MODELS
  // ========================================
  {
    platform: LlmPlatform.OPENROUTER,
    model: 'mistralai/mistral-small-3.2-24b-instruct',
    input: 0.075,
    output: 0.2,
  },
  {
    platform: LlmPlatform.OPENROUTER,
    model: 'qwen/qwen2.5-vl-32b-instruct',
    input: 0.2,
    output: 0.6,
  },
  {
    platform: LlmPlatform.OPENROUTER,
    model: 'qwen/qwen3-vl-30b-a3b-instruct',
    input: 0.3,
    output: 1,
  },
  {
    platform: LlmPlatform.OPENROUTER,
    model: 'qwen/qwen3-vl-235b-a22b-instruct',
    input: 0.3,
    output: 1.2,
  },
  {
    platform: LlmPlatform.OPENROUTER,
    model: 'google/gemma-3-12b-it',
    input: 0.03,
    output: 0.1,
  },
  {
    platform: LlmPlatform.OPENROUTER,
    model: 'google/gemma-3-27b-it',
    input: 0.09,
    output: 0.16,
  },
  {
    platform: LlmPlatform.OPENROUTER,
    model: 'google/gemini-2.5-flash',
    input: 0.3,
    cacheCreation: 0.383,
    cachedInput: 0.075,
    output: 2.5,
  },
];

export function getLlmCost(response: LlmResponseBase): number | undefined {
  const costConfig = LlmCosts.find(
    (config) =>
      config.platform === response.platform &&
      response.model.startsWith(config.model) &&
      (!config.thinking || config.thinking === response.thinking)
  );

  if (!costConfig) {
    return undefined;
  }

  let inputTokens = response.inputTokens;
  let inputCost = 0;
  if (costConfig.cachedInput && response.cachedInputTokens) {
    inputCost += costConfig.cachedInput * response.cachedInputTokens;
    inputTokens -= response.cachedInputTokens;
  }
  if (costConfig.cacheCreation && response.cacheCreationTokens) {
    inputCost += costConfig.cacheCreation * response.cacheCreationTokens;
    inputTokens -= response.cacheCreationTokens;
  }
  inputCost += costConfig.input * inputTokens;
  inputCost /= 1000000;

  let outputTokens = response.outputTokens;
  let outputCost = 0;
  if (costConfig.imageOutput && response.imageOutputTokens) {
    outputTokens -= response.imageOutputTokens;
    outputCost +=
      (costConfig.imageOutput * response.imageOutputTokens) / 1000000;
  }
  outputCost += (costConfig.output * outputTokens) / 1000000;

  return inputCost + outputCost;
}
