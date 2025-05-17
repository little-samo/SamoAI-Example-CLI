import {
  LlmApiKeyModel,
  LlmPlatform,
  UserId,
  UserModel,
  UserRepository,
  UserState,
} from '@little-samo/samo-ai';

/**
 * Simplified in-memory user storage for a single user
 *
 * IMPORTANT: Unlike agent.storage.ts, this implementation is simplified to support
 * just a single hardcoded user without persistence. It uses API keys directly from
 * environment variables.
 *
 * To support multiple users, this class could be extended similar to AgentStorage with:
 * - File-based persistence for user profiles
 * - Individual API key management per user
 * - User-specific configurations and preferences
 * - Deep copy mechanisms for data safety
 */
export class UserStorage implements UserRepository {
  /**
   * Returns a fixed user model with the specified ID
   * In a full implementation, this would load user data from storage
   */
  public async getUserModel(userId: UserId): Promise<UserModel> {
    // Hardcoded single user - in a real implementation, would load from storage
    return {
      id: Number(userId),
      username: null,
      nickname: 'User',
      firstName: null,
      lastName: null,
      meta: {},
    };
  }

  /**
   * Returns multiple fixed user models
   * In a full implementation, this would load user data from storage
   */
  public async getUserModels(
    userIds: UserId[]
  ): Promise<Record<UserId, UserModel>> {
    const result: Record<UserId, UserModel> = {};

    // Simply creates the same hardcoded user for each ID
    // A real implementation would load actual users from storage
    for (const userId of userIds) {
      result[userId] = {
        id: Number(userId),
        username: null,
        nickname: `User`,
        firstName: null,
        lastName: null,
        meta: {},
      };
    }

    return result;
  }

  /**
   * Returns LLM API keys from environment variables
   * In a full implementation, each user would have their own API keys
   */
  public async getUserLlmApiKeys(_userId: UserId): Promise<LlmApiKeyModel[]> {
    // Uses shared API keys from .env regardless of user ID
    // A real implementation would store and retrieve user-specific API keys
    return [
      {
        id: 1,
        platform: LlmPlatform.OPENAI,
        key: process.env.OPENAI_API_KEY!,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 2,
        platform: LlmPlatform.GEMINI,
        key: process.env.GEMINI_API_KEY!,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 3,
        platform: LlmPlatform.ANTHROPIC,
        key: process.env.ANTHROPIC_API_KEY!,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
  }

  /**
   * Returns a minimal user state
   * In a full implementation, would store and retrieve user-specific state
   */
  public async getOrCreateUserState(userId: UserId): Promise<UserState> {
    // Minimal state - a real implementation would have persistent user state
    return {
      userId: userId,
    };
  }

  /**
   * Returns multiple minimal user states
   * In a full implementation, would store and retrieve user-specific states
   */
  public async getOrCreateUserStates(
    userIds: UserId[]
  ): Promise<Record<UserId, UserState>> {
    const result: Record<UserId, UserState> = {};

    // Creates minimal states - a real implementation would have persistent user states
    for (const userId of userIds) {
      result[userId] = {
        userId: userId,
      };
    }

    return result;
  }
}
