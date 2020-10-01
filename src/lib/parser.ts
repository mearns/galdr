import {
  Command,
  CommandOption,
  Option,
  OptionType
} from "./command-definition";
import { StringTree } from "stringtree-js";

type Trie<V> = {
  get(prefix: string): V | null;
  set(prefix: string, value: V): void;
  prefix(prefix: string): Record<string, V>;
};

/**
 * The type of a parsed argument.
 */
export enum ArgType {
  command = "command",
  positional = "positional",
  option = "option",
  flag = "flag"
}

/**
 * The base type of all parsed arguments.
 */
export interface Arg<T extends ArgType = ArgType> {
  readonly type: T;
  readonly name?: string;
  readonly value?: string | boolean;
}

/**
 * An argument parsed as a command or subcommand.
 */
interface CommandArg extends Arg<ArgType.command> {
  readonly name: string;
}

/**
 * An argument parsed as a positional argument.
 */
interface PositionalArg extends Arg<ArgType.positional> {
  readonly value: string;
}

/**
 * An argument parsed as an option-style argument, with a parameter.
 */
interface OptionArg extends Arg<ArgType.option> {
  readonly name: string;
  readonly value: string;
}

/**
 * An argument parsed as a flag.
 */
interface FlagArg extends Arg<ArgType.flag> {
  readonly name: string;
  readonly value: boolean;
}

function isFlagTypeOption(opt: CommandOption): boolean {
  return opt.type === OptionType.flag || opt.type === OptionType.count;
}

interface NamedOption extends CommandOption {
  name: string;
}

interface ParserState {
  knownOptionNames: Set<string>;
  longOptions: Trie<NamedOption>;
  shortOptions: Map<string, NamedOption>;
  topCommand: Command;
  parsed: Array<Arg<ArgType>>;
}

/**
 * Define a command that this parser knows about.
 */
function addKnownCommandToState(state: ParserState, cmd: Command): void {
  for (const [name, opt] of Object.entries(cmd.options || {})) {
    addKnownOptionToState(state, name, opt);
  }
  for (const sub of Object.values(cmd.subCommands || {})) {
    addKnownCommandToState(state, sub);
  }
}

function addKnownOptionToState(
  state: ParserState,
  name: string,
  opt: CommandOption
): void {
  const aliases = [name, ...(opt.aliases || [])];
  const namedOpt: NamedOption = { name, ...opt };
  state.knownOptionNames.add(name);
  if (isFlagTypeOption(opt)) {
    aliases.push(...aliases.filter(a => a.length > 1).map(a => `no-${a}`));
  }
  for (const alias of aliases) {
    if (alias.length === 1) {
      state.shortOptions.set(alias, namedOpt);
    } else {
      if (state.longOptions.get(alias)) {
        if (state.longOptions.get(alias).type !== opt.type) {
          throw new Error(
            `Option ${alias} has conflicting definitions with types ${
              state.longOptions.get(alias).type
            } and ${opt.type}`
          );
        }
      }
      state.longOptions.set(alias, namedOpt);
    }
  }
}

interface ParserApi {
  hasNext: () => boolean;
  getNext: () => string;
  putBack: () => void;
  getShortOption: (opt: string) => CommandOption;
  getLongOption: (opt: string) => CommandOption;
  hasSubCommand: (name: string) => boolean;
  push: {
    readonly command: (name: string) => void;
    readonly positional: (value: string) => void;
    readonly option: (name: string, value: string) => void;
    readonly flag: (name: string) => void;
  };
}
interface ParserContext {
  hasNext: () => boolean;
  next: () => [string, ParserApi];
  getResults: () => Array<Arg<ArgType>>;
  getAllOptionNames: () => Array<string>;
  getOption: (opt: string) => NamedOption;
  getShortOption: (opt: string) => NamedOption;
  getLongOption: (opt: string) => NamedOption;
  getTopCommand: () => Command;
}

