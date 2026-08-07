/** @private — only imported by runners.ts */

import {
  definition as commitWorkDef,
  execute as commitWorkExec,
} from "./create-standard-tool-registry/commit-work";
import {
  definition as completeTaskDef,
  execute as completeTaskExec,
} from "./create-standard-tool-registry/complete-task";
import {
  definition as createInstanceDef,
  execute as createInstanceExec,
} from "./create-standard-tool-registry/create-instance";
import {
  definition as gitDiffDef,
  execute as gitDiffExec,
} from "./create-standard-tool-registry/git-diff";
import {
  definition as gitLogDef,
  execute as gitLogExec,
} from "./create-standard-tool-registry/git-log";
import {
  definition as gitShowDef,
  execute as gitShowExec,
} from "./create-standard-tool-registry/git-show";
import {
  definition as gitStatusDef,
  execute as gitStatusExec,
} from "./create-standard-tool-registry/git-status";
import {
  definition as listDirDef,
  execute as listDirExec,
} from "./create-standard-tool-registry/list-directory";
import {
  definition as readFileDef,
  execute as readFileExec,
} from "./create-standard-tool-registry/read-file";
import {
  definition as runCommandDef,
  execute as runCommandExec,
} from "./create-standard-tool-registry/run-command";
import {
  definition as searchCodeDef,
  execute as searchCodeExec,
} from "./create-standard-tool-registry/search-code";
import {
  definition as writeFileDef,
  execute as writeFileExec,
} from "./create-standard-tool-registry/write-file";
import type {
  InfrastructureToolName,
  ToolDefinition,
  ToolExecutor,
} from "./tool-types";

export function createStandardToolDefinitions(): Record<
  InfrastructureToolName,
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
    create_instance: createInstanceDef,
    complete_task: completeTaskDef,
  };
}

export function createStandardToolRegistry(): Record<
  InfrastructureToolName,
  ToolExecutor
> {
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
    create_instance: createInstanceExec,
    complete_task: completeTaskExec,
  };
}
