import { EventEmitter } from 'events';
import path from 'path';

import {
  LocationId,
  WorldManager,
  UserId,
  LocationMessage,
  EntityType,
  Location,
  AgentId,
  Agent,
} from '@little-samo/samo-ai';
import { Command } from 'commander';
import * as dotenv from 'dotenv';
import { terminal as term } from 'terminal-kit';

import * as packageJson from '../package.json';

import { AgentStorage } from './storage/agent.storage';
import { GimmickStorage } from './storage/gimmick.storage';
import { ItemStorage } from './storage/item.storage';
import { LocationStorage } from './storage/location.storage';
import { UserStorage } from './storage/user.storage';

dotenv.config();

interface ChatOptions {
  agents: string;
  location: string;
}

/**
 * Terminal UI for interacting with SamoAI agents
 * Handles terminal display, input management, and message rendering
 */
class TerminalUI {
  private colors = ['yellow', 'green', 'magenta', 'blue', 'cyan', 'red'];
  private entityColorMap = new Map<string, string>();
  private isRunning = true;
  private _thinkingAgentName: string | null = null;
  private thinkingIntervalId: NodeJS.Timeout | null = null;
  private inputActive = false;
  private currentUserInput = '';
  private inputController: ReturnType<typeof term.inputField> | null = null;
  private messageBuffer: { name: string; message: string }[] = [];
  private readonly messageBufferSize = 100;
  private saveCount = 0;
  private messageAreaHeight = 0;
  private readonly spinnerLineHeight = 1;
  private readonly inputLineHeight = 1;
  private readonly minScreenHeight = 10;

  public constructor(
    private userName: string,
    private locationId: LocationId,
    private userId: UserId,
    private locationStorage: LocationStorage
  ) {
    // Configure terminal
    term.fullscreen(true);
    term.grabInput({ mouse: 'button' });
    term.hideCursor(true);
    term.on('key', this.handleKeyPress.bind(this));
    term.on('resize', this.handleResize.bind(this));

    // Initialize screen dimensions
    this.handleResize();
  }

  /**
   * Recalculates layout when terminal is resized
   */
  private handleResize() {
    // Reserve space for spinner and input
    this.messageAreaHeight = Math.max(
      this.minScreenHeight,
      term.height - this.spinnerLineHeight - this.inputLineHeight
    );

    // Complete redraw on resize
    this.clearScreen();
    this.redrawUI(this.currentUserInput);
  }

  /**
   * Handles keyboard inputs (e.g., Ctrl+C to exit)
   */
  private handleKeyPress(name: string) {
    if (name === 'CTRL_C') {
      void this.shutdown();
    }
  }

  /**
   * Assigns consistent colors to entities for visual identification
   */
  private getColorForEntity(name: string): string {
    if (!this.entityColorMap.has(name)) {
      const colorIndex = this.entityColorMap.size % this.colors.length;
      this.entityColorMap.set(name, this.colors[colorIndex]);
    }
    return this.entityColorMap.get(name) as string;
  }

  /**
   * Formats message text with styling (e.g., actions like *waves*)
   */
  private formatMessage(message: string): string {
    // Match text between asterisks for actions like *wag tail excitedly*
    return message.replace(/\*([^*]+)\*/g, (match) => {
      return term.str.dim(match).toString();
    });
  }

  private clearScreen() {
    term.clear();
  }

  /**
   * Draws the thinking animation for active agents
   */
  private drawSpinnerLine() {
    if (!this._thinkingAgentName) return;

    term.moveTo(1, this.messageAreaHeight + 1).eraseLine();
    const dots = Math.floor(Date.now() / 500) % 3;
    const dotsStr = '.'.repeat(dots + 1);
    term.gray(`[${this._thinkingAgentName}] is thinking${dotsStr}`);
  }

