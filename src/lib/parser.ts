import { Command, CommandOption, OptionType } from "./command-definition";
import { StringTree } from "stringtree-js";

type Trie<V> = typeof StringTree & {
  get(string): V | null;
  set(string, V): void;
  prefix(string): Record<string, V>;
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
export interface Arg<T extends ArgType> {
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

interface ParserState {
  longOptions: Trie<CommandOption>;
  shortOptions: Map<string, CommandOption>;
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
  if (isFlagTypeOption(opt)) {
    aliases.push(...aliases.filter(a => a.length > 1).map(a => `no-${a}`));
  }
  for (const alias of aliases) {
    if (alias.length === 1) {
      state.shortOptions.set(alias, opt);
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
      state.longOptions.set(alias, opt);
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
}

function createParserContext(cmd: Command, args: Array<string>): ParserContext {
  const state: ParserState = {
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
  const getLongOption = (opt: string): CommandOption =>
    state.longOptions.get(opt);
  const getShortOption = (opt: string): CommandOption =>
    state.shortOptions.get(opt);
  const hasSubCommand = (name: string): boolean =>
    hasOwnProperty(state.topCommand.subCommands || {}, name);

  return {
    getResults: (): Array<Arg<ArgType>> => state.parsed,
    hasNext,
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

export function parse(cmd: Command, args: string[]): Array<Arg<ArgType>> {
  const context = createParserContext(cmd, args);
  while (context.hasNext()) {
    const [arg, api] = context.next();
    parseArg(arg, api);
  }
  return context.getResults();
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
