/**
 * These are different types that positional arguments can take. Plural indicates
 * that the positional can be specified multiple times to build a list of values.
 */
export enum PositionalType {
  file = "file",
  files = "files",
  dir = "dir",
  dirs = "dirs",
  string = "string",
  strings = "strings",
  numbers = "numbers",
  number = "number"
}

/**
 * These are different types that optional arguments can take. Plurals indicate that
 * the option can be specified multiple times to build a list of values for the option.
 */
export enum OptionType {
  file = "file",
  files = "files",
  dir = "dir",
  dirs = "dirs",
  string = "string",
  strings = "strings",
  numbers = "numbers",
  number = "number",
  flag = "flag",
  count = "count"
}

/**
 * The common base type of both positional arguments and option arguments.
 */
export interface BaseArg {
  /**
   * Whether or not the argument must be specified.
   */
  required?: boolean;

  /**
   * The default value, if there is one.
   */
  default?: unknown;

  /**
   * The help text for this argument.
   */
  description?: string;

  /**
   * Optionally specify a list of valid values for this argument.
   */
  choices?: Array<string | number>;

  /**
   * Invoked to validate the value given on the command
   * line and optionally parse/convert it to something more useful to you. This is
   * invoked after command line parsing is completed. If the argument has a plural
   * type, then it will be invoked with the array of values. If it is a count, it will
   * be invoked with the count.
   */
  coerce?: (
    parsedArg: string | number | boolean | Array<string> | Array<number>
  ) => unknown;
}

/**
 * Represents a positional argument definition.
 */
export interface Positional extends BaseArg {
  type: PositionalType;
}

/**
 * Represents an option-style argument definition.
 */
export interface Option extends BaseArg {
  type: OptionType;
  hidden?: boolean;
  conflicts?: Array<string>;
}

/**
 * A positional argument with one or more names.
 */
export interface CommandPositional extends Positional {
  names: { 0: string } & Array<string>;
}

/**
 * An option-style argument with optional aliases.
 */
export interface CommandOption extends Option {
  aliases?: Array<string>;
}

/**
 * Represents a command (including sub-commands).
 */
export interface Command {
  /**
   * The help text for the command.
   */
  description?: string;

  /**
   * An array of positional arguments that the command accepts.
   */
  positionals?: Array<CommandPositional>;

  /**
   * A mapping of option-style arguments that the command accepts, keyed by their
   * primary option name.
   */
  options?: Record<string, CommandOption>;

  /**
   * A mapping of sub-commands that the command supports, keyed by the command name.
   */
  subCommands?: Record<string, Command>;
}