  /**
   * Draws the user input line with appropriate styling
   */
  private drawInputLine() {
    term
      .moveTo(1, this.messageAreaHeight + 1 + this.spinnerLineHeight)
      .eraseLine();

    // Apply the appropriate color to the username
    const userColor = this.getColorForEntity(this.userName);
    if (userColor === 'yellow') term.bold.yellow(this.userName);
    else if (userColor === 'green') term.bold.green(this.userName);
    else if (userColor === 'magenta') term.bold.magenta(this.userName);
    else if (userColor === 'blue') term.bold.blue(this.userName);
    else if (userColor === 'cyan') term.bold.cyan(this.userName);
    else if (userColor === 'red') term.bold.red(this.userName);
    else term.bold.yellow(this.userName);

    term.white(':').styleReset().white(' '); // Ensure space after colon
  }

  /**
   * Redraws the message history with proper formatting and line wrapping
   */
  private redrawMessageArea() {
    if (!this.isRunning) return;

    // Calculate how many messages to display
    const messagesToShow = this.messageBuffer.slice(
      Math.max(0, this.messageBuffer.length - this.messageAreaHeight)
    );

    // Clear the message area
    for (let i = 1; i <= this.messageAreaHeight; i++) {
      term.moveTo(1, i).eraseLine();
    }

    // First pass: calculate how many lines each message will take
    let totalLinesNeeded = 0;
    const messageLineCounts: number[] = [];

    for (const { name, message } of messagesToShow) {
      // Split message by newlines to handle multi-line messages
      const lines = message.split(/\r?\n/);

      // Calculate maximum width for text (accounting for name and prefix)
      const nameWidth = name.length + 2; // 2 for ': '
      const maxTextWidth = term.width - nameWidth - 1; // -1 for safety margin

      let lineCount = 0;

      // For each line in the message...
      for (const line of lines) {
        const formattedLine = this.formatMessage(line);

        // If the line is short enough, it's just one line
        if (formattedLine.length <= maxTextWidth) {
          lineCount++;
        } else {
          // Otherwise, calculate wrapped lines
          lineCount += Math.ceil(formattedLine.length / maxTextWidth);
        }
      }

      // Need at least one line even for empty messages
      lineCount = Math.max(1, lineCount);
      messageLineCounts.push(lineCount);
      totalLinesNeeded += lineCount;
    }

    // If we need more lines than available, trim the messages from the beginning
    if (totalLinesNeeded > this.messageAreaHeight) {
      let linesRemaining = this.messageAreaHeight;
      let startIndex = messageLineCounts.length - 1;

      while (startIndex >= 0) {
        if (linesRemaining >= messageLineCounts[startIndex]) {
          linesRemaining -= messageLineCounts[startIndex];
          startIndex--;
        } else {
          break;
        }
      }

      // Adjust messagesToShow to only include messages that will fit
      messagesToShow.splice(0, startIndex + 1);
    }

    // Draw messages
    let currentLine = 1;

    for (const { name, message } of messagesToShow) {
      // Split message by newlines to handle multi-line messages
      const lines = message.split(/\r?\n/);

      // Calculate maximum width for text (accounting for name and prefix)
      const nameWidth = name.length + 2; // 2 for ': '
      const maxTextWidth = term.width - nameWidth - 1; // -1 for safety margin

      // Process all lines, wrapping long lines as needed
      const allLines: string[] = [];

      // For each line in the message...
      for (const line of lines) {
        const formattedLine = this.formatMessage(line);

        // If the line is short enough, add it as is
        if (formattedLine.length <= maxTextWidth) {
          allLines.push(formattedLine);
        } else {
          // Otherwise, wrap the line
          let remainingText = formattedLine;
          while (remainingText.length > 0) {
            allLines.push(remainingText.substring(0, maxTextWidth));
            remainingText = remainingText.substring(maxTextWidth);
          }
        }
      }

      // Now display all lines
      if (allLines.length > 0) {
        // First line (with the name prefix)
        term.moveTo(1, currentLine);

        // Apply the appropriate color to the entity name
        const color = this.getColorForEntity(name);
        if (color === 'yellow') term.bold.yellow(name);
        else if (color === 'green') term.bold.green(name);
        else if (color === 'magenta') term.bold.magenta(name);
        else if (color === 'blue') term.bold.blue(name);
        else if (color === 'cyan') term.bold.cyan(name);
        else if (color === 'red') term.bold.red(name);
        else term.bold.yellow(name);

        term.white(':').styleReset().white(' ');
        term.cyan(allLines[0]).styleReset();
        currentLine++;

        // Remaining lines with indentation
        for (
          let i = 1;
          i < allLines.length && currentLine <= this.messageAreaHeight;
          i++
        ) {
          term.moveTo(1, currentLine);
          // Add indentation equal to the name length + 2 for ': '
          term.white(' '.repeat(nameWidth));
          term.cyan(allLines[i]).styleReset();
          currentLine++;
        }
      } else {
        // Handle empty line case
        currentLine++;
      }

      // If we ran out of space, exit the loop
      if (currentLine > this.messageAreaHeight) {
        break;
      }
    }
  }

