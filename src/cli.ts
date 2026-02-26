import path from 'path';

import {
  LocationId,
  SamoAI,
  UserId,
  LocationMessage,
  EntityType,
  Location,
  AgentId,
  Agent,
  Gimmick,
  Entity,
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
import { stringWidth, terminal as term } from 'terminal-kit';

import * as packageJson from '../package.json';

dotenv.config();

interface ChatOptions {
  agents: string;
  location: string;
}

/**
 * Represents a text segment with its styling state
 */
interface TextSegment {
  text: string;
  isDim: boolean;
}

// Known control key names from terminal-kit that should not be treated as character input
const CONTROL_KEYS = new Set([
  'ENTER',
  'KP_ENTER',
  'BACKSPACE',
  'DELETE',
  'TAB',
  'ESCAPE',
  'UP',
  'DOWN',
  'LEFT',
  'RIGHT',
  'HOME',
  'END',
  'PAGE_UP',
  'PAGE_DOWN',
  'INSERT',
  'SHIFT_TAB',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
]);

/**
 * Terminal UI for interacting with SamoAI agents
 * Handles terminal display, input management, and message rendering
 */
class TerminalUI {
  private colors = ['yellow', 'green', 'magenta', 'blue', 'cyan', 'red'];
  private entityColorMap = new Map<string, string>();
  private isRunning = true;
  private _thinkingAgentName: string | null = null;
  private _executingGimmicks = new Map<string, string>();
  private _streamingMessages = new Map<
    string,
    { ref: { name: string; message: string } }
  >();
  private _streamRedrawPending = false;
  private statusIntervalId: NodeJS.Timeout | null = null;
  private currentUserInput = '';
  private messageBuffer: { name: string; message: string }[] = [];
  private readonly messageBufferSize = 100;
  private saveCount = 0;
  private messageAreaHeight = 0;
  private readonly statusLineHeight = 1;
  private readonly inputLineHeight = 1;
  private readonly minScreenHeight = 10;
  private isRedirectingConsole = false;

  private readonly originalConsoleLog = console.log;
  private readonly originalConsoleError = console.error;
  private readonly originalConsoleWarn = console.warn;

  public constructor(
    private userName: string,
    private locationId: LocationId,
    private userId: UserId,
    private locationStorage: LocationStorage
  ) {
    this.interceptConsole();

    term.fullscreen(true);
    term.grabInput({ mouse: 'button' });
    term.hideCursor(false);
    term.on('key', this.handleKeyInput.bind(this));
    term.on('resize', this.handleResize.bind(this));

    this.handleResize();
    this.startStatusAnimation();
  }

  /**
   * Redirects console.log/error/warn into the message buffer
   * so stray output from libraries doesn't corrupt the fullscreen UI.
   */
  private interceptConsole() {
    console.log = (...args: unknown[]) => {
      if (this.isRedirectingConsole) return;
      this.isRedirectingConsole = true;
      this.addMessage('Log', args.map(String).join(' '));
      this.isRedirectingConsole = false;
    };
    console.error = (...args: unknown[]) => {
      if (this.isRedirectingConsole) return;
      this.isRedirectingConsole = true;
      this.addMessage('Error', args.map(String).join(' '));
      this.isRedirectingConsole = false;
    };
    console.warn = (...args: unknown[]) => {
      if (this.isRedirectingConsole) return;
      this.isRedirectingConsole = true;
      this.addMessage('Warning', args.map(String).join(' '));
      this.isRedirectingConsole = false;
    };
  }

  private restoreConsole() {
    console.log = this.originalConsoleLog;
    console.error = this.originalConsoleError;
    console.warn = this.originalConsoleWarn;
  }

  /**
   * Recalculates layout when terminal is resized
   */
  private handleResize() {
    this.messageAreaHeight = Math.max(
      this.minScreenHeight,
      term.height - this.statusLineHeight - this.inputLineHeight
    );

    this.clearScreen();
    this.redrawUI();
  }

  /**
   * Handles all keyboard input: character entry, backspace, enter, ctrl+c.
   * Replaces terminal-kit's inputField so we always know the current
   * input buffer and can redraw without losing user text.
   */
  private handleKeyInput(name: string) {
    if (!this.isRunning) return;

    if (name === 'CTRL_C') {
      void this.shutdown();
      return;
    }

    if (name === 'ENTER' || name === 'KP_ENTER') {
      void this.submitInput();
      return;
    }

    if (name === 'BACKSPACE') {
      if (this.currentUserInput.length > 0) {
        this.currentUserInput = this.currentUserInput.slice(0, -1);
        this.refreshInputLine();
      }
      return;
    }

    if (this.isControlKey(name)) return;

    const inputStartX = this.getTextWidth(this.userName) + 3;
    const maxInputWidth = term.width - inputStartX - 1;
    if (this.getTextWidth(this.currentUserInput + name) <= maxInputWidth) {
      this.currentUserInput += name;
      this.refreshInputLine();
    }
  }

  private isControlKey(name: string): boolean {
    if (CONTROL_KEYS.has(name)) return true;
    if (name.startsWith('CTRL_')) return true;
    if (name.startsWith('ALT_')) return true;
    if (name.startsWith('SHIFT_')) return true;
    if (name.startsWith('KP_')) return true;
    if (name.charCodeAt(0) < 32) return true;
    return false;
  }

  /**
   * Submits the current input text as a user message
   */
  private async submitInput() {
    const submittedText = this.currentUserInput.trim();
    this.currentUserInput = '';
    this.refreshInputLine();

    if (!submittedText) return;

    this.messageBuffer.push({
      name: this.userName,
      message: submittedText,
    });
    this.redrawMessageArea();

    try {
      await SamoAI.instance.addLocationUserMessage(
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
  }

  /**
   * Gets the actual display width of text (handles multi-byte characters)
   */
  private getTextWidth(text: string): number {
    return stringWidth(text);
  }

  /**
   * Truncates text to fit within the specified display width
   */

  private truncateTextToWidth(
    text: string,
    maxWidth: number
  ): { text: string; remaining: string } {
    if (this.getTextWidth(text) <= maxWidth) {
      return { text, remaining: '' };
    }

    let truncated = '';
    let currentWidth = 0;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const charWidth = this.getTextWidth(char);

      if (currentWidth + charWidth > maxWidth) {
        return {
          text: truncated,
          remaining: text.substring(i),
        };
      }

      truncated += char;
      currentWidth += charWidth;
    }

    return { text: truncated, remaining: '' };
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
   * Parses message text into segments with styling information
   * Properly handles actions that span multiple lines
   */
  private parseMessageSegments(message: string): TextSegment[] {
    const segments: TextSegment[] = [];
    let currentPos = 0;
    let isDimActive = false;

    // Find all asterisk positions
    const asteriskPositions: number[] = [];
    for (let i = 0; i < message.length; i++) {
      if (message[i] === '*') {
        asteriskPositions.push(i);
      }
    }

    // Process text between asterisks
    for (let i = 0; i < asteriskPositions.length; i++) {
      const asteriskPos = asteriskPositions[i];

      // Add text before this asterisk
      if (asteriskPos > currentPos) {
        segments.push({
          text: message.substring(currentPos, asteriskPos),
          isDim: isDimActive,
        });
      }

      // Determine if this is opening or closing asterisk
      if (!isDimActive) {
        // This is opening asterisk - start action mode
        isDimActive = true;
        segments.push({
          text: '*',
          isDim: true, // Opening asterisk is action colored
        });
      } else {
        // This is closing asterisk - end action mode
        segments.push({
          text: '*',
          isDim: true, // Closing asterisk is also action colored
        });
        isDimActive = false;
      }

      currentPos = asteriskPos + 1;
    }

    // Add remaining text
    if (currentPos < message.length) {
      segments.push({
        text: message.substring(currentPos),
        isDim: isDimActive,
      });
    }

    return segments;
  }

  /**
   * Wraps text segments across lines while maintaining styling states
   */
  private wrapTextSegments(
    segments: TextSegment[],
    maxWidth: number
  ): TextSegment[][] {
    const lines: TextSegment[][] = [];
    let currentLine: TextSegment[] = [];
    let currentLineWidth = 0;

    for (const segment of segments) {
      let remainingText = segment.text;

      while (remainingText.length > 0) {
        const availableWidth = maxWidth - currentLineWidth;
        const textWidth = this.getTextWidth(remainingText);

        if (textWidth <= availableWidth) {
          // Entire remaining text fits on current line
          if (remainingText.length > 0) {
            currentLine.push({
              text: remainingText,
              isDim: segment.isDim,
            });
            currentLineWidth += textWidth;
          }
          remainingText = '';
        } else {
          // Need to split the text
          if (availableWidth > 0) {
            // Take what fits on current line
            const { text: fittingText, remaining } = this.truncateTextToWidth(
              remainingText,
              availableWidth
            );
            if (fittingText.length > 0) {
              currentLine.push({
                text: fittingText,
                isDim: segment.isDim,
              });
            }
            remainingText = remaining;
          }

          // Start new line
          lines.push(currentLine);
          currentLine = [];
          currentLineWidth = 0;
        }
      }
    }

    // Add the last line if it has content
    if (currentLine.length > 0) {
      lines.push(currentLine);
    }

    // Ensure we have at least one line
    if (lines.length === 0) {
      lines.push([]);
    }

    return lines;
  }

  /**
   * Renders a line of text segments with proper styling
   */
  private renderTextSegments(segments: TextSegment[]): void {
    for (const segment of segments) {
      if (segment.isDim) {
        // Use cyan with dim for lighter blue appearance
        term.cyan.dim(segment.text);
      } else {
        term.cyan(segment.text);
      }
    }
    term.styleReset();
  }

  private clearScreen() {
    term.clear();
  }

  private get hasActiveStatus(): boolean {
    return this._thinkingAgentName !== null || this._executingGimmicks.size > 0;
  }

  /**
   * Periodically redraws the status line to animate the dots
   */
  private startStatusAnimation() {
    this.statusIntervalId = setInterval(() => {
      if (!this.isRunning || !this.hasActiveStatus) return;
      term.saveCursor();
      term.hideCursor();
      this.drawStatusLine();
      term.restoreCursor();
      term.hideCursor(false);
    }, 500);
  }

  /**
   * Draws the combined status line for agent thinking and gimmick execution
   */
  private drawStatusLine() {
    term.moveTo(1, this.messageAreaHeight + 1).eraseLine();

    const parts: string[] = [];
    const dots = '.'.repeat((Math.floor(Date.now() / 500) % 3) + 1);

    if (this._thinkingAgentName) {
      parts.push(`[${this._thinkingAgentName}] is thinking${dots}`);
    }

    for (const [, gimmickName] of this._executingGimmicks) {
      parts.push(`[${gimmickName}] executing${dots}`);
    }

    if (parts.length > 0) {
      term.gray(parts.join(' | '));
    }
  }

  /**
   * Applies a color to text output
   */
  private applyEntityColor(name: string, text: string) {
    const color = this.getColorForEntity(name);
    if (color === 'yellow') term.bold.yellow(text);
    else if (color === 'green') term.bold.green(text);
    else if (color === 'magenta') term.bold.magenta(text);
    else if (color === 'blue') term.bold.blue(text);
    else if (color === 'cyan') term.bold.cyan(text);
    else if (color === 'red') term.bold.red(text);
    else term.bold.yellow(text);
  }

  /**
   * Draws the user input line with the current input text and cursor
   */
  private drawInputLine() {
    term
      .moveTo(1, this.messageAreaHeight + 1 + this.statusLineHeight)
      .eraseLine();

    this.applyEntityColor(this.userName, this.userName);
    term.white(':').styleReset().white(' ');
    term.white(this.currentUserInput);
  }

  /**
   * Efficiently redraws only the input line, preserving user text
   */
  private refreshInputLine() {
    if (!this.isRunning) return;
    term.saveCursor();
    term.hideCursor();
    this.drawInputLine();
    this.positionCursor();
    term.hideCursor(false);
  }

  /**
   * Positions the terminal cursor at the end of current user input
   */
  private positionCursor() {
    const inputStartX = this.getTextWidth(this.userName) + 3;
    const cursorX = inputStartX + this.getTextWidth(this.currentUserInput);
    term.moveTo(cursorX, this.messageAreaHeight + 1 + this.statusLineHeight);
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
      const nameWidth = this.getTextWidth(name) + 2; // 2 for ': '
      const maxTextWidth = term.width - nameWidth - 1; // -1 for safety margin

      let lineCount = 0;

      // For each line in the message...
      for (const line of lines) {
        // Parse the line into segments and wrap them
        const segments = this.parseMessageSegments(line);
        const wrappedLines = this.wrapTextSegments(segments, maxTextWidth);
        lineCount += wrappedLines.length;
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
      const nameWidth = this.getTextWidth(name) + 2; // 2 for ': '
      const maxTextWidth = term.width - nameWidth - 1; // -1 for safety margin

      // Process all lines, wrapping long lines as needed
      const allLines: TextSegment[][] = [];

      // For each line in the message...
      for (const line of lines) {
        // Parse the line into segments and wrap them
        const segments = this.parseMessageSegments(line);
        const wrappedLines = this.wrapTextSegments(segments, maxTextWidth);
        allLines.push(...wrappedLines);
      }

      // Now display all lines
      if (allLines.length > 0) {
        // First line (with the name prefix)
        term.moveTo(1, currentLine);

        this.applyEntityColor(name, name);

        term.white(':').styleReset().white(' ');
        // Render the first line with proper styling
        this.renderTextSegments(allLines[0]);
        currentLine++;

        // Remaining lines with indentation
        for (
          let i = 1;
          i < allLines.length && currentLine <= this.messageAreaHeight;
          i++
        ) {
          term.moveTo(1, currentLine);
          // Add indentation equal to the name display width + 2 for ': '
          term.white(' '.repeat(nameWidth));
          // Render each line with proper styling
          this.renderTextSegments(allLines[i]);
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
   * Completely redraws the UI including messages, status, and input line.
   * Input text is always preserved because we track it in currentUserInput
   * instead of relying on terminal-kit's inputField.
   */
  private redrawUI() {
    if (!this.isRunning) return;

    term.hideCursor();
    term.styleReset();

    for (let i = 1; i <= term.height; i++) {
      term.moveTo(1, i).eraseLine();
    }

    this.redrawMessageArea();
    this.drawStatusLine();
    this.drawInputLine();
    this.positionCursor();
    term.hideCursor(false);
  }

  public get thinkingAgentName(): string | null {
    return this._thinkingAgentName;
  }

  /**
   * Displays a thinking indicator for an agent
   */
  public startThinking(agentName: string) {
    if (!this.isRunning) return;
    this._thinkingAgentName = agentName;
    this.drawStatusLine();

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
    this._thinkingAgentName = null;
    term.saveCursor();
    term.hideCursor();
    this.drawStatusLine();
    term.restoreCursor();
    term.hideCursor(false);
  }

  /**
   * Shows an executing indicator for a gimmick
   */
  public startGimmickExecution(gimmickKey: string, gimmickName: string) {
    if (!this.isRunning) return;
    this._executingGimmicks.set(gimmickKey, gimmickName);
    term.saveCursor();
    term.hideCursor();
    this.drawStatusLine();
    term.restoreCursor();
    term.hideCursor(false);
  }

  /**
   * Hides the executing indicator for a gimmick
   */
  public stopGimmickExecution(gimmickKey: string) {
    this._executingGimmicks.delete(gimmickKey);
    term.saveCursor();
    term.hideCursor();
    this.drawStatusLine();
    term.restoreCursor();
    term.hideCursor(false);
  }

  /**
   * Handles an incremental streaming delta from an agent's message generation.
   * On the first delta the thinking indicator is replaced by a live message entry.
   */
  public handleStreamDelta(agentName: string, delta: string) {
    if (!this.isRunning) return;

    let entry = this._streamingMessages.get(agentName);

    if (!entry) {
      if (this._thinkingAgentName === agentName) {
        this._thinkingAgentName = null;
      }
      const msgObj = { name: agentName, message: '' };
      this.messageBuffer.push(msgObj);
      if (this.messageBuffer.length > this.messageBufferSize) {
        this.messageBuffer = this.messageBuffer.slice(-this.messageBufferSize);
      }
      entry = { ref: msgObj };
      this._streamingMessages.set(agentName, entry);
    }

    entry.ref.message += delta;
    this.scheduleStreamRedraw();
  }

  /**
   * Replaces the in-progress streaming entry with the final message text,
   * or falls back to addMessage if there was no streaming session.
   */
  public finalizeStreamingMessage(name: string, finalMessage: string): boolean {
    const entry = this._streamingMessages.get(name);
    if (!entry) return false;

    entry.ref.message = finalMessage;
    this._streamingMessages.delete(name);
    this.scheduleStreamRedraw();
    return true;
  }

  /**
   * Throttles redraws during streaming to ~20 fps to avoid flicker
   */
  private scheduleStreamRedraw() {
    if (this._streamRedrawPending) return;
    this._streamRedrawPending = true;
    setTimeout(() => {
      this._streamRedrawPending = false;
      if (!this.isRunning) return;
      term.saveCursor();
      term.hideCursor();
      this.redrawMessageArea();
      this.drawStatusLine();
      this.drawInputLine();
      this.positionCursor();
      term.hideCursor(false);
    }, 50);
  }

  /**
   * Adds a message to the display
   */
  public addMessage(name: string, message: string) {
    if (!this.isRunning) return;

    this.messageBuffer.push({ name, message });

    if (this.messageBuffer.length > this.messageBufferSize) {
      this.messageBuffer = this.messageBuffer.slice(-this.messageBufferSize);
    }

    this.redrawUI();
  }

  /**
   * Loads previous chat history from storage
   */
  public async loadInitialMessages() {
    try {
      const messages = await this.locationStorage.getLocationMessages(
        this.locationId,
        100 // Load up to 100 messages
      );

      if (messages?.length > 0) {
        // Load messages into buffer
        for (const message of messages) {
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
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.statusIntervalId) {
      clearInterval(this.statusIntervalId);
      this.statusIntervalId = null;
    }

    term.grabInput(false);
    this.restoreConsole();

    term.clear();
    term.moveTo(1, 1);
    term('Shutting down...\n');

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
   * Sets up event handlers for location messages, agent updates, and gimmick execution
   */
  public setMessageEventHandlers(location: Location) {
    location.on(
      'messageAdded',
      async (_loc: Location, message: LocationMessage) => {
        if (message.entityType === EntityType.User || !message.message) {
          return;
        }

        const displayName = message.name || 'Unknown';

        if (this.finalizeStreamingMessage(displayName, message.message)) {
          return;
        }

        if (message.name === this.thinkingAgentName) {
          this.stopThinking();
        }

        this.addMessage(displayName, message.message);
      }
    );

    location.on('agentExecuteNextActions', async (agent: Agent) => {
      this.startThinking(agent.model.name);
    });

    location.on(
      'agentSendMessageStream',
      (
        agent: Agent,
        _entityKey: unknown,
        _toolName: string,
        _index: number,
        _sequence: number,
        delta: string
      ) => {
        this.handleStreamDelta(agent.model.name, delta);
      }
    );

    location.on('gimmickExecuting', (gimmick: Gimmick, _entity: Entity) => {
      this.startGimmickExecution(gimmick.key, gimmick.name);
    });

    location.on('gimmickExecuted', (gimmick: Gimmick) => {
      this.stopGimmickExecution(gimmick.key);
    });

    location.on('gimmickExecutionFailed', (gimmick: Gimmick) => {
      this.stopGimmickExecution(gimmick.key);
    });
  }
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
        locationStorage
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
