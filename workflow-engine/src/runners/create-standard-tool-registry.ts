import type { ToolDefinition, ToolExecutor } from "./tool-types";
import {
  definition as commitWorkDef,
  execute as commitWorkExec,
} from "./tools/commit-work";
import {
  definition as gitDiffDef,
  execute as gitDiffExec,
} from "./tools/git-diff";
import {
  definition as gitLogDef,
  execute as gitLogExec,
} from "./tools/git-log";
import {
  definition as gitShowDef,
  execute as gitShowExec,
} from "./tools/git-show";
import {
  definition as gitStatusDef,
  execute as gitStatusExec,
} from "./tools/git-status";
import {
  definition as listDirDef,
  execute as listDirExec,
} from "./tools/list-directory";
import {
  definition as readFileDef,
  execute as readFileExec,
} from "./tools/read-file";
import {
  definition as runCommandDef,
  execute as runCommandExec,
} from "./tools/run-command";
import {
  definition as searchCodeDef,
  execute as searchCodeExec,
} from "./tools/search-code";
import {
  definition as writeFileDef,
  execute as writeFileExec,
} from "./tools/write-file";

export function createStandardToolDefinitions(): Record<
  string,
  ToolDefinition
> {
  return {
    read_file: readFileDef,
    list_directory: listDirDef,
    search_code: searchCodeDef,
    write_file: writeFileDef,
    run_command: runCommandDef,
    git_status: gitStatusDef,
    git_diff: gitDiffDef,
    git_log: gitLogDef,
    git_show: gitShowDef,
    commit_work: commitWorkDef,
  };
}

export function createStandardToolRegistry(): Record<string, ToolExecutor> {
  return {
    read_file: readFileExec,
    list_directory: listDirExec,
    search_code: searchCodeExec,
    write_file: writeFileExec,
    run_command: runCommandExec,
    git_status: gitStatusExec,
    git_diff: gitDiffExec,
    git_log: gitLogExec,
    git_show: gitShowExec,
    commit_work: commitWorkExec,
  };
}