  /**
   * Completely redraws the UI, preserving user input if needed
   */
  private redrawUI(preserveInput?: string) {
    if (!this.isRunning) return;

    // Save the current input state - capture exactly what the user is typing
    let inputToPreserve =
      typeof preserveInput === 'string' ? preserveInput : '';

    if (typeof preserveInput !== 'string' && this.inputActive) {
      inputToPreserve = this.currentUserInput;
    }

    // Temporarily disable input
    if (this.inputActive && this.inputController) {
      const controllerToAbort = this.inputController;
      this.inputController = null;
      this.inputActive = false;
      // Store the current input before aborting
      this.currentUserInput = inputToPreserve;
      controllerToAbort.abort();
    }

    // Redraw all UI components with full control
    term.hideCursor();

    // Make sure we're not in alternate screen or any strange state
    term.styleReset();

    // Clear the entire screen to avoid artifacts
    for (let i = 1; i <= term.height; i++) {
      term.moveTo(1, i).eraseLine();
    }

    // Redraw message area
    this.redrawMessageArea();

    // Clear and redraw the spinner line
    term.moveTo(1, this.messageAreaHeight + 1).eraseLine();
    if (this._thinkingAgentName) {
      this.drawSpinnerLine();
    }

    // Clear and redraw the input line
    term
      .moveTo(1, this.messageAreaHeight + 1 + this.spinnerLineHeight)
      .eraseLine();
    this.drawInputLine();

    term.hideCursor(false);

    // Ensure input state is preserved
    if (inputToPreserve) {
      this.currentUserInput = inputToPreserve;
    }

    // Give the terminal a moment to stabilize
    setTimeout(() => {
      // Activate or reactivate input field
      this.activateInput();
    }, 10);
  }

  /**
   * Activates or reactivates the user input field
   */
  private activateInput() {
    if (!this.isRunning) return;

    // Store the current input before canceling
    const inputToPreserve = this.currentUserInput;

    // Cancel any existing input controller
    if (this.inputController) {
      const controllerToAbort = this.inputController;
      this.inputController = null;
      controllerToAbort.abort();
    }

    // Ensure the input line is clear
    term
      .moveTo(1, this.messageAreaHeight + 1 + this.spinnerLineHeight)
      .eraseLine();
    this.drawInputLine();

    // Position cursor correctly - ensure it's after "User: "
    const inputStartX = this.userName.length + 3; // +3 for ": " and space
    term.moveTo(
      inputStartX,
      this.messageAreaHeight + 1 + this.spinnerLineHeight
    );

    // Ensure we're in the right state
    term.styleReset();
    term.hideCursor(false);

    this.inputActive = true;
    this.inputController = term.inputField(
      {
        default: inputToPreserve, // Use preserved input
        cancelable: true,
        minLength: 0,
        maxLength: term.width - inputStartX - 1,
      },
      async (error: unknown, userInput?: string) => {
        const wasProgrammaticallyAborted = this.inputController === null;

        this.inputActive = false;
        this.inputController = null;

        // Only update the input buffer if not programmatically aborted
        if (!wasProgrammaticallyAborted) {
          this.currentUserInput = userInput || '';
        }

        if (error) {
          // If not programmatically aborted, redraw
          if (!wasProgrammaticallyAborted && this.isRunning) {
            setTimeout(() => this.redrawUI(this.currentUserInput), 0);
          }
          return;
        }

        // Process user submission
        const submittedText = this.currentUserInput.trim();
        this.currentUserInput = ''; // Clear for next input

        if (submittedText) {
          // Immediately add to buffer to show locally
          this.messageBuffer.push({
            name: this.userName,
            message: submittedText,
          });

          // Redraw UI to show the user's message immediately
          this.redrawUI();

          try {
            // Then submit to server
            await WorldManager.instance.addLocationUserMessage(
              this.locationId,
              this.userId,
              this.userName,
              submittedText
            );
            await this.locationStorage.updateLocationStatePauseUpdateUntil(
              this.locationId,
              new Date(Date.now() + 500)
            );
          } catch (e) {
            const errMessage = e instanceof Error ? e.message : String(e);
            this.addMessage('Error', errMessage);
          }
        } else {
          // Even on empty input, redraw for next input
          if (this.isRunning) {
            setTimeout(() => this.redrawUI(), 0);
          }
        }
      }
    );
  }