function createParserContext(cmd: Command, args: Array<string>): ParserContext {
  const state: ParserState = {
    knownOptionNames: new Set(),
    longOptions: new StringTree(),
    shortOptions: new Map(),
    topCommand: cmd,
    parsed: []
  };
  addKnownCommandToState(state, cmd);

  let idx = 0;
  const hasNext = (): boolean => idx < args.length;
  const getNext = (): string => {
    const next = args[idx];
    idx++;
    return next;
  };
  const putBack = (argIdx): void => {
    if (idx > argIdx) {
      idx--;
    } else {
      throw new Error(
        "Internal Error: parser tried to put back more args than it consumed"
      );
    }
  };
  const pushParsed = (arg: Arg<ArgType>): void => {
    state.parsed.push(arg);
  };
  const command = (name: string): void => {
    pushParsed({
      type: ArgType.command,
      name
    });
    state.topCommand = state.topCommand.subCommands[name];
  };
  const getTopCommand = () => state.topCommand;
  const positional = (value: string): void => {
    pushParsed({
      type: ArgType.positional,
      value
    });
  };
  const option = (name: string, value: string): void => {
    pushParsed({
      type: ArgType.option,
      name,
      value
    });
  };
  const flag = (name: string): void => {
    pushParsed({
      type: ArgType.flag,
      name: name.replace(/^no-/, ""),
      value: !name.startsWith("no-")
    });
  };
  const getLongOption = (opt: string): NamedOption =>
    state.longOptions.get(opt);
  const getShortOption = (opt: string): NamedOption =>
    state.shortOptions.get(opt);
  const getAllOptionNames = (): Array<string> => [...state.knownOptionNames];
  const hasSubCommand = (name: string): boolean =>
    hasOwnProperty(state.topCommand.subCommands || {}, name);

  return {
    getResults: (): Array<Arg<ArgType>> => state.parsed,
    getTopCommand,
    hasNext,
    getAllOptionNames,
    getOption: (name: string): NamedOption =>
      name.length === 1 ? getShortOption(name) : getLongOption(name),
    getShortOption,
    getLongOption,
    next: (): [string, ParserApi] => {
      const argIdx = idx;
      const arg = getNext();
      return [
        arg,
        {
          getShortOption,
          getLongOption,
          hasSubCommand,
          hasNext,
          getNext,
          putBack: (): void => putBack(argIdx),
          push: {
            command,
            positional,
            option,
            flag
          }
        }
      ];
    }
  };
}

export function parseResults(cmd: Command, args: string[]): ParserContext {
  const context = createParserContext(cmd, args);
  while (context.hasNext()) {
    const [arg, api] = context.next();
    parseArg(arg, api);
  }
  return context;
}

export function parse(cmd: Command, args: string[]): Array<Arg<ArgType>> {
  return parseResults(cmd, args).getResults();
}

interface CompletionSuggestions {
  words: Array<string>;
  files: boolean;
}

function isOptionArg(arg: Arg): arg is OptionArg {
  return (
    arg.type === ArgType.option &&
    hasOwnProperty(arg, "name") &&
    hasOwnProperty(arg, "value")
  );
}

export function getCompletionSuggestions(
  cmd: Command,
  args: Array<string>
): CompletionSuggestions {
  // From the "complete" command, if there's a space after the last arg typed, then
  // there's an extra empty-string arg passed at the end of the array. Otherwise, the
  // last element is the one that they're still typing.
  const context = parseResults(cmd, args.slice(1));
  const optionsNotUsed: Array<string> = getOptionsNotUsed(context);

  const topCommand: Command = context.getTopCommand();
  const commands: Array<string> = Object.keys(
    (topCommand && topCommand.subCommands) || {}
  );

  const expectedParamType: OptionType = getExpectedParameterType(args, context);
  // XXX: Look through positionals not yet consumed, and an option at end (if any) to see if they are type file or files.
  // const lookingForFiles =

  return {
    words: [...optionsNotUsed, ...commands],
    files: lookingForFiles
  };
}

/**
 * Return the type of parameter expected next, or null if no parameter is expected.
 * A parameter is expected if the last arg is complete and represents an option that
 * takes a parameter.
 */
function getExpectedParameterType(
  args: Array<string>,
  context: ParserContext
): OptionType | null {
  const results: Array<Arg<ArgType>> = context.getResults();

  if (args[args.length - 1] !== "") {
    // Last arg isn't complete.
    return null;
  }
  const lastParsed: Arg = results[results.length - 1];
  if (!isOptionArg(lastParsed)) {
    // Last arg isn't an option
    return null;
  }
  const tailOptArg: OptionArg = lastParsed;
  const tailOpt: CommandOption = context.getOption(tailOptArg.name);

  if (isFlagTypeOption(tailOpt)) {
    // Flag types don't take params
    return null;
  }

  return tailOpt.type;
}

