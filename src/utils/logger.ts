import ora, { type Ora, type Color, type Options as OraOptions } from 'ora';
import chalk from 'chalk';
import readline from 'node:readline';
import { isDebugMode } from './common';

/**
 * Configuration options for the Logger
 */
interface LoggerOptions {
  /** Color of the spinner */
  color?: Color;
  /** Whether the logger is enabled */
  enabled?: boolean;
  /** Parent spinner instance */
  parentSpinner?: Ora;
}

/**
 * Logger class providing advanced logging and spinner functionality
 */
class Logger {
  /** Map to store spinner instances */
  private spinners: Map<string, Ora>;
  /** Default configuration options */
  private defaultOptions: LoggerOptions;
  /** Parent spinner instance */
  private parentSpinner?: Ora;
  /** Singleton instance */
  private static instance: Logger;

  /**
   * Constructor for Logger
   * @param options - Configuration options for the logger
   */
  constructor(options: LoggerOptions = {}) {
    this.spinners = new Map();
    this.defaultOptions = {
      color: 'cyan',
      enabled: true,
      ...options
    };
    this.parentSpinner = options.parentSpinner;
  }

  /**
   * Creates a spinner instance with given text and options
   * @param text - Text to display on the spinner
   * @param options - Additional spinner options
   * @returns Ora spinner instance
   */
  private createSpinnerInstance(text: string, options: LoggerOptions = {}): Ora {
    const mergedOptions = { ...this.defaultOptions, ...options };

    return ora({
      text,
      color: mergedOptions.color,
      spinner: 'pong',
      isEnabled: mergedOptions.enabled,
      stream: process.stdout,
      discardStdin: false
    });
  }

  /**
   * Adjusts cursor position when a parent spinner exists
   */
  private adjustCursorPosition() {
    if (this.parentSpinner) {
      readline.cursorTo(process.stdout, 0);
      readline.moveCursor(process.stdout, 0, 1);
    }
  }

  /**
   * Restores cursor position after spinner manipulation
   */
  private restoreCursorPosition() {
    if (this.parentSpinner) {
      readline.cursorTo(process.stdout, 0);
      readline.moveCursor(process.stdout, 0, -1);
    }
  }

  /**
   * Creates a new spinner with given ID and text
   * @param id - Unique identifier for the spinner
   * @param text - Text to display on the spinner
   * @param options - Additional spinner options
   * @returns Ora spinner instance
   */
  create(id: string, text: string, options: LoggerOptions = {}): Ora {
    const spinner = this.createSpinnerInstance(text, options);

    const originalRender = spinner.render.bind(spinner);
    spinner.render = () => {
      this.adjustCursorPosition();
      originalRender();
      this.restoreCursorPosition();
      return spinner;
    };

    this.spinners.set(id, spinner);
    return spinner;
  }

  /**
   * Starts a spinner with given ID and optional text
   * @param id - Unique identifier for the spinner
   * @param text - Optional text to display on the spinner
   * @returns Ora spinner instance
   */
  start(id: string, text?: string): Ora {
    let spinner = this.spinners.get(id);
    if (!spinner) {
      spinner = this.createSpinnerInstance(text || '');
      this.spinners.set(id, spinner);
    }
    if (text) spinner.text = text;

    if (this.parentSpinner) {
      console.log();
    }

    return spinner.start();
  }

  /**
   * Stops a spinner with given ID
   * @param id - Unique identifier for the spinner
   */
  stop(id: string): void {
    const spinner = this.spinners.get(id);
    if (spinner) {
      this.adjustCursorPosition();
      spinner.stop();
      this.restoreCursorPosition();
      this.spinners.delete(id);
    }
  }

  /**
   * Updates the text of a spinner with given ID
   * @param id - Unique identifier for the spinner
   * @param text - New text to display on the spinner
   */
  update(id: string, text: string): void {
    let spinner = this.spinners.get(id);
    if (!spinner) {
      spinner = this.createSpinnerInstance(text);
      this.spinners.set(id, spinner);
    }
    this.adjustCursorPosition();
    spinner.text = text;
    this.restoreCursorPosition();
  }

  /**
   * Marks a spinner as successful with optional text
   * @param id - Unique identifier for the spinner
   * @param text - Optional success message
   */
  succeed(id: string, text?: string): void {
    const spinner = this.spinners.get(id);
    if (spinner) {
      this.adjustCursorPosition();
      spinner.succeed(text);
      this.restoreCursorPosition();
      this.spinners.delete(id);
    }
  }

  /**
   * Marks a spinner as failed with optional text
   * @param id - Unique identifier for the spinner
   * @param text - Optional failure message
   */
  fail(id: string, text?: string): void {
    const spinner = this.spinners.get(id);
    if (spinner) {
      this.adjustCursorPosition();
      spinner.fail(text);
      this.restoreCursorPosition();
      this.spinners.delete(id);
    }
  }

  /**
   * Logs an informational message
   * @param text - Message to log
   */
  info(text: string): void {
    console.log(chalk.blue('ℹ️ '), text);
  }

  /**
   * Logs a warning message
   * @param text - Warning message to log
   */
  warn(text: string): void {
    console.warn(chalk.yellow('⚠️ '), text);
  }

  /**
   * Logs an error message with optional error details
   * @param text - Error message to log
   * @param error - Optional error object with additional details
   */
  error(text: string, error?: { name: string; message: string; stack: string | undefined; }): void {
    let errorMessage = text;

    if (error) {
      errorMessage += `\n${chalk.red('Error Details:')}`;
      errorMessage += `\n  ${chalk.red('Name: ')}${error.name}`;
      errorMessage += `\n  ${chalk.red('Message: ')}${error.message}`;
      if (error.stack) {
        errorMessage += `\n  ${chalk.red('Stack: ')}${error.stack.split('\n').join('\n    ')}`;
      }
    }

    console.error(chalk.red('❌ '), errorMessage);
  }

  /**
   * Logs a debug message with optional error details (only in debug mode)
   * @param text - Debug message to log
   * @param error - Optional error object with additional details
   */
  debug(text: string, error?: { name: string; message: string; stack: string | undefined; }): void {
    if (isDebugMode()) {
      let debugMessage = text;

      if (error) {
        debugMessage += `\n${chalk.bgMagentaBright('Debug Details:')}`;
        debugMessage += `\n  ${chalk.bgMagentaBright('Name: ')}${error.name}`;
        debugMessage += `\n  ${chalk.bgMagentaBright('Message: ')}${error.message}`;
        if (error.stack) {
          debugMessage += `\n  ${chalk.bgMagentaBright('Stack: ')}${error.stack.split('\n').join('\n    ')}`;
        }
      }

      console.log(chalk.bgMagentaBright('🔍 '), debugMessage);
    }
  }
}

export default Logger;