  public get thinkingAgentName(): string | null {
    return this._thinkingAgentName;
  }

  /**
   * Displays a thinking indicator for an agent
   */
  public startThinking(agentName: string) {
    // Don't start thinking if shutting down
    if (!this.isRunning) return;

    // Save current input state
    const inputToPreserve = this.inputActive ? this.currentUserInput : '';

    // Set thinking state
    this._thinkingAgentName = agentName;

    if (this.thinkingIntervalId) {
      clearInterval(this.thinkingIntervalId);
    }

    this.thinkingIntervalId = setInterval(() => {
      // Only update the spinner line if we're still running
      if (!this.isRunning) return;

      term.saveCursor();
      term.hideCursor();
      term.moveTo(1, this.messageAreaHeight + 1).eraseLine();
      this.drawSpinnerLine();
      term.restoreCursor();
      term.hideCursor(false);
    }, 500);

    // Save the user input before redraw
    this.currentUserInput = inputToPreserve;

    // Do a full redraw to show spinner and preserve input
    this.redrawUI(inputToPreserve);

    // Auto-stop spinner after timeout (15 seconds)
    setTimeout(() => {
      if (this._thinkingAgentName === agentName && this.isRunning) {
        this.stopThinking();
      }
    }, 15000);
  }

  /**
   * Stops the thinking indicator
   */
  public stopThinking() {
    // Store current input before state change
    const inputToPreserve = this.inputActive ? this.currentUserInput : '';

    if (this.thinkingIntervalId) {
      clearInterval(this.thinkingIntervalId);
      this.thinkingIntervalId = null;
    }

    this._thinkingAgentName = null;

    // Clear spinner line
    term.moveTo(1, this.messageAreaHeight + 1).eraseLine();

    // Save the user input before redraw
    this.currentUserInput = inputToPreserve;

    // Do a full redraw to clear spinner and preserve input
    this.redrawUI(inputToPreserve);
  }

  /**
   * Adds a message to the display
   */
  public addMessage(name: string, message: string) {
    // Don't add messages if shutting down
    if (!this.isRunning) return;

    // Save current input - make sure to capture from input field if active
    const currentInput = this.inputActive ? this.currentUserInput : '';

    // Add to buffer
    this.messageBuffer.push({ name, message });

    // Trim buffer if needed
    if (this.messageBuffer.length > this.messageBufferSize) {
      this.messageBuffer = this.messageBuffer.slice(-this.messageBufferSize);
    }

    // Set current input before redraw
    this.currentUserInput = currentInput;

    // Always do a full redraw to ensure message display is consistent
    this.redrawUI(currentInput);
  }

  /**
   * Loads previous chat history from storage
   */
  public async loadInitialMessages() {
    try {
      const messagesState =
        await this.locationStorage.getOrCreateLocationMessagesState(
          this.locationId
        );

      if (messagesState?.messages?.length > 0) {
        // Load messages into buffer
        for (const message of messagesState.messages) {
          if (message && message.message && message.name) {
            this.messageBuffer.push({
              name: message.name,
              message: message.message,
            });
          }
        }

        // Trim if needed
        if (this.messageBuffer.length > this.messageBufferSize) {
          this.messageBuffer = this.messageBuffer.slice(
            -this.messageBufferSize
          );
        }

        // Force a complete redraw to show all messages
        this.clearScreen();
        this.redrawUI();
      }
    } catch (e) {
      this.addMessage('Error', `Error loading initial messages: ${e}`);
    }
  }

