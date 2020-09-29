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

function commandArg(name: string): CommandArg {
  return {
    type: ArgType.command,
    name
  };
}

/**
 * An argument parsed as a positional argument.
 */
interface PositionalArg extends Arg<ArgType.positional> {
  readonly value: string;
}

function positionalArg(value: string): PositionalArg {
  return {
    type: ArgType.positional,
    value
  };
}

/**
 * An argument parsed as an option-style argument, with a parameter.
 */
interface OptionArg extends Arg<ArgType.option> {
  readonly name: string;
  readonly value: string;
}

function optionArg(name: string, value: string): OptionArg {
  return {
    type: ArgType.option,
    name,
    value
  };
}

/**
 * An argument parsed as a flag.
 */
interface FlagArg extends Arg<ArgType.flag> {
  readonly name: string;
  readonly value: boolean;
}

function flagArg(name: string): FlagArg {
  return {
    type: ArgType.flag,
    name: name.replace(/^no-/, ""),
    value: !name.startsWith("no-")
  };
}

function isFlagTypeOption(opt: CommandOption): boolean {
  return opt.type === OptionType.flag || opt.type === OptionType.count;
}

interface ParserApi {
  hasNext: () => boolean;
  getNext: () => string;
  putBack: () => void;
}

class CommandLineParser {
  private longOptions: Trie<CommandOption>;
  private shortOptions: Map<string, CommandOption>;
  private topCommand: Command;
  public parsed: Array<Arg<ArgType>>;

  constructor(cmd: Command) {
    this.longOptions = new StringTree();
    this.shortOptions = new Map();
    this.topCommand = cmd;
    this.parsed = [];

    this.addKnownCommand(cmd);
  }

  /**
   * Define a command that this parser knows about.
   * @param cmd
   */
  private addKnownCommand(cmd: Command): void {
    for (const [name, opt] of Object.entries(cmd.options || {})) {
      this.addKnownOption(name, opt);
    }
    for (const sub of Object.values(cmd.subCommands || {})) {
      this.addKnownCommand(sub);
    }
  }

  private addKnownOption(name: string, opt: CommandOption): void {
    const aliases = [name, ...(opt.aliases || [])];
    if (isFlagTypeOption(opt)) {
      aliases.push(...aliases.filter(a => a.length > 1).map(a => `no-${a}`));
    }
    for (const alias of aliases) {
      if (alias.length === 1) {
        this.shortOptions.set(alias, opt);
      } else {
        if (this.longOptions.get(alias)) {
          if (this.longOptions.get(alias).type !== opt.type) {
            throw new Error(
              `Option ${alias} has conflicting definitions with types ${
                this.longOptions.get(alias).type
              } and ${opt.type}`
            );
          }
        }
        this.longOptions.set(alias, opt);
      }
    }
  }

  parse(args: string[]): void {
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
    while (idx < args.length) {
      const argIdx = idx;
      idx++;
      const api: ParserApi = {
        hasNext,
        getNext,
        putBack: (): void => putBack(argIdx)
      };
      this.parseArg(args[argIdx], api);
    }
  }

  private parseArg(arg: string, api: ParserApi): void {
    if (arg === "--") {
      this.parseBreakOutArg(api);
    } else if (arg === "-") {
      this.parsePositionalArg(arg);
    } else if (arg.startsWith("--")) {
      this.parseLongOptionArg(arg, api);
    } else if (arg.startsWith("-")) {
      this.parseShortOptionArg(arg, api);
    } else if (hasOwnProperty(this.topCommand.subCommands || {}, arg)) {
      this.parseSubCommand(arg);
    } else {
      this.parsePositionalArg(arg);
    }
  }

  private parseShortOptionArg(arg: string, api: ParserApi): void {
    const bareArgs: string = arg.substr(1); // strip the '-'
    const [allNames, ...eqOther] = bareArgs.split("=");
    const lastName = allNames.substr(allNames.length - 1);
    const firstNames = allNames.substr(0, allNames.length - 1);
    for (const shortOpt of firstNames) {
      this.parsed.push(flagArg(shortOpt));
    }
    if (eqOther.length) {
      // A '=' was specified, so the last option has a parameter
      this.parsed.push(optionArg(lastName, eqOther.join("=")));
    } else {
      this.parseOptionWithPossibleParameter(
        lastName,
        this.shortOptions.get(lastName),
        api
      );
    }
  }

  private parseLongOptionArg(arg: string, api: ParserApi): void {
    const bareArg = arg.substr(2);
    const [name, ...eqOther] = bareArg.split("=");
    if (eqOther.length) {
      // Found '=', so there's an explicit parameter with the option.
      this.parsed.push(optionArg(name, eqOther.join("=")));
    } else {
      this.parseOptionWithPossibleParameter(
        name,
        this.longOptions.get(name),
        api
      );
    }
  }

  private parseOptionWithPossibleParameter(
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
          this.parsed.push(flagArg(name));
        } else {
          // Known to take a parameter
          this.parsed.push(optionArg(name, maybeParam));
        }
      } else {
        // Not known, we'll have to guess based on what the next arg looks like.
        if (maybeParam.startsWith("-")) {
          // Looks like another option up next, so not a parameter.
          api.putBack();
          this.parsed.push(flagArg(name));
        } else {
          // Doesn't look like an option, so let's guess that it's a parameter.
          this.parsed.push(optionArg(name, maybeParam));
        }
      }
    } else {
      // Dont have a next arg, so no param for this option.
      this.parsed.push(flagArg(name));
    }
  }

  private parseBreakOutArg(api: ParserApi): void {
    while (api.hasNext()) {
      this.parsed.push(positionalArg(api.getNext()));
    }
  }

  private parseSubCommand(arg: string): void {
    this.parsed.push(commandArg(arg));
    this.topCommand = this.topCommand.subCommands[arg];
  }

  private parsePositionalArg(arg: string): void {
    this.parsed.push(positionalArg(arg));
  }
}

export function parseCommandLine(
  cmd: Command,
  args: Array<string>
): Array<Arg<ArgType>> {
  const parser = new CommandLineParser(cmd);
  parser.parse(args);
  return parser.parsed;
}

function hasOwnProperty(obj: unknown, propName: string): boolean {
  return Object.hasOwnProperty.call(obj, propName);
}