function getPositionalsNotUsed(context: ParserContext): void {
  // XXX
}

function getOptionsNotUsed(context: ParserContext): Array<string> {
  const parsed = context.getResults();
  const optionArgsPassed: Set<OptionArg> = new Set([
    ...parsed.filter(arg => arg.type === ArgType.option)
  ] as Array<OptionArg>);
  const optionsPassed: Array<NamedOption> = [...optionArgsPassed]
    .map(arg => arg.name)
    .map(name =>
      name.length === 1
        ? context.getShortOption(name)
        : context.getLongOption(name)
    );
  const optionNamesConsumed: Set<string> = new Set([
    ...optionsPassed.filter(isSingularOpt).map(opt => opt.name)
  ]);
  return context
    .getAllOptionNames()
    .filter(optName => !optionNamesConsumed.has(optName));
}

function isSingularOpt(cmd: CommandOption): boolean {
  switch (cmd.type) {
    case OptionType.dirs:
    case OptionType.files:
    case OptionType.numbers:
    case OptionType.strings:
      return false;

    default:
      return true;
  }
}

function parseArg(arg: string, api: ParserApi): void {
  if (arg === "--") {
    parseBreakOutArg(api);
  } else if (arg === "-") {
    parsePositionalArg(api, arg);
  } else if (arg.startsWith("--")) {
    parseLongOptionArg(arg, api);
  } else if (arg.startsWith("-")) {
    parseShortOptionArg(arg, api);
  } else if (api.hasSubCommand(arg)) {
    parseSubCommand(api, arg);
  } else {
    parsePositionalArg(api, arg);
  }
}

function parseShortOptionArg(arg: string, api: ParserApi): void {
  const bareArgs: string = arg.substr(1); // strip the '-'
  const [allNames, ...eqOther] = bareArgs.split("=");
  const lastName = allNames.substr(allNames.length - 1);
  const firstNames = allNames.substr(0, allNames.length - 1);
  for (const shortOpt of firstNames) {
    api.push.flag(shortOpt);
  }
  if (eqOther.length) {
    // A '=' was specified, so the last option has a parameter
    api.push.option(lastName, eqOther.join("="));
  } else {
    parseOptionWithPossibleParameter(
      lastName,
      api.getShortOption(lastName),
      api
    );
  }
}

function parseLongOptionArg(arg: string, api: ParserApi): void {
  const bareArg = arg.substr(2);
  const [name, ...eqOther] = bareArg.split("=");
  if (eqOther.length) {
    // Found '=', so there's an explicit parameter with the option.
    api.push.option(name, eqOther.join("="));
  } else {
    parseOptionWithPossibleParameter(name, api.getLongOption(name), api);
  }
}

function parseOptionWithPossibleParameter(
  name: string,
  opt: CommandOption | undefined,
  api: ParserApi
): void {
  if (api.hasNext()) {
    const maybeParam = api.getNext();
    // First, check to see if we know this option.
    if (opt) {
      if (isFlagTypeOption(opt)) {
        // Known to not take a parameter
        api.putBack();
        api.push.flag(name);
      } else {
        // Known to take a parameter
        api.push.option(name, maybeParam);
      }
    } else {
      // Not known, we'll have to guess based on what the next arg looks like.
      if (maybeParam.startsWith("-")) {
        // Looks like another option up next, so not a parameter.
        api.putBack();
        api.push.flag(name);
      } else {
        // Doesn't look like an option, so let's guess that it's a parameter.
        api.push.option(name, maybeParam);
      }
    }
  } else {
    // Dont have a next arg, so no param for this option.
    api.push.flag(name);
  }
}

function parseBreakOutArg(api: ParserApi): void {
  while (api.hasNext()) {
    api.push.positional(api.getNext());
  }
}

function parseSubCommand(api: ParserApi, arg: string): void {
  api.push.command(arg);
}

function parsePositionalArg(api: ParserApi, arg: string): void {
  api.push.positional(arg);
}

function hasOwnProperty(obj: unknown, propName: string): boolean {
  return Object.hasOwnProperty.call(obj, propName);
}