  public incrementSaveCount() {
    this.saveCount++;
  }

  public decrementSaveCount() {
    this.saveCount--;
  }

  /**
   * Gracefully shuts down the terminal UI
   */
  public async shutdown() {
    // Set running state to false first to prevent new messages and UI updates
    this.isRunning = false;

    // Cancel any active input
    if (this.inputController) {
      const controllerToAbort = this.inputController;
      this.inputController = null;
      controllerToAbort.abort();
    }

    // Stop thinking animation
    if (this.thinkingIntervalId) {
      clearInterval(this.thinkingIntervalId);
      this.thinkingIntervalId = null;
    }

    // Release terminal
    term.grabInput(false);

    // Clear screen
    term.clear();
    term.moveTo(1, 1);
    term('Shutting down...\n');

    // Wait for saves to complete if any
    if (this.saveCount > 0) {
      term(`Waiting for save to complete... (${this.saveCount})\n`);
      let prevSaveCount = this.saveCount;

      while (this.saveCount > 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (prevSaveCount !== this.saveCount) {
          prevSaveCount = this.saveCount;
          term(`Waiting for save to complete... (${this.saveCount})\n`);
        }
      }

      term('Save complete.\n');
    }

    term('Exiting...\n');
    term.fullscreen(false);
    process.exit(0);
  }

  /**
   * Sets up event handlers for location messages and agent updates
   */
  public setMessageEventHandlers(location: Location) {
    // Listen for new messages
    (location as unknown as EventEmitter).on(
      'messageAdded',
      async (_loc: Location, message: LocationMessage) => {
        if (message.entityType === EntityType.User || !message.message) {
          return;
        }

        // If message is from thinking agent, stop spinner
        if (message.name === this.thinkingAgentName) {
          this.stopThinking();
        }

        // Add message to UI - ensure name is a string
        const displayName = message.name || 'Unknown';
        this.addMessage(displayName, message.message);
      }
    );

    // Listen for agent thinking
    (location as unknown as EventEmitter).on(
      'agentExecuteNextActions',
      async (agent: Agent) => {
        // Show thinking status
        this.startThinking(agent.model.name);
      }
    );
  }
}

/**
 * Main application entry point
 * Sets up dependencies, CLI, and starts the chat session
 */
async function bootstrap() {
  const agentStorage = new AgentStorage(
    path.join(process.cwd(), 'models', 'agents'),
    path.join(process.cwd(), 'states', 'agents')
  );
  const gimmickStorage = new GimmickStorage();
  const itemStorage = new ItemStorage();
  const locationStorage = new LocationStorage(
    path.join(process.cwd(), 'models', 'locations'),
    path.join(process.cwd(), 'states', 'locations')
  );
  const userStorage = new UserStorage();

  WorldManager.initialize({
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

      const locationId = Number(
        Object.keys(locationStorage.database.locations)[0]
      ) as LocationId;
      const userId = 1 as UserId;
      const userName = 'User';

      // Initialize UI
      const ui = new TerminalUI(userName, locationId, userId, locationStorage);
      ui.addMessage(
        'System',
        `Chatting with agents: ${agents.join(', ')} at location: ${options.location}`
      );
      ui.addMessage('System', 'Press Ctrl+C to exit...');

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
      for (const agentId of Object.keys(agentStorage.database.agents)) {
        await locationStorage.addLocationStateAgentId(
          locationId,
          Number(agentId) as AgentId
        );
      }

      // Load initial messages
      await ui.loadInitialMessages();

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
              await WorldManager.instance.updateLocation(userId, locationId, {
                preAction: async (location: Location) => {
                  // Setup message and thinking event handlers
                  ui.setMessageEventHandlers(location);
                },
                handleSave: async (save) => {
                  ui.incrementSaveCount();
                  try {
                    await save;
                  } finally {
                    ui.decrementSaveCount();
                  }
                },
              });
            }

            await new Promise((resolve) => setTimeout(resolve, 100));
          } catch (error) {
            const errMessage =
              error instanceof Error ? error.message : String(error);
            ui.addMessage('Error', `Update Loop: ${errMessage}`);
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
