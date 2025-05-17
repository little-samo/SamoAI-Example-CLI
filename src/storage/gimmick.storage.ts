import {
  EntityId,
  EntityType,
  GimmickId,
  GimmickRepository,
  GimmickState,
  LocationId,
} from '@little-samo/samo-ai';

/**
 * In-memory database structure for storing gimmick states
 * Unlike other storage classes, this data is not persisted to disk
 */
interface GimmickDatabase {
  gimmickStates: Record<LocationId, Record<GimmickId, GimmickState>>;
}

/**
 * Temporary in-memory storage for gimmick data
 *
 * IMPORTANT: Unlike LocationStorage and AgentStorage, this class
 * does not persist data to the filesystem. All data is kept in memory
 * and will be lost when the application restarts.
 */
export class GimmickStorage implements GimmickRepository {
  private database: GimmickDatabase = {
    gimmickStates: {},
  };

  /**
   * Get or create a gimmick state for a specific location
   * The state is created in memory only and not persisted
   */
  public async getOrCreateGimmickState(
    locationId: LocationId,
    gimmickId: GimmickId
  ): Promise<GimmickState> {
    if (!this.database.gimmickStates[locationId]) {
      this.database.gimmickStates[locationId] = {};
    }

    if (this.database.gimmickStates[locationId][gimmickId]) {
      return this.database.gimmickStates[locationId][gimmickId];
    }

    // Create a new in-memory state (not persisted to disk)
    this.database.gimmickStates[locationId][gimmickId] = {
      locationId,
      gimmickId,
      updatedAt: new Date(),
      createdAt: new Date(),
    };

    return this.database.gimmickStates[locationId][gimmickId];
  }

  /**
   * Get or create multiple gimmick states for a specific location
   * Returns direct references (not deep copies) as data is temporary
   */
  public async getOrCreateGimmickStates(
    locationId: LocationId,
    gimmickIds: GimmickId[]
  ): Promise<Record<GimmickId, GimmickState>> {
    const result: Record<GimmickId, GimmickState> = {};

    await Promise.all(
      gimmickIds.map(async (gimmickId) => {
        result[gimmickId] = await this.getOrCreateGimmickState(
          locationId,
          gimmickId
        );
      })
    );

    return result;
  }

  /**
   * Update a gimmick's occupier information
   * Changes are stored in memory only and not persisted to disk
   */
  public async updateGimmickStateOccupier(
    locationId: LocationId,
    gimmickId: GimmickId,
    occupierType?: EntityType,
    occupierId?: EntityId,
    occupationUntil?: Date
  ): Promise<void> {
    const gimmickState = await this.getOrCreateGimmickState(
      locationId,
      gimmickId
    );

    gimmickState.occupierType = occupierType;
    gimmickState.occupierId = occupierId;
    gimmickState.occupationUntil = occupationUntil;
  }
}
