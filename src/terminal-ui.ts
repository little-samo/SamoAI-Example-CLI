import {
  Agent,
  AgentId,
  Entity,
  EntityType,
  Gimmick,
  LlmResponseBase,
  LlmToolCall,
  Location,
  LocationId,
  LocationMessage,
  LocationMission,
  LocationObjective,
  SamoAI,
  UserId,
} from '@little-samo/samo-ai';
import {
  AgentStorage,
  LocationStorage,
} from '@little-samo/samo-ai-repository-storage';
import { stringWidth, terminal as term } from 'terminal-kit';

import { getLlmCost } from './llm-cost';

/**
 * Represents a text segment with its styling state
 */
export interface TextSegment {
  text: string;
  isDim: boolean;
}

// Known control key names from terminal-kit that should not be treated as character input
export const CONTROL_KEYS = new Set([
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
export class TerminalUI {
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
  private messageBuffer: {
    name: string;
    message: string;
    isAction?: boolean;
  }[] = [];
  private readonly messageBufferSize = 100;
  private saveCount = 0;
  private messageAreaHeight = 0;
  private readonly statusLineHeight = 1;
  private readonly inputLineHeight = 1;
  private readonly minScreenHeight = 10;
  private isRedirectingConsole = false;

  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private cumulativeCost = 0;

  private viewMode: 'chat' | 'canvas' | 'agents' = 'chat';
  private canvasData = new Map<string, string>();
  private selectedCanvasIndex = 0;
  private canvasScrollOffset = 0;

  private agentInfos: {
    id: AgentId;
    name: string;
    memories: string[];
    summary: string;
    canvases: Record<string, string>;
    entityMemories: { targetName: string; memories: string[] }[];
  }[] = [];
  private selectedAgentIndex = 0;
  private agentScrollOffset = 0;

  private currentMission: LocationMission | null = null;

  private readonly originalConsoleLog = console.log;
  private readonly originalConsoleError = console.error;
  private readonly originalConsoleWarn = console.warn;

  public constructor(
    private userName: string,
    private locationId: LocationId,
    private userId: UserId,
    private locationStorage: LocationStorage,
    private agentStorage: AgentStorage
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

    if (name === 'TAB') {
      const modes: ('chat' | 'canvas' | 'agents')[] = [
        'chat',
        'canvas',
        'agents',
      ];
      const idx = modes.indexOf(this.viewMode);
      this.viewMode = modes[(idx + 1) % modes.length];
      this.canvasScrollOffset = 0;
      this.agentScrollOffset = 0;
      this.clearScreen();
      this.redrawUI();
      return;
    }

    if (name === 'SHIFT_TAB') {
      const modes: ('chat' | 'canvas' | 'agents')[] = [
        'chat',
        'canvas',
        'agents',
      ];
      const idx = modes.indexOf(this.viewMode);
      this.viewMode = modes[(idx - 1 + modes.length) % modes.length];
      this.canvasScrollOffset = 0;
      this.agentScrollOffset = 0;
      this.clearScreen();
      this.redrawUI();
      return;
    }

    if (this.viewMode === 'agents') {
      if (name === 'LEFT' || name === 'RIGHT') {
        if (this.agentInfos.length > 0) {
          const dir = name === 'LEFT' ? -1 : 1;
          this.selectedAgentIndex =
            (this.selectedAgentIndex + dir + this.agentInfos.length) %
            this.agentInfos.length;
          this.agentScrollOffset = 0;
          this.redrawUI();
        }
        return;
      }
      if (name === 'UP') {
        if (this.agentScrollOffset > 0) {
          this.agentScrollOffset--;
          this.redrawUI();
        }
        return;
      }
      if (name === 'DOWN') {
        this.agentScrollOffset++;
        this.redrawUI();
        return;
      }
      if (name === 'PAGE_UP') {
        const pageSize = this.messageAreaHeight - 2;
        this.agentScrollOffset = Math.max(0, this.agentScrollOffset - pageSize);
        this.redrawUI();
        return;
      }
      if (name === 'PAGE_DOWN') {
        this.agentScrollOffset += this.messageAreaHeight - 2;
        this.redrawUI();
        return;
      }
    }

    if (this.viewMode === 'canvas') {
      if (name === 'LEFT' || name === 'RIGHT') {
        const names = Array.from(this.canvasData.keys());
        if (names.length > 0) {
          const dir = name === 'LEFT' ? -1 : 1;
          this.selectedCanvasIndex =
            (this.selectedCanvasIndex + dir + names.length) % names.length;
          this.canvasScrollOffset = 0;
          this.redrawUI();
        }
        return;
      }
      if (name === 'UP') {
        if (this.canvasScrollOffset > 0) {
          this.canvasScrollOffset--;
          this.redrawUI();
        }
        return;
      }
      if (name === 'DOWN') {
        this.canvasScrollOffset++;
        this.redrawUI();
        return;
      }
      if (name === 'PAGE_UP') {
        const pageSize = this.messageAreaHeight - 2;
        this.canvasScrollOffset = Math.max(
          0,
          this.canvasScrollOffset - pageSize
        );
        this.redrawUI();
        return;
      }
      if (name === 'PAGE_DOWN') {
        this.canvasScrollOffset += this.messageAreaHeight - 2;
        this.redrawUI();
        return;
      }
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

    const modeLabels = { chat: 'Chat', canvas: 'Canvas', agents: 'Agents' };
    const modeHint = `[${modeLabels[this.viewMode]}] Tab ▸`;
    const costText = `Cost: $${this.cumulativeCost.toFixed(4)}`;
    const llmStats = `[In: ${this.totalInputTokens} | Out: ${this.totalOutputTokens} | ${costText}]`;
    const rightText = `${llmStats} ${modeHint}`;

    const hintWidth = this.getTextWidth(rightText);
    term.moveTo(term.width - hintWidth, this.messageAreaHeight + 1);
    term.dim.gray(rightText);
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

    let availableHeight = this.messageAreaHeight;
    let startLine = 1;

    // Clear the message area
    for (let i = 1; i <= this.messageAreaHeight; i++) {
      term.moveTo(1, i).eraseLine();
    }

    if (this.currentMission) {
      const { mainMission, objectives } = this.currentMission;
      const missionLines: string[] = [];
      missionLines.push(` 🎯 Mission: ${mainMission}`);
      if (objectives && objectives.length > 0) {
        for (const obj of objectives) {
          missionLines.push(
            `    ${obj.completed ? '[x]' : '[ ]'} ${obj.description}`
          );
        }
      }
      missionLines.push('─'.repeat(term.width));

      for (
        let i = 0;
        i < missionLines.length && startLine <= this.messageAreaHeight;
        i++
      ) {
        term.moveTo(1, startLine);
        const rawLine = missionLines[i];
        const truncated =
          this.getTextWidth(rawLine) > term.width
            ? this.truncateTextToWidth(rawLine, term.width - 2).text + '…'
            : rawLine;

        if (i === 0) term.cyan(truncated);
        else if (i === missionLines.length - 1) term.gray(truncated);
        else {
          if (truncated.includes('[x]')) term.green(truncated);
          else term.white(truncated);
        }
        startLine++;
        availableHeight--;
      }
    }

    if (availableHeight <= 0) return;

    // Calculate how many messages to display
    const messagesToShow = this.messageBuffer.slice(
      Math.max(0, this.messageBuffer.length - availableHeight)
    );

    // First pass: calculate how many lines each message will take
    let totalLinesNeeded = 0;
    const messageLineCounts: number[] = [];

    for (const { name, message, isAction } of messagesToShow) {
      if (isAction) {
        messageLineCounts.push(1);
        totalLinesNeeded += 1;
        continue;
      }

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
    if (totalLinesNeeded > availableHeight) {
      let linesRemaining = availableHeight;
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
    let currentLine = startLine;

    for (const { name, message, isAction } of messagesToShow) {
      if (isAction) {
        term.moveTo(1, currentLine);
        const prefix = `  ${name} `;
        const arrow = '▸ ';
        const prefixWidth =
          this.getTextWidth(prefix) + this.getTextWidth(arrow);
        const maxMsgWidth = term.width - prefixWidth - 1;
        const truncated =
          this.getTextWidth(message) > maxMsgWidth
            ? this.truncateTextToWidth(message, maxMsgWidth).text + '…'
            : message;
        term.dim.gray(prefix);
        term.dim.white(arrow);
        term.dim.gray(truncated);
        term.styleReset();
        currentLine++;
      } else {
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

    if (this.viewMode === 'canvas') {
      this.redrawCanvasView();
    } else if (this.viewMode === 'agents') {
      this.redrawAgentsView();
    } else {
      this.redrawMessageArea();
    }
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
      if (this.viewMode === 'chat') {
        this.redrawMessageArea();
      }
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

  private static readonly HIDDEN_ACTIONS = new Set([
    'send_message',
    'send_casual_message',
    'send_agent_message',
  ]);

  public addAction(agentName: string, toolCall: LlmToolCall) {
    if (!this.isRunning) return;
    if (TerminalUI.HIDDEN_ACTIONS.has(toolCall.name)) return;

    let summary = toolCall.name;
    if (toolCall.arguments && typeof toolCall.arguments === 'object') {
      const args = toolCall.arguments as Record<string, unknown>;
      const brief = Object.entries(args)
        .slice(0, 3)
        .map(([k, v]) => {
          const val =
            typeof v === 'string'
              ? v.length > 30
                ? v.slice(0, 30) + '...'
                : v
              : String(v);
          return `${k}: ${val}`;
        })
        .join(', ');
      if (brief) {
        summary += `(${brief})`;
      }
    }

    this.messageBuffer.push({
      name: agentName,
      message: summary,
      isAction: true,
    });

    if (this.messageBuffer.length > this.messageBufferSize) {
      this.messageBuffer = this.messageBuffer.slice(-this.messageBufferSize);
    }

    this.redrawUI();
  }

  public updateCanvas(canvasName: string, content: string) {
    this.canvasData.set(canvasName, content);
    if (this.viewMode === 'canvas') {
      this.redrawUI();
    }
  }

  private redrawCanvasView() {
    const names = Array.from(this.canvasData.keys());

    // Tab bar (line 1)
    term.moveTo(1, 1).eraseLine();
    if (names.length === 0) {
      term.gray('  No canvases yet — agents will populate them during work');
    } else {
      for (let i = 0; i < names.length; i++) {
        if (i > 0) term.gray(' │ ');
        if (i === this.selectedCanvasIndex) {
          term.bgWhite.black(` ${names[i]} `);
        } else {
          term.gray(` ${names[i]} `);
        }
      }
    }

    // Separator (line 2)
    term.moveTo(1, 2).eraseLine();
    term.gray('─'.repeat(term.width));

    // Content area
    const contentStartLine = 3;
    const contentHeight = this.messageAreaHeight - 2;

    for (let i = 0; i < contentHeight; i++) {
      term.moveTo(1, contentStartLine + i).eraseLine();
    }

    if (names.length === 0 || this.selectedCanvasIndex >= names.length) {
      return;
    }

    const content = this.canvasData.get(names[this.selectedCanvasIndex]) || '';
    if (!content) {
      term.moveTo(3, contentStartLine);
      term.gray('(empty)');
      return;
    }

    // Wrap content lines
    const rawLines = content.split(/\r?\n/);
    const wrappedLines: string[] = [];
    for (const raw of rawLines) {
      if (raw.length === 0) {
        wrappedLines.push('');
      } else if (this.getTextWidth(raw) <= term.width - 2) {
        wrappedLines.push(raw);
      } else {
        let remaining = raw;
        while (remaining.length > 0) {
          const { text, remaining: rest } = this.truncateTextToWidth(
            remaining,
            term.width - 2
          );
          wrappedLines.push(text);
          remaining = rest;
        }
      }
    }

    // Clamp scroll offset
    const maxOffset = Math.max(0, wrappedLines.length - contentHeight);
    if (this.canvasScrollOffset > maxOffset) {
      this.canvasScrollOffset = maxOffset;
    }

    // Draw content
    for (let i = 0; i < contentHeight; i++) {
      const lineIdx = this.canvasScrollOffset + i;
      if (lineIdx >= wrappedLines.length) break;
      term.moveTo(2, contentStartLine + i);
      term.white(wrappedLines[lineIdx]);
    }

    // Scroll indicator
    if (wrappedLines.length > contentHeight) {
      const barHeight = Math.max(
        1,
        Math.round((contentHeight / wrappedLines.length) * contentHeight)
      );
      const barPos =
        maxOffset > 0
          ? Math.round(
              (this.canvasScrollOffset / maxOffset) *
                (contentHeight - barHeight)
            )
          : 0;

      for (let i = 0; i < contentHeight; i++) {
        term.moveTo(term.width, contentStartLine + i);
        if (i >= barPos && i < barPos + barHeight) {
          term.white('█');
        } else {
          term.gray('░');
        }
      }
    }
  }

  private pushMultiline(lines: string[], text: string) {
    for (const line of text.split(/\r?\n/)) {
      lines.push(line);
    }
  }

  private buildAgentContentLines(
    agent: (typeof this.agentInfos)[number]
  ): string[] {
    const lines: string[] = [];

    lines.push('SUMMARY');
    lines.push('─'.repeat(40));
    if (agent.summary) {
      this.pushMultiline(lines, agent.summary);
    } else {
      lines.push('(no summary)');
    }
    lines.push('');

    lines.push(`MEMORIES (${agent.memories.length})`);
    lines.push('─'.repeat(40));
    if (agent.memories.length === 0) {
      lines.push('(no memories)');
    } else {
      for (let i = 0; i < agent.memories.length; i++) {
        const prefix = `${i + 1}. `;
        const memLines = agent.memories[i].split(/\r?\n/);
        lines.push(prefix + memLines[0]);
        const indent = ' '.repeat(prefix.length);
        for (let j = 1; j < memLines.length; j++) {
          lines.push(indent + memLines[j]);
        }
      }
    }
    lines.push('');

    const totalEntityMems = agent.entityMemories.reduce(
      (sum, em) => sum + em.memories.length,
      0
    );
    lines.push(`ENTITY MEMORIES (${totalEntityMems})`);
    lines.push('─'.repeat(40));
    if (agent.entityMemories.length === 0) {
      lines.push('(no entity memories)');
    } else {
      for (const em of agent.entityMemories) {
        lines.push(`  @ ${em.targetName}`);
        for (let i = 0; i < em.memories.length; i++) {
          const prefix = `  ${i + 1}. `;
          const memLines = em.memories[i].split(/\r?\n/);
          lines.push(prefix + memLines[0]);
          const indent = ' '.repeat(prefix.length);
          for (let j = 1; j < memLines.length; j++) {
            lines.push(indent + memLines[j]);
          }
        }
      }
    }
    lines.push('');

    const canvasEntries = Object.entries(agent.canvases);
    lines.push(`CANVASES (${canvasEntries.length})`);
    lines.push('─'.repeat(40));
    if (canvasEntries.length === 0) {
      lines.push('(no canvases)');
    } else {
      for (const [name, text] of canvasEntries) {
        lines.push(`[${name}]`);
        if (text) {
          this.pushMultiline(lines, text);
        } else {
          lines.push('(empty)');
        }
        lines.push('');
      }
    }

    return lines;
  }

  private redrawAgentsView() {
    // Tab bar (line 1)
    term.moveTo(1, 1).eraseLine();
    if (this.agentInfos.length === 0) {
      term.gray('  No agent data loaded');
    } else {
      for (let i = 0; i < this.agentInfos.length; i++) {
        if (i > 0) term.gray(' │ ');
        if (i === this.selectedAgentIndex) {
          term.bgWhite.black(` ${this.agentInfos[i].name} `);
        } else {
          term.gray(` ${this.agentInfos[i].name} `);
        }
      }
    }

    // Separator (line 2)
    term.moveTo(1, 2).eraseLine();
    term.gray('─'.repeat(term.width));

    const contentStartLine = 3;
    const contentHeight = this.messageAreaHeight - 2;

    for (let i = 0; i < contentHeight; i++) {
      term.moveTo(1, contentStartLine + i).eraseLine();
    }

    if (
      this.agentInfos.length === 0 ||
      this.selectedAgentIndex >= this.agentInfos.length
    ) {
      return;
    }

    const agent = this.agentInfos[this.selectedAgentIndex];
    const rawLines = this.buildAgentContentLines(agent);

    // Word-wrap
    const wrappedLines: string[] = [];
    for (const raw of rawLines) {
      if (raw.length === 0) {
        wrappedLines.push('');
      } else if (this.getTextWidth(raw) <= term.width - 2) {
        wrappedLines.push(raw);
      } else {
        let remaining = raw;
        while (remaining.length > 0) {
          const { text, remaining: rest } = this.truncateTextToWidth(
            remaining,
            term.width - 2
          );
          wrappedLines.push(text);
          remaining = rest;
        }
      }
    }

    // Clamp scroll
    const maxOffset = Math.max(0, wrappedLines.length - contentHeight);
    if (this.agentScrollOffset > maxOffset) {
      this.agentScrollOffset = maxOffset;
    }

    // Draw content
    for (let i = 0; i < contentHeight; i++) {
      const lineIdx = this.agentScrollOffset + i;
      if (lineIdx >= wrappedLines.length) break;
      term.moveTo(2, contentStartLine + i);
      const line = wrappedLines[lineIdx];
      if (
        line.startsWith('SUMMARY') ||
        line.startsWith('MEMORIES') ||
        line.startsWith('ENTITY MEMORIES') ||
        line.startsWith('CANVASES')
      ) {
        term.bold.yellow(line);
      } else if (line.startsWith('─')) {
        term.gray(line);
      } else if (line.startsWith('  @ ')) {
        term.bold.green(line);
      } else if (line.startsWith('[') && line.endsWith(']')) {
        term.bold.cyan(line);
      } else {
        term.white(line);
      }
    }

    // Scroll indicator
    if (wrappedLines.length > contentHeight) {
      const barHeight = Math.max(
        1,
        Math.round((contentHeight / wrappedLines.length) * contentHeight)
      );
      const barPos =
        maxOffset > 0
          ? Math.round(
              (this.agentScrollOffset / maxOffset) * (contentHeight - barHeight)
            )
          : 0;

      for (let i = 0; i < contentHeight; i++) {
        term.moveTo(term.width, contentStartLine + i);
        if (i >= barPos && i < barPos + barHeight) {
          term.white('█');
        } else {
          term.gray('░');
        }
      }
    }
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
        for (const message of messages) {
          if (message && message.message && message.name) {
            this.messageBuffer.push({
              name: message.name,
              message: message.message,
            });
          }
        }

        if (this.messageBuffer.length > this.messageBufferSize) {
          this.messageBuffer = this.messageBuffer.slice(
            -this.messageBufferSize
          );
        }
      }
    } catch (e) {
      this.addMessage('Error', `Error loading initial messages: ${e}`);
    }

    await this.loadInitialCanvases();
    await this.loadInitialAgents();

    this.clearScreen();
    this.redrawUI();
  }

  private async loadInitialCanvases() {
    try {
      const state = await this.locationStorage.getOrCreateLocationState(
        this.locationId
      );

      this.currentMission = state.mission || null;

      for (const [name, canvas] of Object.entries(state.canvases)) {
        if (canvas.text) {
          this.canvasData.set(name, canvas.text);
        }
      }
    } catch (e) {
      this.addMessage('Error', `Error loading canvases: ${e}`);
    }
  }

  private async loadInitialAgents() {
    try {
      const agentIds = this.agentStorage.getAgentIds().map(Number) as AgentId[];
      const models = await this.agentStorage.getAgentModels(agentIds);
      const states = await this.agentStorage.getOrCreateAgentStates(agentIds);

      const locationState = await this.locationStorage.getOrCreateLocationState(
        this.locationId
      );
      const entityStates =
        await this.locationStorage.getOrCreateLocationEntityStates(
          this.locationId,
          agentIds,
          locationState.userIds,
          []
        );

      const entityCanvasMap = new Map<number, Record<string, string>>();
      for (const es of entityStates) {
        if (es.targetType === EntityType.Agent) {
          const canvases: Record<string, string> = {};
          for (const [name, canvas] of Object.entries(es.canvases)) {
            if (canvas.text) canvases[name] = canvas.text;
          }
          if (Object.keys(canvases).length > 0) {
            entityCanvasMap.set(Number(es.targetId), canvases);
          }
        }
      }

      const agentEntityStates =
        await this.agentStorage.getOrCreateAgentEntityStates(
          agentIds,
          agentIds,
          locationState.userIds
        );

      const nameById = new Map<number, string>();
      for (const [id, model] of models) {
        nameById.set(Number(id), model.name);
      }
      const userModel = await SamoAI.instance.userRepository.getUserModel(
        locationState.userIds[0]
      );
      if (userModel) {
        nameById.set(Number(locationState.userIds[0]), userModel.nickname);
      }

      this.agentInfos = [];
      for (const agentId of agentIds) {
        const model = models.get(agentId);
        const state = states.get(agentId);
        if (!model) continue;

        const entityMems: { targetName: string; memories: string[] }[] = [];
        const aes = agentEntityStates.get(agentId);
        if (aes) {
          for (const es of aes) {
            if (es.memories.length === 0) continue;
            const tName =
              nameById.get(Number(es.targetId)) ??
              `${es.targetType}#${es.targetId}`;
            entityMems.push({
              targetName: tName,
              memories: es.memories.map((m) => m.memory),
            });
          }
        }

        this.agentInfos.push({
          id: agentId,
          name: model.name,
          memories: state?.memories.map((m) => m.memory) ?? [],
          summary: state?.summary ?? '',
          canvases: entityCanvasMap.get(Number(agentId)) ?? {},
          entityMemories: entityMems,
        });
      }
    } catch (e) {
      this.addMessage('Error', `Error loading agents: ${e}`);
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

  public handleLlmResponse(response: LlmResponseBase) {
    if (!this.isRunning) return;
    this.totalInputTokens += response.inputTokens || 0;
    this.totalOutputTokens += response.outputTokens || 0;

    const cost = getLlmCost(response);
    if (cost !== undefined) {
      this.cumulativeCost += cost;
    }

    // We update only the status line to avoid full screen redraws
    term.saveCursor();
    term.hideCursor();
    this.drawStatusLine();
    term.restoreCursor();
    term.hideCursor(false);
  }

  /**
   * Sets up event handlers for location messages, agent updates, and gimmick execution
   */
  public setMessageEventHandlers(location: Location) {
    location.on(
      'missionSet',
      async (_loc: Location, mission: LocationMission) => {
        this.currentMission = mission;
        this.redrawUI();
      }
    );

    location.on(
      'objectiveCompleted',
      async (_loc: Location, _index: number, _objective: LocationObjective) => {
        if (_loc.state.mission) {
          this.currentMission = _loc.state.mission;
        }
        this.redrawUI();
      }
    );

    location.on('llmGenerate', (_entity: Entity, response: LlmResponseBase) => {
      this.handleLlmResponse(response);
    });

    location.on('llmUseTools', (_entity: Entity, response: LlmResponseBase) => {
      this.handleLlmResponse(response);
    });

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
      'agentExecuteNextAction',
      (agent: Agent, _index: number, toolCall: LlmToolCall) => {
        this.addAction(agent.model.name, toolCall);
      }
    );

    location.on('agentExecutedNextActions', async (agent: Agent) => {
      if (this.thinkingAgentName === agent.model.name) {
        this.stopThinking();
      }
    });

    location.on('agentExecuteNextActionsFailed', async (agent: Agent) => {
      if (this.thinkingAgentName === agent.model.name) {
        this.stopThinking();
      }
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

    location.on('gimmickOccupied', (gimmick: Gimmick, _entity: Entity) => {
      this.startGimmickExecution(gimmick.key, gimmick.name);
    });

    location.on('gimmickReleased', (gimmick: Gimmick) => {
      this.stopGimmickExecution(gimmick.key);
    });

    location.on(
      'canvasUpdated',
      (
        _loc: Location,
        _modType: unknown,
        _modId: unknown,
        canvasName: string,
        finalText: string
      ) => {
        this.updateCanvas(canvasName, finalText);
      }
    );

    location.on(
      'agentUpdateMemory',
      (agent: Agent, _state: unknown, index: number, memory: string) => {
        const info = this.agentInfos.find((a) => a.id === agent.model.id);
        if (!info) return;
        while (info.memories.length <= index) info.memories.push('');
        info.memories[index] = memory;
        if (this.viewMode === 'agents') this.redrawUI();
      }
    );

    // Note: SamoAI doesn't currently emit an event specifically for agent summary updates natively
    // We may need to periodically poll it or rely on other events causing redraws for now
    // but the `agentUpdateMemory` and `entityUpdateCanvas` events are natively supported.

    // Periodically update the summary to ensure the latest is displayed
    setInterval(() => {
      if (
        !this.isRunning ||
        this.viewMode !== 'agents' ||
        this.agentInfos.length === 0
      )
        return;

      void (async () => {
        try {
          const agent = this.agentInfos[this.selectedAgentIndex];
          const state = await this.agentStorage.getOrCreateAgentState(agent.id);
          if (state && state.summary !== agent.summary) {
            agent.summary = state.summary;
            this.redrawUI();
          }
        } catch (_e) {
          // Ignore silent polling errors
        }
      })();
    }, 5000);

    location.on(
      'agentUpdateEntityMemory',
      (agent: Agent, _entityState: unknown, index: number, memory: string) => {
        const info = this.agentInfos.find((a) => a.id === agent.model.id);
        if (!info) return;
        const updatingEntity = agent.location.updatingEntity;
        if (!updatingEntity) return;
        const targetName = updatingEntity.name;
        let em = info.entityMemories.find((e) => e.targetName === targetName);
        if (!em) {
          em = { targetName, memories: [] };
          info.entityMemories.push(em);
        }
        while (em.memories.length <= index) em.memories.push('');
        em.memories[index] = memory;
        if (this.viewMode === 'agents') this.redrawUI();
      }
    );

    location.on(
      'entityUpdateCanvas',
      (entity: Entity, canvasName: string, finalText: string) => {
        const info = this.agentInfos.find((a) => a.name === entity.name);
        if (info) {
          info.canvases[canvasName] = finalText;
          if (this.viewMode === 'agents') this.redrawUI();
        }
      }
    );
  }
}
