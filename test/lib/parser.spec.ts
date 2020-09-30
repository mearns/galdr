/* eslint-env mocha */
/* eslint no-unused-expressions: 0 */
/* eslint @typescript-eslint/ban-ts-ignore: 0 */

// Module under test
import { ArgType, parse } from "../../src/lib/parser";

// Support
import {
  Command,
  OptionType,
  PositionalType
} from "../../src/lib/command-definition";
import { expect } from "chai";

describe("The parser module", () => {
  it("should parse a mixed command line with some options defined and some not known", () => {
    const testCommand: Command = {
      options: {
        opt1: {
          type: OptionType.flag
        },
        opt2: {
          type: OptionType.strings
        },
        a: {
          aliases: ["opt4"],
          type: OptionType.flag
        }
      },
      positionals: [
        {
          names: ["positional1"],
          type: PositionalType.string
        }
      ],
      subCommands: {
        cmd1: {
          options: {
            b: {
              type: OptionType.string // this is wrong, we're testig that.
            }
          },
          subCommands: {
            cmd2: {}
          }
        }
      }
    };

    const testCommandLine = [
      "--opt1",
      "--opt2",
      "param2.1",
      "cmd1",
      "pos1",
      "--opt2",
      "param2.2",
      "-abc",
      "arg-for-c",
      "--opt3",
      "--no-opt3",
      "--opt4",
      "--opt5",
      "param5",
      "cmd2",
      "pos2",
      "--opt6"
    ];
    const results = parse(testCommand, testCommandLine);
    expect(results).to.deep.equal([
      {
        name: "opt1",
        type: ArgType.flag,
        value: true
      },
      {
        name: "opt2",
        type: ArgType.option,
        value: "param2.1"
      },
      {
        name: "cmd1",
        type: ArgType.command
      },
      {
        value: "pos1",
        type: ArgType.positional
      },
      {
        name: "opt2",
        type: ArgType.option,
        value: "param2.2"
      },
      { name: "a", type: ArgType.flag, value: true },
      { name: "b", type: ArgType.flag, value: true },
      { name: "c", type: ArgType.option, value: "arg-for-c" },
      { name: "opt3", type: ArgType.flag, value: true },
      { name: "opt3", type: ArgType.flag, value: false },
      { name: "opt4", type: ArgType.flag, value: true },
      { name: "opt5", type: ArgType.option, value: "param5" },
      { name: "cmd2", type: ArgType.command },
      { value: "pos2", type: ArgType.positional },
      { name: "opt6", type: ArgType.flag, value: true }
    ]);
  });

  it("should handle long options with parameters when defined as such", () => {
    const testCommand = {
      options: {
        foobar: {
          type: OptionType.string
        }
      }
    } as Command;

    const results = parse(testCommand, ["--foobar", "trot"]);

    expect(results).to.deep.equal([
      {
        type: ArgType.option,
        name: "foobar",
        value: "trot"
      }
    ]);
  });

  it("should handle long options without parameters when defined as such", () => {
    const testCommand = {
      options: {
        foobar: {
          type: OptionType.flag
        }
      }
    } as Command;

    const results = parse(testCommand, ["--foobar", "trot"]);

    expect(results).to.deep.equal([
      {
        type: ArgType.flag,
        name: "foobar",
        value: true
      },
      { type: "positional", value: "trot" }
    ]);
  });

  it("should handle unique prefix of long options", () => {
    const testCommand = {
      options: {
        food: {
          type: OptionType.flag
        },
        foobar: {
          type: OptionType.string
        }
      }
    } as Command;

    const results = parse(testCommand, ["--foob", "trot"]);

    expect(results).to.deep.equal([
      {
        type: ArgType.option,
        name: "foob",
        value: "trot"
      }
    ]);
  });
});
