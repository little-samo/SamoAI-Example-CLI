import path from 'path';

import {
  LocationId,
  SamoAI,
  UserId,
  Location,
  AgentId,
} from '@little-samo/samo-ai';
import {
  AgentStorage,
  GimmickStorage,
  ItemStorage,
  LocationStorage,
  UserStorage,
} from '@little-samo/samo-ai-repository-storage';
import { Command } from 'commander';
import * as dotenv from 'dotenv';

import * as packageJson from '../package.json';

import { TerminalUI } from './terminal-ui';

dotenv.config();

interface ChatOptions {
  agents: string;
  location: string;
}

/**
 * Main application entry point
 * Sets up dependencies, CLI, and starts the chat session
 */
async function bootstrap() {
  // Create a reference to store the UI instance
  let terminalUI: TerminalUI | null = null;

  // Add SIGINT handler for graceful shutdown on macOS and other platforms
  process.on('SIGINT', () => {
    if (terminalUI) {
      void terminalUI.shutdown();
    } else {
      // If UI isn't initialized yet, just exit
      console.log('Exiting...');
      process.exit(0);
    }
  });

  const agentStorage = new AgentStorage(
    path.join(process.cwd(), 'models', 'agents'),
    path.join(process.cwd(), 'states', 'agents')
  );
  const gimmickStorage = new GimmickStorage(
    path.join(process.cwd(), 'states', 'gimmicks')
  );
  const itemStorage = new ItemStorage(
    path.join(process.cwd(), 'states', 'items')
  );
  const locationStorage = new LocationStorage(
    path.join(process.cwd(), 'models', 'locations'),
    path.join(process.cwd(), 'states', 'locations')
  );
  const userStorage = new UserStorage(
    path.join(process.cwd(), 'models', 'users'),
    path.join(process.cwd(), 'states', 'users')
  );

  SamoAI.initialize({
    agentRepository: agentStorage,
    gimmickRepository: gimmickStorage,
    itemRepository: itemStorage,
    locationRepository: locationStorage,
    userRepository: userStorage,
  });

  const program = new Command();

  program.version(packageJson.version);
  program.description(packageJson.description);

  program
    .command('chat')
    .description('Chat with SamoAI agents')
    .option(
      '-a, --agents <agents>',
      'agents to chat with (comma separated)',
      'samo,nyx'
    )
    .option('-l, --location <location>', 'location for the chat', 'empty')
    .action(async (options: ChatOptions) => {
      const agents = options.agents.split(',');
      await locationStorage.initialize([options.location]);
      await agentStorage.initialize(agents);
      await userStorage.initialize(['user']);

      const locationId = Number(
        locationStorage.getLocationIds()[0]
      ) as LocationId;
      const userId = Number(userStorage.getUserIds()[0]) as UserId;
      const userName = (await userStorage.getUserModel(userId)).nickname;

      // Initialize UI and store reference for SIGINT handler
      terminalUI = new TerminalUI(
        userName,
        locationId,
        userId,
        locationStorage,
        agentStorage
      );
      terminalUI.addMessage(
        'System',
        `Chatting with agents: ${agents.join(', ')} at location: ${options.location}`
      );
      terminalUI.addMessage('System', 'Press Ctrl+C to exit...');

      // Initialize location state
      const locationState =
        await locationStorage.getOrCreateLocationState(locationId);

      // Clear existing users and agents
      for (const locationUserId of locationState.userIds) {
        await locationStorage.removeLocationStateUserId(
          locationId,
          locationUserId
        );
      }
      for (const locationAgentId of locationState.agentIds) {
        await locationStorage.removeLocationStateAgentId(
          locationId,
          locationAgentId
        );
      }

      // Add the user
      await locationStorage.addLocationStateUserId(locationId, userId);

      // Add the agents
      for (const agentId of agentStorage.getAgentIds()) {
        await locationStorage.addLocationStateAgentId(
          locationId,
          Number(agentId) as AgentId
        );
      }

      // Load initial messages
      await terminalUI.loadInitialMessages();

      // Update loop - periodically checks for and processes agent responses
      const updateLoop = async () => {
        while (true) {
          try {
            const locationState =
              await locationStorage.getOrCreateLocationState(locationId);
            const now = new Date();

            if (
              locationState.pauseUpdateUntil &&
              new Date(locationState.pauseUpdateUntil) <= now
            ) {
              await SamoAI.instance.updateLocation(userId, locationId, {
                preAction: async (location: Location) => {
                  // Setup message and thinking event handlers
                  terminalUI!.setMessageEventHandlers(location);
                },
                handleSave: async (save) => {
                  terminalUI!.incrementSaveCount();
                  try {
                    await save;
                  } catch (error) {
                    const errMessage =
                      error instanceof Error ? error.message : String(error);
                    terminalUI!.addMessage(
                      'Error',
                      `Save failed: ${errMessage}`
                    );
                  } finally {
                    terminalUI!.decrementSaveCount();
                  }
                },
              });
            }

            await new Promise((resolve) => setTimeout(resolve, 100));
          } catch (error) {
            const errMessage =
              error instanceof Error ? error.message : String(error);
            terminalUI!.addMessage('Error', `Update Loop: ${errMessage}`);
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      };

      // Start update loop
      void updateLoop();
    });

  // Remove the double dashes from the arguments (platform specific)
  process.argv = process.argv.filter((arg) => arg !== '--');
  program.parse(process.argv);
}

void bootstrap();
